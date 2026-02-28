import prisma from "../database/prisma";
import logger from "../utils/logger";
import axios from "axios";

type N8nLatestCustomerMessageRow = {
  session_id: string;
  last_human_message_at: Date | null;
};

class FollowUpService {
  private readonly intervals = [2, 24, 48];
  private readonly n8nWebhookUrl =
    "https://n8n.cestodamore.com.br/webhook/followup";

  private extractPhoneFromSessionId(sessionId: string): string | null {
    const extracted = sessionId.match(/^session-(\d+)$/)?.[1];
    return extracted || null;
  }

  private async syncLastMessageFromN8nHistories() {
    const rows = await prisma.$queryRaw<N8nLatestCustomerMessageRow[]>`
      SELECT
        session_id,
        MAX("createdAt") AS last_human_message_at
      FROM n8n_chat_histories
      WHERE LOWER(COALESCE(message->>'type', message->>'role', '')) IN ('human', 'user')
      GROUP BY session_id
    `;

    if (rows.length === 0) {
      return;
    }

    const sessionIds = rows.map((row) => row.session_id);
    const sessions = await prisma.aIAgentSession.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, customer_phone: true },
    });

    const sessionPhoneMap = new Map(
      sessions.map((session) => [session.id, session.customer_phone]),
    );

    const latestByPhone = new Map<string, Date>();

    rows.forEach((row) => {
      if (!row.last_human_message_at) return;

      const mappedPhone =
        sessionPhoneMap.get(row.session_id) ||
        this.extractPhoneFromSessionId(row.session_id);

      if (!mappedPhone) return;

      const current = latestByPhone.get(mappedPhone);
      if (!current || row.last_human_message_at > current) {
        latestByPhone.set(mappedPhone, row.last_human_message_at);
      }
    });

    if (latestByPhone.size === 0) {
      return;
    }

    const phones = [...latestByPhone.keys()];
    const existingCustomers = await prisma.customer.findMany({
      where: { number: { in: phones } },
      select: { number: true, last_message_sent: true },
    });

    const existingMap = new Map(
      existingCustomers.map((customer) => [customer.number, customer]),
    );

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
        continue;
      }

      if (
        !existing.last_message_sent ||
        latestMessageAt > existing.last_message_sent
      ) {
        await prisma.customer.update({
          where: { number: phone },
          data: {
            follow_up: true,
            last_message_sent: latestMessageAt,
          },
        });
      }
    }
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
      await this.syncLastMessageFromN8nHistories();

      const customersToProcess = await prisma.customer.findMany({
        where: {
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

        let jaEnviouUltimo = false;

        for (const intervalo of this.intervals) {
          if (diffInHours >= intervalo) {
            const jaEnviado = customer.followUpSent.some(
              (s) => s.horas_followup === intervalo,
            );

            if (!jaEnviado) {
              try {
                logger.info(
                  `🔔 [FollowUp] Disparando follow-up de ${intervalo}h para ${customer.number}`,
                );

                await prisma.followUpSent.create({
                  data: {
                    cliente_number: customer.number,
                    horas_followup: intervalo,
                  },
                });

                await axios.post(this.n8nWebhookUrl, {
                  cliente_number: customer.number,
                  horas_apos_ultima_mensagem: intervalo,
                  link_instagram: intervalo === 48,
                });

                logger.info(
                  `✅ [FollowUp] Follow-up de ${intervalo}h enviado para ${customer.number}`,
                );

                if (intervalo === 48) jaEnviouUltimo = true;
                processedCount++;
              } catch (error: any) {
                logger.error(
                  `❌ [FollowUp] Erro ao processar intervalo ${intervalo}h para ${customer.number}: ${error.message}`,
                );
              }
            }
          }
        }

        if (jaEnviouUltimo) {

          await prisma.followUpSent.deleteMany({
            where: { cliente_number: customer.number },
          });

          await prisma.customer.update({
            where: { number: customer.number },
            data: { follow_up: false },
          });

          logger.info(
            `🔒 [FollowUp] Follow-up desativado e histórico resetado para ${customer.number} (ciclo completo)`,
          );
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
