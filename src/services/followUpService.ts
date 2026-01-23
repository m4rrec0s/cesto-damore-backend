import prisma from "../database/prisma";
import logger from "../utils/logger";
import axios from "axios";

class FollowUpService {
    private readonly intervals = [2, 24, 48];
    private readonly n8nWebhookUrl = "https://n8n.cestodamore.com.br/webhook/followup";

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
            logger.info("⏳ [FollowUp] Iniciando rotina de follow-up automático...");

            // Buscar clientes com follow-up ativo que tenham uma sessão de IA ativa
            const customersToProcess = await prisma.customer.findMany({
                where: {
                    follow_up: true,
                    last_message_sent: { not: null },
                    aiAgentSession: { isNot: null } // Restringe a apenas quem tem sessão com IA
                },
                include: {
                    followUpSent: true
                }
            });

            const now = new Date();
            let processedCount = 0;

            for (const customer of customersToProcess) {
                if (!customer.last_message_sent) continue;

                const diffInHours = Math.floor((now.getTime() - customer.last_message_sent.getTime()) / (1000 * 60 * 60));
                let jaEnviouUltimo = false;

                for (const intervalo of this.intervals) {
                    // Verifica se já passou o tempo E se ainda não enviou esse intervalo específico
                    if (diffInHours >= intervalo) {
                        const jaEnviado = customer.followUpSent.some(s => s.horas_followup === intervalo);

                        if (!jaEnviado) {
                            logger.info(`📤 [FollowUp] Disparando follow-up de ${intervalo}h para ${customer.number} (Inatividade: ${diffInHours}h)`);

                            try {
                                // Registrar envio antes para evitar duplicidade em caso de erro no webhook
                                await prisma.followUpSent.create({
                                    data: {
                                        cliente_number: customer.number,
                                        horas_followup: intervalo
                                    }
                                });

                                // Chamar webhook n8n
                                await axios.post(this.n8nWebhookUrl, {
                                    cliente_number: customer.number,
                                    horas_apos_ultima_mensagem: intervalo,
                                    link_instagram: intervalo === 48
                                });

                                if (intervalo === 48) jaEnviouUltimo = true;
                                processedCount++;
                            } catch (error: any) {
                                logger.error(`❌ [FollowUp] Erro ao processar intervalo ${intervalo}h para ${customer.number}: ${error.message}`);
                            }
                        }
                    }
                }

                // Desativa follow-up se atingiu o último estágio
                if (jaEnviouUltimo) {
                    await prisma.customer.update({
                        where: { number: customer.number },
                        data: { follow_up: false }
                    });
                    logger.info(`✅ [FollowUp] Ciclo completo para ${customer.number}. Follow-up desativado.`);
                }
            }

            logger.info(`✅ [FollowUp] Rotina concluída. ${processedCount} ações disparadas.`);
        } catch (error: any) {
            logger.error(`❌ [FollowUp] Erro na rotina de follow-up: ${error.message}`);
            throw error;
        }
    }
}

export default new FollowUpService();
