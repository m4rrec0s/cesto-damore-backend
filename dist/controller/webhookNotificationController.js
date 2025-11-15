"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webhookNotificationService_1 = require("../services/webhookNotificationService");
class WebhookNotificationController {
    /**
     * Endpoint SSE para o frontend se conectar e receber atualizações em tempo real
     * GET /api/webhooks/notifications/:orderId
     */
    async streamNotifications(req, res) {
        const { orderId } = req.params;
        if (!orderId) {
            return res.status(400).json({ error: "Order ID é obrigatório" });
        }
        console.log(`📡 Nova conexão SSE para pedido: ${orderId}`);
        // Registrar cliente e manter conexão aberta
        webhookNotificationService_1.webhookNotificationService.registerClient(orderId, res);
        // A conexão será mantida aberta até o cliente desconectar
        // Não enviar res.end() aqui
    }
    /**
     * Endpoint para obter estatísticas de conexões SSE ativas
     * GET /api/webhooks/notifications/stats
     */
    async getStats(req, res) {
        try {
            const stats = webhookNotificationService_1.webhookNotificationService.getStats();
            res.json(stats);
        }
        catch (error) {
            console.error("Erro ao obter estatísticas SSE:", error);
            res.status(500).json({ error: "Erro ao obter estatísticas" });
        }
    }
}
exports.default = new WebhookNotificationController();
