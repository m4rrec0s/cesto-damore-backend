import { Response } from "express";
import inventoryService from "../services/inventoryService";
import { AuthenticatedRequest } from "../middleware/security";
import logger from "../utils/logger";

class InventoryController {
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const perPage = parseInt(req.query.per_page as string, 10) || 20;
      const search = (req.query.search as string) || "";
      const status = req.query.status as
        | "in_stock"
        | "low_stock"
        | "out_of_stock"
        | undefined;

      const result = await inventoryService.listInventory({
        page,
        perPage,
        search,
        status,
      });

      return res.json(result);
    } catch (error: any) {
      logger.error("Error listing inventory:", error);
      return res.status(500).json({ error: error.message || "Erro interno" });
    }
  }

  async adjust(req: AuthenticatedRequest, res: Response) {
    try {
      const { entity_id, operation, quantity, reason } = req.body;
      const adminId = req.user?.id;

      if (!entity_id || !operation || !reason) {
        return res.status(400).json({
          error: "Campos obrigatórios: entity_id, operation, reason",
        });
      }

      const result = await inventoryService.adjustStock({
        entityId: entity_id,
        operation,
        quantity,
        reason,
        adminId,
      });

      return res.json(result);
    } catch (error: any) {
      logger.error("Error adjusting stock:", error);
      const statusCode =
        error.message?.includes("não encontrado") ||
        error.message?.includes("invál") ||
        error.message?.includes("obrigatório")
          ? 400
          : 500;
      return res.status(statusCode).json({ error: error.message || "Erro interno" });
    }
  }

  async history(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const perPage = parseInt(req.query.per_page as string, 10) || 20;
      const itemId = req.query.item_id as string | undefined;

      const result = await inventoryService.getMovementHistory({
        page,
        perPage,
        itemId,
      });

      return res.json(result);
    } catch (error: any) {
      logger.error("Error listing inventory history:", error);
      return res.status(500).json({ error: error.message || "Erro interno" });
    }
  }
}

export default new InventoryController();
