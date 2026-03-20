import prisma from "../database/prisma";
import logger from "../utils/logger";
import { botFlowService } from "./botFlowService";

type BotHistoryEntry = {
  role?: string;
  text?: string;
  created_at?: string;
};

type BotSessionSyncRow = {
  phone: string;
  state: unknown;
  history: unknown;
};

type BotSessionSyncData = {
  lastMessageAt: Date;
  customerName?: string | null;
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

    if (
      digits.startsWith("55") &&
      (digits.length === 12 || digits.length === 13)
    ) {
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

  private resolveFollowUpInactivityMinutes(
    nodeData: Record<string, any>,
  ): number {
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

  private normalizeCustomerName(value?: unknown): string | null {
    const normalized = String(value ?? "").trim();

    if (!normalized) return null;
    if (normalized.toLowerCase() === "cliente") return null;

    return normalized;
  }

  private resolveCustomerNameFromSession(
    session: BotSessionSyncRow,
  ): string | null {
    const state = session.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return null;
    }

    const stateRecord = state as Record<string, unknown>;
    return this.normalizeCustomerName(
      stateRecord.contactName ?? stateRecord.customerName ?? stateRecord.name,
    );
  }

  private async upsertLatestMessageByPhone(
    latestByPhone: Map<string, BotSessionSyncData>,
  ): Promise<Set<string>> {
    if (latestByPhone.size === 0) {
      return new Set<string>();
    }

    const phones = [...latestByPhone.keys()];
    const existingCustomers = await prisma.customer.findMany({
      where: { number: { in: phones } },
      select: { number: true, name: true, last_message_sent: true },
    });

    const existingMap = new Map(
      existingCustomers.map((customer) => [customer.number, customer]),
    );
    const updatedPhones = new Set<string>();

    for (const [phone, syncData] of latestByPhone.entries()) {
      const { lastMessageAt, customerName } = syncData;
      const existing = existingMap.get(phone);

      if (!existing) {
        await prisma.customer.create({
          data: {
            number: phone,
            name: customerName ?? null,
            follow_up: true,
            last_message_sent: lastMessageAt,
          },
        });
        updatedPhones.add(phone);
        continue;
      }

      const isNewer =
        !existing.last_message_sent ||
        lastMessageAt > existing.last_message_sent;
      const shouldUpdateName =
        !!customerName && !String(existing.name || "").trim();

      if (!isNewer && !shouldUpdateName) continue;

      await prisma.customer.update({
        where: { number: phone },
        data: {
          ...(shouldUpdateName ? { name: customerName } : {}),
          ...(isNewer ? { last_message_sent: lastMessageAt } : {}),
        },
      });

      if (isNewer) {
        // Reinicia o ciclo de follow-up quando chega nova mensagem do cliente
        await prisma.followUpSent.deleteMany({
          where: { cliente_number: phone },
        });
      }

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
        state: true,
        history: true,
      },
    });

    if (sessions.length === 0) {
      return new Set<string>();
    }

    const latestByPhone = new Map<string, BotSessionSyncData>();

    sessions.forEach((session) => {
      const history = Array.isArray(session.history)
        ? (session.history as BotHistoryEntry[])
        : [];
      const customerName = this.resolveCustomerNameFromSession(session);

      const lastUserMessageAt = history
        .filter((entry) => (entry.role || "").toLowerCase() === "user")
        .map((entry) => this.toValidDate(entry.created_at))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      if (!lastUserMessageAt) return;

      const current = latestByPhone.get(session.phone);
      if (!current || lastUserMessageAt > current.lastMessageAt) {
        latestByPhone.set(session.phone, {
          lastMessageAt: lastUserMessageAt,
          customerName: customerName ?? current?.customerName ?? null,
        });
        return;
      }

      if (!current.customerName && customerName) {
        latestByPhone.set(session.phone, {
          ...current,
          customerName,
        });
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
      logger.info(
        "⏳ [FollowUp] Rotina já em execução, pulando ciclo concorrente",
      );
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
        logger.info(
          "📊 [FollowUp] Nenhum cliente válido após normalização de telefone",
        );
        return;
      }

      const now = new Date();
      let processedCount = 0;

      for (const customer of groupedCustomers) {
        const diffInMinutes = Math.floor(
          (now.getTime() - customer.lastMessageSent.getTime()) / (1000 * 60),
        );

        const displayName = customer.customerNames[0] || "Sem nome";

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
            continue;
          }

          if (activeSession?.is_human) {
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
