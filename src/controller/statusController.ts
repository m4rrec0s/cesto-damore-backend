import { Request, Response } from "express";
import statusService from "../services/statusService";

class StatusController {
    async getBusinessStatus(req: Request, res: Response) {
        try {
            const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
            const status = await statusService.getBusinessStatus(days);
            const topProducts = await statusService.getTopSellingProducts(5);

            res.json({
                success: true,
                data: {
                    ...status,
                    top_products: topProducts,
                },
            });
        } catch (error: any) {
            console.error("Erro no StatusController:", error);
            res.status(500).json({
                success: false,
                error: "Falha ao buscar status do negócio",
                details: error.message,
            });
        }
    }
}

export default new StatusController();
