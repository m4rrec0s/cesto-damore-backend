import { Response } from "express";
import logger from "../utils/logger";

interface AdminClient {
  id: string;
  response: Response;
  pingInterval: NodeJS.Timeout;
}

class AdminNotificationService {
  private clients: AdminClient[] = [];

  registerClient(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Accel-Buffering", "no");
    try { (res as any).flushHeaders?.(); } catch {}

    res.write("retry: 5000\n\n");
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    const id = `${Date.now()}-${Math.random()}`;
    const pingInterval = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { this.removeClient(id); }
    }, 25000);

    this.clients.push({ id, response: res, pingInterval });
    logger.info(`📡 Admin SSE conectado (${this.clients.length} clientes)`);

    res.on("close", () => this.removeClient(id));
  }

  private removeClient(id: string): void {
    const idx = this.clients.findIndex(c => c.id === id);
    if (idx !== -1) {
      clearInterval(this.clients[idx].pingInterval);
      this.clients.splice(idx, 1);
      logger.info(`📡 Admin SSE desconectado (${this.clients.length} clientes)`);
    }
  }

  notifyNewPaidOrder(data: {
    orderId: string;
    customerName: string;
    total: number;
    itemsCount: number;
    deliveryDate?: string;
    paymentMethod?: string;
  }): void {
    if (this.clients.length === 0) return;

    const message = JSON.stringify({ type: "order_paid", ...data });
    for (const client of [...this.clients]) {
      try {
        client.response.write(`data: ${message}\n\n`);
      } catch {
        this.removeClient(client.id);
      }
    }
    logger.info(`📡 Admin SSE: notificação order_paid enviada para ${this.clients.length} cliente(s)`);
  }
}

export const adminNotificationService = new AdminNotificationService();
