import { Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../database/prisma";
import logger from "../utils/logger";

interface AdminClient {
  id: string;
  response: Response;
  pingInterval: NodeJS.Timeout;
}

const REDIS_CHANNEL = "admin:notifications";

class AdminNotificationService {
  private clients: AdminClient[] = [];
  private redisSub: import("ioredis").default | null = null;
  private redisPub: import("ioredis").default | null = null;

  constructor() {
    this.initRedis();
  }

  private async initRedis() {
    try {
      const IORedis = (await import("ioredis")).default;
      const url = process.env.REDIS_URL;
      if (!url) {
        logger.warn("📡 Admin SSE: REDIS_URL não configurado — SSE funciona apenas na instância local");
        return;
      }

      // Publisher
      this.redisPub = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
      await this.redisPub.connect().catch(() => {});

      // Subscriber (conexão separada, exigido pelo Redis)
      this.redisSub = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
      await this.redisSub.connect().catch(() => {});

      await this.redisSub.subscribe(REDIS_CHANNEL);
      this.redisSub.on("message", (_channel, message) => {
        this.broadcastToLocalClients(message);
      });

      logger.info("📡 Admin SSE: Redis pub/sub conectado — notificações globais ativas");
    } catch (error) {
      logger.warn("📡 Admin SSE: Falha ao conectar Redis — SSE funciona apenas na instância local", error);
    }
  }

  private broadcastToLocalClients(message: string) {
    for (const client of [...this.clients]) {
      try {
        client.response.write(`data: ${message}\n\n`);
      } catch {
        this.removeClient(client.id);
      }
    }
  }

  async registerClient(res: Response): Promise<void> {
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
    logger.info(`📡 Admin SSE conectado (${this.clients.length} clientes nesta instância)`);

    res.on("close", () => this.removeClient(id));

    // Enviar notificações pendentes (não vistas) ao conectar
    try {
      const pendingNotifications = await prisma.adminNotification.findMany({
        where: { seen: false },
        orderBy: { created_at: "desc" },
        take: 50,
      });

      if (pendingNotifications.length > 0) {
        const message = JSON.stringify({ type: "pending_notifications", notifications: pendingNotifications });
        res.write(`data: ${message}\n\n`);
        logger.info(`📡 Admin SSE: ${pendingNotifications.length} notificação(ões) pendente(s) enviada(s) ao conectar`);
      }
    } catch (error) {
      logger.error("Erro ao buscar notificações pendentes:", error);
    }
  }

  private removeClient(id: string): void {
    const idx = this.clients.findIndex(c => c.id === id);
    if (idx !== -1) {
      clearInterval(this.clients[idx].pingInterval);
      this.clients.splice(idx, 1);
      logger.info(`📡 Admin SSE desconectado (${this.clients.length} clientes nesta instância)`);
    }
  }

  async notifyNewPaidOrder(data: {
    orderId: string;
    customerName: string;
    total: number;
    itemsCount: number;
    deliveryDate?: string;
    paymentMethod?: string;
  }): Promise<void> {
    const totalText = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.total);
    const deliveryText = data.deliveryDate
      ? new Date(data.deliveryDate).toLocaleDateString("pt-BR")
      : "Sem data";

    // 1. Persistir notificação no banco
    let dbNotification: { id: string; created_at: Date } | null = null;
    try {
      dbNotification = await prisma.adminNotification.create({
        data: {
          type: "order_paid",
          title: `🛒 Novo Pedido - ${data.customerName}`,
          message: `Entrega: ${deliveryText} • ${data.itemsCount} item(s) • ${totalText}`,
          order_id: data.orderId,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      logger.error("Erro ao persistir notificação no banco:", error);
    }

    // 2. Web Push (funciona mesmo com aba fechada)
    import("./webPushService").then(({ webPushService }) => {
      webPushService.sendToAll({
        title: `🛒 Novo Pedido - ${data.customerName}`,
        body: `${data.itemsCount} item(s) • ${totalText}`,
        orderId: data.orderId,
        url: `/orders?orderId=${data.orderId}`,
      });
    }).catch(() => {});

    // 3. SSE via Redis pub/sub (global) ou fallback local
    const ssePayload = dbNotification
      ? { type: "order_paid", ...data, notificationId: dbNotification.id, createdAt: dbNotification.created_at.toISOString() }
      : { type: "order_paid", ...data };

    const message = JSON.stringify(ssePayload);

    if (this.redisPub) {
      // Publicar para TODAS as instâncias via Redis
      this.redisPub.publish(REDIS_CHANNEL, message).catch(() => {
        // Fallback: enviar localmente se Redis falhar
        this.broadcastToLocalClients(message);
      });
      logger.info(`📡 Admin SSE: notificação order_paid publicada via Redis (global)`);
    } else {
      // Sem Redis: enviar apenas para clientes desta instância
      this.broadcastToLocalClients(message);
      logger.info(`📡 Admin SSE: notificação order_paid enviada para ${this.clients.length} cliente(s) (local apenas)`);
    }
  }

  async getNotifications(options?: { seen?: boolean; limit?: number; offset?: number }) {
    const where = options?.seen !== undefined ? { seen: options.seen } : {};
    const [notifications, total] = await Promise.all([
      prisma.adminNotification.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      }),
      prisma.adminNotification.count({ where }),
    ]);
    return { notifications, total };
  }

  async markAsSeen(notificationId: string): Promise<void> {
    await prisma.adminNotification.update({
      where: { id: notificationId },
      data: { seen: true },
    });
  }

  async markAllAsSeen(): Promise<void> {
    await prisma.adminNotification.updateMany({
      where: { seen: false },
      data: { seen: true },
    });
  }

  async clearAll(): Promise<void> {
    await prisma.adminNotification.deleteMany();
  }
}

export const adminNotificationService = new AdminNotificationService();
