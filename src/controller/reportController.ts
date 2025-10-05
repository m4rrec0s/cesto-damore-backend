import { Request, Response } from "express";
import reportService from "../services/reportService";

class ReportController {
  /**
   * GET /reports/stock?threshold=5
   * Retorna relatório de estoque com itens abaixo do limite
   */
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

  /**
   * GET /reports/stock/critical
   * Retorna apenas itens com estoque crítico (zerado)
   */
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

  /**
   * GET /reports/stock/check?threshold=3
   * Verifica se há itens abaixo do limite (usado para notificações)
   */
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
