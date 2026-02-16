import { Request, Response } from "express";
import { webhookNotificationService } from "../services/webhookNotificationService";

class WebhookNotificationController {
  

  async streamNotifications(req: Request, res: Response) {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ error: "Order ID é obrigatório" });
    }

    console.log(`📡 Nova conexão SSE para pedido: ${orderId}`);

    webhookNotificationService.registerClient(orderId, res);

  }

  

  async getStats(req: Request, res: Response) {
    try {
      const stats = webhookNotificationService.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Erro ao obter estatísticas SSE:", error);
      res.status(500).json({ error: "Erro ao obter estatísticas" });
    }
  }
}

export default new WebhookNotificationController();
