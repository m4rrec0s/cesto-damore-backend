import { Response } from "express";
import logger from "../utils/logger";

interface WebhookClient {
  orderId: string;
  response: Response;
  pingInterval?: NodeJS.Timeout | null;
}

/**
 * Serviço para gerenciar notificações via Server-Sent Events (SSE)
 * Permite que o frontend receba atualizações em tempo real sobre pagamentos
 */
class WebhookNotificationService {
  private clients: Map<string, WebhookClient[]> = new Map();
  private readonly CLIENT_TIMEOUT = 5 * 60 * 1000; // 5 minutos de timeout

  /**
   * Registra um cliente SSE para receber notificações de um pedido específico
   */
  registerClient(orderId: string, res: Response): void {
    logger.info(`📡 Cliente SSE registrado para pedido: ${orderId}`);

    // Configurar headers SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Accel-Buffering", "no"); // Para nginx

    // Flush headers when possible to ensure client starts receiving data immediately
    try {
      (res as any).flushHeaders?.();
    } catch {
      /* ignore */
    }

    // Enviar mensagem inicial de conexão
    res.write(`data: ${JSON.stringify({ type: "connected", orderId })}\n\n`);

    // Iniciar heartbeat para manter conexão viva (20s)
    const pingInterval = setInterval(() => {
      try {
        // comments are valid SSE to keep NAT/proxy alive
        res.write(`: ping\n\n`);
      } catch (err) {
        logger.warn("🔔 Erro ao enviar ping SSE:", err);
      }
    }, 20000);

    // Configurar timeout para desconectar automaticamente após período de inatividade
    const timeoutHandle = setTimeout(() => {
      logger.info(`⏱️ Timeout SSE para pedido ${orderId} - fechando conexão`);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }, this.CLIENT_TIMEOUT);

    // Adicionar cliente à lista
    const clients = this.clients.get(orderId) || [];
    clients.push({ orderId, response: res, pingInterval });
    this.clients.set(orderId, clients);

    // Remover cliente quando a conexão for fechada
    res.on("close", () => {
      logger.info(`❌ Cliente SSE desconectado para pedido: ${orderId}`);
      clearTimeout(timeoutHandle);
      this.removeClient(orderId, res);
    });
  }

  /**
   * Remove um cliente específico da lista de notificações
   */
  private removeClient(orderId: string, res: Response): void {
    const clients = this.clients.get(orderId) || [];
    const filtered = clients.filter((client) => {
      if (client.response === res) {
        if (client.pingInterval) {
          clearInterval(client.pingInterval);
          client.pingInterval = null;
        }
        return false; // remove this client
      }
      return true;
    });

    if (filtered.length === 0) {
      this.clients.delete(orderId);
    } else {
      this.clients.set(orderId, filtered);
    }
  }

  /**
   * Notifica todos os clientes conectados sobre uma atualização de pagamento
   */
  notifyPaymentUpdate(
    orderId: string,
    data: {
      status: string;
      paymentId?: string;
      mercadoPagoId?: string;
      approvedAt?: string;
      paymentMethod?: string;
    }
  ): void {
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

    // Enviar para todos os clientes conectados
    clients.forEach((client, index) => {
      try {
        client.response.write(`data: ${JSON.stringify(message)}\n\n`);
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

  /**
   * Notifica sobre erro no processamento do pagamento
   */
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

  /**
   * Retorna estatísticas sobre clientes conectados
   */
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

  /**
   * Limpa conexões mortas (para manutenção periódica)
   */
  cleanupDeadConnections(): void {
    let totalCleaned = 0;

    this.clients.forEach((clients, orderId) => {
      const activePreviously = clients.length;
      const filtered = clients.filter((client) => {
        try {
          // Tentar escrever um comentário para verificar se a conexão está viva
          client.response.write(`: health-check\n\n`);
          return true;
        } catch {
          // Conexão está morta, remover
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
