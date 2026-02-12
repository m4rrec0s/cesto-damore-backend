import { Request, Response } from "express";
import trendStatsService from "../services/trendStatsService";

class TrendStatsController {
  async getSummary(req: Request, res: Response) {
    try {
      const summary = await trendStatsService.getTrendSummary();
      res.json(summary);
    } catch (error: any) {
      console.error("Erro ao buscar tendencias:", error);
      res.status(500).json({
        error: "Erro interno ao buscar tendencias",
        details: error.message,
      });
    }
  }
}

export default new TrendStatsController();
