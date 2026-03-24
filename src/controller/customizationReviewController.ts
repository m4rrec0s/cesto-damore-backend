import { Request, Response } from "express";
import orderCustomizationService from "../services/orderCustomizationService";
import prisma from "../database/prisma";
import logger from "../utils/logger";

class CustomizationReviewController {
    async getReviewData(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const userId = (req as any).user?.id;
            const userRole = String((req as any).user?.role || "").toUpperCase();

            if (!orderId) {
                return res.status(400).json({ error: "orderId é obrigatório" });
            }

            if (!userId) {
                return res.status(401).json({ error: "Autenticação necessária" });
            }

            logger.info(`🔍 [CustomizationReviewController] Buscando dados de revisão para orderId=${orderId}`);

            const order = await prisma.order.findUnique({
                where: { id: orderId },
                select: { user_id: true },
            });

            if (!order) {
                return res.status(404).json({ error: "Pedido não encontrado" });
            }

            if (userRole !== "ADMIN" && order.user_id !== userId) {
                return res.status(403).json({ error: "Você não tem permissão para acessar esta revisão" });
            }

            const reviewData = await orderCustomizationService.getOrderReviewData(orderId);

            return res.json(reviewData);
        } catch (error: any) {
            logger.error("❌ [CustomizationReviewController] Erro ao buscar dados de revisão:", error);
            return res.status(500).json({
                error: "Erro ao buscar dados de revisão",
                details: "Erro interno do servidor",
            });
        }
    }
}

export default new CustomizationReviewController();
