import webpush from "web-push";
import prisma from "../database/prisma";
import logger from "../utils/logger";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@cestodamore.com.br";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

class WebPushService {
  private subscriptions: Map<string, webpush.PushSubscription> = new Map();
  private initialized = false;

  async init() {
    if (this.initialized || !VAPID_PUBLIC_KEY) return;
    try {
      const subs = await prisma.pushSubscription.findMany();
      subs.forEach((s) => {
        this.subscriptions.set(s.id, JSON.parse(s.subscription));
      });
      this.initialized = true;
      logger.info(`📲 Web Push: ${this.subscriptions.size} subscription(s) carregadas`);
    } catch {
      // Tabela pode não existir ainda
    }
  }

  async subscribe(userId: string, subscription: webpush.PushSubscription): Promise<string> {
    const endpoint = subscription.endpoint;
    // Deduplicar por endpoint
    const existing = await prisma.pushSubscription.findFirst({
      where: { endpoint },
    });
    if (existing) {
      this.subscriptions.set(existing.id, subscription);
      return existing.id;
    }

    const record = await prisma.pushSubscription.create({
      data: {
        user_id: userId,
        endpoint,
        subscription: JSON.stringify(subscription),
      },
    });
    this.subscriptions.set(record.id, subscription);
    logger.info(`📲 Web Push: nova subscription registrada (user: ${userId})`);
    return record.id;
  }

  async sendToAll(payload: { title: string; body: string; url?: string; orderId?: string }) {
    if (!VAPID_PUBLIC_KEY || this.subscriptions.size === 0) return;

    const message = JSON.stringify(payload);
    const expired: string[] = [];

    await Promise.allSettled(
      [...this.subscriptions.entries()].map(async ([id, sub]) => {
        try {
          await webpush.sendNotification(sub, message);
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            expired.push(id);
          }
        }
      }),
    );

    if (expired.length > 0) {
      for (const id of expired) {
        this.subscriptions.delete(id);
      }
      await prisma.pushSubscription.deleteMany({
        where: { id: { in: expired } },
      });
      logger.info(`📲 Web Push: ${expired.length} subscription(s) expiradas removidas`);
    }
  }

  getPublicKey(): string {
    return VAPID_PUBLIC_KEY;
  }
}

export const webPushService = new WebPushService();
