import prisma from "../database/prisma";
import logger from "../utils/logger";

class FollowUpService {
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
            logger.info("⏳ [FollowUp] Disparando função SQL disparar_followup()...");
            await prisma.$executeRawUnsafe("SELECT disparar_followup();");
            logger.info("✅ [FollowUp] Função disparar_followup() executada com sucesso.");
        } catch (error: any) {
            logger.error(`❌ [FollowUp] Erro ao disparar_followup(): ${error.message}`);
            throw error;
        }
    }
}

export default new FollowUpService();
