import { Request, Response } from "express";
import reportService from "../services/reportService";

class ReportController {
  

  async getStockReport(req: Request, res: Response) {
    try {
      const threshold = parseInt(req.query.threshold as string) || 5;

      const report = await reportService.getStockReport(threshold);

      return res.json(report);
    } catch (error: any) {
      console.error("Erro ao gerar relatório de estoque:", error);
      return res.status(500).json({
        error: "Erro ao gerar relatório de estoque",
        message: error.message,
      });
    }
  }

  

  async getCriticalStock(req: Request, res: Response) {
    try {
      const criticalItems = await reportService.getCriticalStock();

      return res.json({
        items: criticalItems,
        total: criticalItems.length,
      });
    } catch (error: any) {
      console.error("Erro ao buscar estoque crítico:", error);
      return res.status(500).json({
        error: "Erro ao buscar estoque crítico",
        message: error.message,
      });
    }
  }

  

  async checkLowStock(req: Request, res: Response) {
    try {
      const threshold = parseInt(req.query.threshold as string) || 3;

      const result = await reportService.hasItemsBelowThreshold(threshold);

      return res.json(result);
    } catch (error: any) {
      console.error("Erro ao verificar estoque baixo:", error);
      return res.status(500).json({
        error: "Erro ao verificar estoque baixo",
        message: error.message,
      });
    }
  }
}

export default new ReportController();
