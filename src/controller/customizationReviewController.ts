import { Request, Response } from "express";
import orderCustomizationService from "../services/orderCustomizationService";
import logger from "../utils/logger";

class CustomizationReviewController {
    async getReviewData(req: Request, res: Response) {
        try {
            const { orderId } = req.params;

            if (!orderId) {
                return res.status(400).json({ error: "orderId é obrigatório" });
            }

            logger.info(`🔍 [CustomizationReviewController] Buscando dados de revisão para orderId=${orderId}`);

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
