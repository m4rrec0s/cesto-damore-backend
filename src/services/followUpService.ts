import prisma from "../database/prisma";
import logger from "../utils/logger";
import { botFlowService } from "./botFlowService";

type BotHistoryEntry = {
  role?: string;
  text?: string;
  created_at?: string;
};

type FollowUpNodeConfig = {
  id: string;
  inactivityMinutes: number;
};

class FollowUpService {
  private isRunning = false;

  private normalizePhoneForWhatsApp(phone: string): string | null {
    const raw = String(phone || "").trim();
    if (!raw || /^lab-/i.test(raw)) return null;

    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;

    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }

    if (digits.length === 12 || digits.length === 13) {
      return digits;
    }

    return null;
  }

  private formatMinutes(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}min`;
    }
    if (hours > 0) {
      return `${hours}h`;
    }
    return `${minutes}min`;
  }

  private resolveFollowUpInactivityMinutes(nodeData: Record<string, any>): number {
    if (
      typeof nodeData?.inactivityMinutes === "number" &&
      Number.isFinite(nodeData.inactivityMinutes)
    ) {
      return Math.max(1, Math.round(nodeData.inactivityMinutes));
    }

    if (
      typeof nodeData?.inactivityHours === "number" &&
      Number.isFinite(nodeData.inactivityHours)
    ) {
      return Math.max(1, Math.round(nodeData.inactivityHours * 60));
    }

    return 24 * 60;
  }

  private toValidDate(value?: string | Date | null): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async upsertLatestMessageByPhone(
    latestByPhone: Map<string, Date>,
  ): Promise<Set<string>> {
    if (latestByPhone.size === 0) {
      return new Set<string>();
    }

    const phones = [...latestByPhone.keys()];
    const existingCustomers = await prisma.customer.findMany({
      where: { number: { in: phones } },
      select: { number: true, last_message_sent: true },
    });

    const existingMap = new Map(
      existingCustomers.map((customer) => [customer.number, customer]),
    );
    const updatedPhones = new Set<string>();

    for (const [phone, latestMessageAt] of latestByPhone.entries()) {
      const existing = existingMap.get(phone);

      if (!existing) {
        await prisma.customer.create({
          data: {
            number: phone,
            follow_up: true,
            last_message_sent: latestMessageAt,
          },
        });
        updatedPhones.add(phone);
        continue;
      }

      const isNewer =
        !existing.last_message_sent ||
        latestMessageAt > existing.last_message_sent;
      if (!isNewer) continue;

      await prisma.customer.update({
        where: { number: phone },
        data: {
          follow_up: true,
          last_message_sent: latestMessageAt,
        },
      });

      // Reinicia o ciclo de follow-up quando chega nova mensagem do cliente
      await prisma.followUpSent.deleteMany({
        where: { cliente_number: phone },
      });

      updatedPhones.add(phone);
    }

    return updatedPhones;
  }

  private async syncLastMessageFromBotSessions(): Promise<Set<string>> {
    const sessions = await prisma.botSession.findMany({
      where: {
        phone: { not: "" },
      },
      select: {
        phone: true,
        history: true,
      },
    });

    if (sessions.length === 0) {
      return new Set<string>();
    }

    const latestByPhone = new Map<string, Date>();

    sessions.forEach((session) => {
      const history = Array.isArray(session.history)
        ? (session.history as BotHistoryEntry[])
        : [];

      const lastUserMessageAt = history
        .filter((entry) => (entry.role || "").toLowerCase() === "user")
        .map((entry) => this.toValidDate(entry.created_at))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      if (!lastUserMessageAt) return;

      const current = latestByPhone.get(session.phone);
      if (!current || lastUserMessageAt > current) {
        latestByPhone.set(session.phone, lastUserMessageAt);
      }
    });

    return this.upsertLatestMessageByPhone(latestByPhone);
  }

  private async getFollowUpNodeConfigs(): Promise<FollowUpNodeConfig[]> {
    const flow = await botFlowService.getActiveFlow();
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as any[]) : [];

    const followUpNodes = nodes
      .filter((node) => node.type === "followUpNode")
      .map((node) => {
        const configuredMinutes = this.resolveFollowUpInactivityMinutes(
          (node?.data || {}) as Record<string, any>,
        );
        if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) {
          return null;
        }

        return {
          id: String(node.id),
          inactivityMinutes: Math.round(configuredMinutes),
        } satisfies FollowUpNodeConfig;
      })
      .filter((item): item is FollowUpNodeConfig => Boolean(item))
      .sort((a, b) => a.inactivityMinutes - b.inactivityMinutes);

    return followUpNodes;
  }

  async getSentHistory() {
    return prisma.followUpSent.findMany({
      include: {
        customer: true,
      },
      orderBy: { enviado_em: "desc" },
    });
  }

  async toggleFollowUp(phone: string, status: boolean) {
    return prisma.customer.update({
      where: { number: phone },
      data: { follow_up: status },
    });
  }

  async triggerFollowUpFunction() {
    if (this.isRunning) {
      logger.info("⏳ [FollowUp] Rotina já em execução, pulando ciclo concorrente");
      return;
    }

    this.isRunning = true;

    try {
      const [, followUpNodes] = await Promise.all([
        this.syncLastMessageFromBotSessions(),
        this.getFollowUpNodeConfigs(),
      ]);

      if (followUpNodes.length === 0) {
        logger.info("📊 [FollowUp] Nenhum nó Follow Up configurado no fluxo");
        return;
      }

      const customersToProcess = await prisma.customer.findMany({
        where: {
          follow_up: true,
          last_message_sent: { not: null },
        },
        include: {
          followUpSent: true,
        },
      });

      if (customersToProcess.length === 0) {
        logger.info(
          "📊 [FollowUp] Nenhum cliente elegível (follow_up ativo e last_message_sent preenchido)",
        );
        return;
      }

      const customerGroups = new Map<
        string,
        {
          normalizedPhone: string;
          aliases: string[];
          customerNames: string[];
          lastMessageSent: Date;
        }
      >();

      for (const customer of customersToProcess) {
        if (!customer.last_message_sent) continue;
        const normalizedPhone = this.normalizePhoneForWhatsApp(customer.number);
        if (!normalizedPhone) continue;

        const existing = customerGroups.get(normalizedPhone);
        if (!existing) {
          customerGroups.set(normalizedPhone, {
            normalizedPhone,
            aliases: [customer.number],
            customerNames: customer.name ? [customer.name] : [],
            lastMessageSent: customer.last_message_sent,
          });
          continue;
        }

        if (!existing.aliases.includes(customer.number)) {
          existing.aliases.push(customer.number);
        }
        if (customer.name && !existing.customerNames.includes(customer.name)) {
          existing.customerNames.push(customer.name);
        }
        if (customer.last_message_sent > existing.lastMessageSent) {
          existing.lastMessageSent = customer.last_message_sent;
        }
      }

      const groupedCustomers = [...customerGroups.values()];

      if (groupedCustomers.length === 0) {
        logger.info("📊 [FollowUp] Nenhum cliente válido após normalização de telefone");
        return;
      }

      logger.info(
        `📊 [FollowUp] Verificando ${groupedCustomers.length} clientes para follow-up...`,
      );

      const now = new Date();
      let processedCount = 0;

      for (const customer of groupedCustomers) {
        const diffInMinutes = Math.floor(
          (now.getTime() - customer.lastMessageSent.getTime()) /
            (1000 * 60),
        );

        const displayName = customer.customerNames[0] || "Sem nome";

        logger.info(
          `⏱️ [FollowUp] Cliente ${customer.normalizedPhone} (${displayName}): ${this.formatMinutes(diffInMinutes)} desde última mensagem`,
        );

        for (const nodeConfig of followUpNodes) {
          if (diffInMinutes < nodeConfig.inactivityMinutes) {
            continue;
          }

          const alreadySentCount = await prisma.followUpSent.count({
            where: {
              cliente_number: { in: customer.aliases },
              horas_followup: nodeConfig.inactivityMinutes,
            },
          });

          if (alreadySentCount > 0) {
            continue;
          }

          logger.info(
            `🔔 [FollowUp] Disparando follow-up de ${this.formatMinutes(nodeConfig.inactivityMinutes)} para ${customer.normalizedPhone} (node ${nodeConfig.id})`,
          );

          const activeSession = await prisma.botSession.findFirst({
            where: {
              phone: { in: customer.aliases },
            },
            orderBy: { updated_at: "desc" },
            select: {
              id: true,
              phone: true,
              is_human: true,
            },
          });

          if (!activeSession) {
            logger.info(
              `⏭️ [FollowUp] Ignorado para ${customer.normalizedPhone}: cliente sem sessão ativa no bot`,
            );
            continue;
          }

          if (activeSession?.is_human) {
            logger.info(
              `⏭️ [FollowUp] Ignorado para ${customer.normalizedPhone}: sessão em atendimento humano (is_human=true)`,
            );
            continue;
          }

          const sent = await botFlowService.triggerFollowUpNode({
            phone: activeSession.phone,
            nodeId: nodeConfig.id,
          });

          if (!sent) {
            logger.error(
              `❌ [FollowUp] Falha ao enviar follow-up para ${customer.normalizedPhone} no node ${nodeConfig.id}`,
            );
            continue;
          }

          for (const alias of customer.aliases) {
            await prisma.followUpSent.upsert({
              where: {
                cliente_number_horas_followup: {
                  cliente_number: alias,
                  horas_followup: nodeConfig.inactivityMinutes,
                },
              },
              update: { enviado_em: new Date() },
              create: {
                cliente_number: alias,
                horas_followup: nodeConfig.inactivityMinutes,
              },
            });
          }

          logger.info(
            `✅ [FollowUp] Follow-up de ${this.formatMinutes(nodeConfig.inactivityMinutes)} enviado para ${customer.normalizedPhone}`,
          );

          processedCount++;
          break;
        }
      }

      logger.info(
        `✨ [FollowUp] Rotina concluída. ${processedCount} follow-ups processados`,
      );
    } catch (error: any) {
      logger.error(
        `❌ [FollowUp] Erro na rotina de follow-up: ${error.message}`,
      );
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}

export default new FollowUpService();
