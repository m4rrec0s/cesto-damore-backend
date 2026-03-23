import { Request, Response } from "express";
import trendStatsService from "../services/trendStatsService";
import logger from "../utils/logger";

class TrendStatsController {
  async getSummary(req: Request, res: Response) {
    try {
      const summary = await trendStatsService.getTrendSummary();
      res.json(summary);
    } catch (error: any) {
      logger.error("Erro ao buscar tendencias:", error);
      res.status(500).json({
        error: "Erro interno ao buscar tendencias",
        details: "Erro interno do servidor",
      });
    }
  }
}

export default new TrendStatsController();
