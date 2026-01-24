import prisma from "../database/prisma";
import logger from "../utils/logger";
import axios from "axios";

class FollowUpService {
  private readonly intervals = [2, 24, 48];
  private readonly n8nWebhookUrl =
    "https://n8n.cestodamore.com.br/webhook/followup";

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
          await prisma.customer.update({
            where: { number: customer.number },
            data: { follow_up: false },
          });

          logger.info(
            `🔒 [FollowUp] Follow-up desativado para ${customer.number} (ciclo completo)`,
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
