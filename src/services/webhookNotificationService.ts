import { Response } from "express";
import logger from "../utils/logger";

interface WebhookClient {
  orderId: string;
  response: Response;
  pingInterval?: NodeJS.Timeout | null;
}

interface PaymentUpdateMessage {
  status: string;
  paymentId?: string;
  mercadoPagoId?: string;
  approvedAt?: string;
  paymentMethod?: string;
}

class WebhookNotificationService {
  private clients: Map<string, WebhookClient[]> = new Map();
  private readonly CLIENT_TIMEOUT = 5 * 60 * 1000;

  

  registerClient(
    orderId: string,
    res: Response,
    initialPaymentUpdate?: PaymentUpdateMessage,
  ): void {
    logger.info(`📡 Cliente SSE registrado para pedido: ${orderId}`);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      (res as any).flushHeaders?.();
    } catch {
      
    }

    res.write("retry: 3000\n\n");
    res.write(`data: ${JSON.stringify({ type: "connected", orderId })}\n\n`);

    if (initialPaymentUpdate) {
      this.writePaymentUpdate(orderId, res, initialPaymentUpdate, "snapshot");
    }

    const pingInterval = setInterval(() => {
      try {

        res.write(`: ping\n\n`);
      } catch (err) {
        logger.warn("🔔 Erro ao enviar ping SSE:", err);
      }
    }, 20000);

    const timeoutHandle = setTimeout(() => {
      logger.info(`⏱️ Timeout SSE para pedido ${orderId} - fechando conexão`);
      try {
        res.end();
      } catch {
        
      }
    }, this.CLIENT_TIMEOUT);

    const clients = this.clients.get(orderId) || [];
    clients.push({ orderId, response: res, pingInterval });
    this.clients.set(orderId, clients);

    res.on("close", () => {
      logger.info(`❌ Cliente SSE desconectado para pedido: ${orderId}`);
      clearTimeout(timeoutHandle);
      this.removeClient(orderId, res);
    });
  }

  

  private removeClient(orderId: string, res: Response): void {
    const clients = this.clients.get(orderId) || [];
    const filtered = clients.filter((client) => {
      if (client.response === res) {
        if (client.pingInterval) {
          clearInterval(client.pingInterval);
          client.pingInterval = null;
        }
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      this.clients.delete(orderId);
    } else {
      this.clients.set(orderId, filtered);
    }
  }

  

  notifyPaymentUpdate(orderId: string, data: PaymentUpdateMessage): void {
    const clients = this.clients.get(orderId);

    if (!clients || clients.length === 0) {
      logger.info(`ℹ️ Nenhum cliente SSE conectado para pedido: ${orderId}`);
      return;
    }

    logger.debug(
      `📤 Enviando notificação SSE para ${clients.length} cliente(s) - Pedido: ${orderId}`
    );

    const message = {
      type: "payment_update",
      orderId,
      timestamp: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }),
      ...data,
    };

    clients.forEach((client, index) => {
      try {
        this.writePaymentUpdate(orderId, client.response, data, "realtime");
        logger.info(`✅ Notificação enviada para cliente ${index + 1}`);
      } catch (error) {
        logger.error(
          `❌ Erro ao enviar notificação para cliente ${index + 1}:`,
          error
        );
        this.removeClient(orderId, client.response);
      }
    });
  }

  private writePaymentUpdate(
    orderId: string,
    response: Response,
    data: PaymentUpdateMessage,
    source: "snapshot" | "realtime",
  ): void {
    const message = {
      type: "payment_update",
      orderId,
      source,
      timestamp: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }),
      ...data,
    };
    response.write(`data: ${JSON.stringify(message)}\n\n`);
  }

  

  notifyPaymentError(
    orderId: string,
    error: {
      message: string;
      code?: string;
    }
  ): void {
    const clients = this.clients.get(orderId);

    if (!clients || clients.length === 0) {
      return;
    }

    const message = {
      type: "payment_error",
      orderId,
      timestamp: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }),
      error,
    };

    clients.forEach((client) => {
      try {
        client.response.write(`data: ${JSON.stringify(message)}\n\n`);
      } catch (error) {
        logger.error("Erro ao enviar notificação de erro:", error);
        this.removeClient(orderId, client.response);
      }
    });
  }

  

  getStats() {
    return {
      totalOrders: this.clients.size,
      totalClients: Array.from(this.clients.values()).reduce(
        (sum, clients) => sum + clients.length,
        0
      ),
      orders: Array.from(this.clients.entries()).map(([orderId, clients]) => ({
        orderId,
        clientCount: clients.length,
      })),
    };
  }

  

  cleanupDeadConnections(): void {
    let totalCleaned = 0;

    this.clients.forEach((clients, orderId) => {
      const activePreviously = clients.length;
      const filtered = clients.filter((client) => {
        try {

          client.response.write(`: health-check\n\n`);
          return true;
        } catch {

          if (client.pingInterval) {
            clearInterval(client.pingInterval);
            client.pingInterval = null;
          }
          totalCleaned++;
          return false;
        }
      });

      if (filtered.length === 0) {
        this.clients.delete(orderId);
        logger.info(
          `🧹 Removidas ${activePreviously} conexão(ões) morta(s) do pedido ${orderId}`
        );
      } else if (filtered.length < activePreviously) {
        this.clients.set(orderId, filtered);
      }
    });

    if (totalCleaned > 0) {
      logger.info(
        `🧹 Limpeza de SSE: ${totalCleaned} conexão(ões) morta(s) removida(s)`
      );
    }
  }
}

export const webhookNotificationService = new WebhookNotificationService();
