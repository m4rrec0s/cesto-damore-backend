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
  inactivityHours: number;
};

class FollowUpService {
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
        const configuredHours = Number(node?.data?.inactivityHours);
        if (!Number.isFinite(configuredHours) || configuredHours <= 0) {
          return null;
        }

        return {
          id: String(node.id),
          inactivityHours: Math.round(configuredHours),
        } satisfies FollowUpNodeConfig;
      })
      .filter((item): item is FollowUpNodeConfig => Boolean(item))
      .sort((a, b) => a.inactivityHours - b.inactivityHours);

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
    try {
      const [eligiblePhones, followUpNodes] = await Promise.all([
        this.syncLastMessageFromBotSessions(),
        this.getFollowUpNodeConfigs(),
      ]);

      if (eligiblePhones.size === 0) {
        logger.info("📊 [FollowUp] Nenhum telefone elegível no Bot Session");
        return;
      }

      if (followUpNodes.length === 0) {
        logger.info("📊 [FollowUp] Nenhum nó Follow Up configurado no fluxo");
        return;
      }

      const customersToProcess = await prisma.customer.findMany({
        where: {
          number: { in: [...eligiblePhones] },
          follow_up: true,
          last_message_sent: { not: null },
        },
        include: {
          followUpSent: true,
        },
      });

      logger.info(
        `📊 [FollowUp] Verificando ${customersToProcess.length} clientes para follow-up...`,
      );

      const now = new Date();
      let processedCount = 0;

      for (const customer of customersToProcess) {
        if (!customer.last_message_sent) continue;

        const diffInHours = Math.floor(
          (now.getTime() - customer.last_message_sent.getTime()) /
            (1000 * 60 * 60),
        );

        logger.info(
          `⏱️ [FollowUp] Cliente ${customer.number} (${customer.name}): ${diffInHours}h desde última mensagem`,
        );

        for (const nodeConfig of followUpNodes) {
          if (diffInHours < nodeConfig.inactivityHours) {
            continue;
          }

          const jaEnviado = customer.followUpSent.some(
            (sent) => sent.horas_followup === nodeConfig.inactivityHours,
          );

          if (jaEnviado) {
            continue;
          }

          logger.info(
            `🔔 [FollowUp] Disparando follow-up de ${nodeConfig.inactivityHours}h para ${customer.number} (node ${nodeConfig.id})`,
          );

          const sent = await botFlowService.triggerFollowUpNode({
            phone: customer.number,
            nodeId: nodeConfig.id,
          });

          if (!sent) {
            logger.error(
              `❌ [FollowUp] Falha ao enviar follow-up para ${customer.number} no node ${nodeConfig.id}`,
            );
            continue;
          }

          await prisma.followUpSent.create({
            data: {
              cliente_number: customer.number,
              horas_followup: nodeConfig.inactivityHours,
            },
          });

          logger.info(
            `✅ [FollowUp] Follow-up de ${nodeConfig.inactivityHours}h enviado para ${customer.number}`,
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
    }
  }
}

export default new FollowUpService();
