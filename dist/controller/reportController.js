"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const reportService_1 = __importDefault(require("../services/reportService"));
class ReportController {
    /**
     * GET /reports/stock?threshold=5
     * Retorna relatório de estoque com itens abaixo do limite
     */
    async getStockReport(req, res) {
        try {
            const threshold = parseInt(req.query.threshold) || 5;
            const report = await reportService_1.default.getStockReport(threshold);
            return res.json(report);
        }
        catch (error) {
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
    async getCriticalStock(req, res) {
        try {
            const criticalItems = await reportService_1.default.getCriticalStock();
            return res.json({
                items: criticalItems,
                total: criticalItems.length,
            });
        }
        catch (error) {
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
    async checkLowStock(req, res) {
        try {
            const threshold = parseInt(req.query.threshold) || 3;
            const result = await reportService_1.default.hasItemsBelowThreshold(threshold);
            return res.json(result);
        }
        catch (error) {
            console.error("Erro ao verificar estoque baixo:", error);
            return res.status(500).json({
                error: "Erro ao verificar estoque baixo",
                message: error.message,
            });
        }
    }
}
exports.default = new ReportController();
