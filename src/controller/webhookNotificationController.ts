import { Request, Response } from "express";
import { webhookNotificationService } from "../services/webhookNotificationService";
import prisma from "../database/prisma";
import logger from "../utils/logger";

class WebhookNotificationController {
  

  async streamNotifications(req: Request, res: Response) {
    const { orderId } = req.params;
    const userId = (req as any).user?.id;
    const userRole = String((req as any).user?.role || "").toUpperCase();

    if (!orderId) {
      return res.status(400).json({ error: "Order ID é obrigatório" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Autenticação necessária" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { user_id: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Pedido não encontrado" });
    }

    if (userRole !== "ADMIN" && order.user_id !== userId) {
      return res.status(403).json({ error: "Você não tem permissão para acessar estas notificações" });
    }

    const payment = await prisma.payment.findUnique({
      where: { order_id: orderId },
      select: {
        id: true,
        mercado_pago_id: true,
        status: true,
        approved_at: true,
        payment_method: true,
      },
    });

    const initialPaymentUpdate = payment
      ? {
          status: payment.status.toLowerCase(),
          paymentId: payment.id,
          mercadoPagoId: payment.mercado_pago_id || undefined,
          approvedAt: payment.approved_at
            ? payment.approved_at.toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })
            : undefined,
          paymentMethod: payment.payment_method || undefined,
        }
      : undefined;

    logger.info(`📡 Nova conexão SSE para pedido: ${orderId}`);

    webhookNotificationService.registerClient(orderId, res, initialPaymentUpdate);

  }

  

  async getStats(req: Request, res: Response) {
    try {
      const stats = webhookNotificationService.getStats();
      res.json(stats);
    } catch (error) {
      logger.error("Erro ao obter estatísticas SSE:", error);
      res.status(500).json({ error: "Erro ao obter estatísticas" });
    }
  }
}

export default new WebhookNotificationController();
