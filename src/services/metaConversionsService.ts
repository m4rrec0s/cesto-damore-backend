import crypto from "crypto";
import axios from "axios";
import logger from "../utils/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MetaUserData {
  em?: string[];           // SHA256 hashed email
  ph?: string[];           // SHA256 hashed phone
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;            // click ID (_fbc cookie)
  fbp?: string;            // browser ID (_fbp cookie)
  external_id?: string;    // user ID (hashed)
}

interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;        // deduplication ID
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
  action_source: "website";
  event_source_url: string;
}

interface SendEventOptions {
  eventName: string;
  eventId?: string;        // for deduplication (client-side sends same event_id)
  email?: string;
  phone?: string;
  clientIp?: string;
  clientUserAgent?: string;
  fbc?: string;
  fbp?: string;
  userId?: string;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
}

interface BatchSendOptions {
  events: SendEventOptions[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

class MetaConversionsService {
  private pixelId: string | undefined;
  private accessToken: string | undefined;
  private apiUrl: string;

  constructor() {
    this.pixelId = process.env.META_PIXEL_ID;
    this.accessToken = process.env.META_ACCESS_TOKEN;
    this.apiUrl = `https://graph.facebook.com/v19.0/${this.pixelId}/events`;
  }

  isConfigured(): boolean {
    return !!(this.pixelId && this.accessToken);
  }

  // ── SHA256 Hashing ────────────────────────────────────────────────────────

  private hashValue(value: string): string {
    return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
  }

  private hashEmail(email: string): string {
    return this.hashValue(email);
  }

  private hashPhone(phone: string): string {
    // Remove non-digits, hash raw
    const digitsOnly = phone.replace(/\D/g, "");
    return this.hashValue(digitsOnly);
  }

  private hashUserId(userId: string): string {
    return this.hashValue(userId);
  }

  // ── Event Construction ────────────────────────────────────────────────────

  private buildEvent(options: SendEventOptions): MetaEvent {
    const eventData: MetaEvent = {
      event_name: options.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: options.eventId || crypto.randomUUID(),
      user_data: {
        ...(options.email && { em: [this.hashEmail(options.email)] }),
        ...(options.phone && { ph: [this.hashPhone(options.phone)] }),
        ...(options.clientIp && { client_ip_address: options.clientIp }),
        ...(options.clientUserAgent && { client_user_agent: options.clientUserAgent }),
        ...(options.fbc && { fbc: options.fbc }),
        ...(options.fbp && { fbp: options.fbp }),
        ...(options.userId && { external_id: this.hashUserId(options.userId) }),
      },
      action_source: "website",
      event_source_url: options.eventSourceUrl || process.env.BASE_URL || "https://cestodamore.com.br",
      ...(options.customData && { custom_data: options.customData }),
    };

    return eventData;
  }

  // ── Send Single Event ─────────────────────────────────────────────────────

  async sendEvent(options: SendEventOptions): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.debug("[MetaConversions] Serviço não configurado, ignorando evento:", options.eventName);
      return false;
    }

    try {
      const event = this.buildEvent(options);

      const response = await axios.post(
        this.apiUrl,
        { data: [event] },
        {
          params: { access_token: this.accessToken },
          headers: { "Content-Type": "application/json" },
          timeout: 5000,
        },
      );

      const result = response.data;
      if (result.events_received === 1) {
        logger.debug(`[MetaConversions] ✅ Evento ${options.eventName} enviado com sucesso`);
        return true;
      }

      logger.warn(`[MetaConversions] ⚠️ Resposta inesperada:`, result);
      return false;
    } catch (error: any) {
      logger.error(`[MetaConversions] ❌ Erro ao enviar evento ${options.eventName}:`, error.message);
      return false;
    }
  }

  // ── Send Batch Events ─────────────────────────────────────────────────────

  async sendBatchEvents(options: BatchSendOptions): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.debug("[MetaConversions] Serviço não configurado, ignorando batch");
      return false;
    }

    if (options.events.length === 0) return true;

    try {
      const events = options.events.map((opt) => this.buildEvent(opt));

      const response = await axios.post(
        this.apiUrl,
        { data: events },
        {
          params: { access_token: this.accessToken },
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );

      const result = response.data;
      logger.debug(`[MetaConversions] ✅ Batch enviado: ${result.events_received} eventos`);
      return true;
    } catch (error: any) {
      logger.error(`[MetaConversions] ❌ Erro ao enviar batch:`, error.message);
      return false;
    }
  }

  // ── Helper: Extract request context ───────────────────────────────────────

  extractRequestContext(req: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } }) {
    return {
      clientIp: req.ip || req.connection?.remoteAddress || "",
      clientUserAgent: (req.headers?.["user-agent"] as string) || "",
      fbc: (req.headers?.["x-fbc"] as string) || "",
      fbp: (req.headers?.["x-fbp"] as string) || "",
    };
  }

  // ── Convenience: Purchase Event ───────────────────────────────────────────

  async sendPurchaseEvent(params: {
    email?: string;
    phone?: string;
    userId?: string;
    orderId: string;
    value: number;
    currency?: string;
    products?: Array<{ id: string; name: string; quantity: number; price: number }>;
    req?: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } };
    eventSourceUrl?: string;
  }): Promise<boolean> {
    const ctx = params.req ? this.extractRequestContext(params.req) : {};

    return this.sendEvent({
      eventName: "Purchase",
      eventId: `purchase_${params.orderId}`,
      email: params.email,
      phone: params.phone,
      userId: params.userId,
      clientIp: ctx.clientIp,
      clientUserAgent: ctx.clientUserAgent,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      eventSourceUrl: params.eventSourceUrl,
      customData: {
        currency: params.currency || "BRL",
        value: params.value,
        order_id: params.orderId,
        ...(params.products && { contents: params.products }),
      },
    });
  }

  // ── Convenience: InitiateCheckout Event ───────────────────────────────────

  async sendInitiateCheckoutEvent(params: {
    email?: string;
    phone?: string;
    userId?: string;
    orderId: string;
    value: number;
    currency?: string;
    numItems?: number;
    req?: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } };
    eventSourceUrl?: string;
  }): Promise<boolean> {
    const ctx = params.req ? this.extractRequestContext(params.req) : {};

    return this.sendEvent({
      eventName: "InitiateCheckout",
      eventId: `checkout_${params.orderId}`,
      email: params.email,
      phone: params.phone,
      userId: params.userId,
      clientIp: ctx.clientIp,
      clientUserAgent: ctx.clientUserAgent,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      eventSourceUrl: params.eventSourceUrl,
      customData: {
        currency: params.currency || "BRL",
        value: params.value,
        order_id: params.orderId,
        num_items: params.numItems,
      },
    });
  }

  // ── Convenience: AddToCart Event ──────────────────────────────────────────

  async sendAddToCartEvent(params: {
    email?: string;
    phone?: string;
    userId?: string;
    orderId: string;
    productId: string;
    productName?: string;
    value?: number;
    currency?: string;
    quantity?: number;
    req?: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } };
    eventSourceUrl?: string;
  }): Promise<boolean> {
    const ctx = params.req ? this.extractRequestContext(params.req) : {};

    return this.sendEvent({
      eventName: "AddToCart",
      eventId: `cart_${params.orderId}_${params.productId}_${Date.now()}`,
      email: params.email,
      phone: params.phone,
      userId: params.userId,
      clientIp: ctx.clientIp,
      clientUserAgent: ctx.clientUserAgent,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      eventSourceUrl: params.eventSourceUrl,
      customData: {
        currency: params.currency || "BRL",
        value: params.value,
        contents: [{
          id: params.productId,
          quantity: params.quantity || 1,
          ...(params.productName && { item_name: params.productName }),
        }],
      },
    });
  }

  // ── Convenience: Login Event ──────────────────────────────────────────────

  async sendLoginEvent(params: {
    email: string;
    phone?: string;
    userId: string;
    method?: string;
    req?: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } };
    eventSourceUrl?: string;
  }): Promise<boolean> {
    const ctx = params.req ? this.extractRequestContext(params.req) : {};

    return this.sendEvent({
      eventName: "Login",
      eventId: `login_${params.userId}_${Date.now()}`,
      email: params.email,
      phone: params.phone,
      userId: params.userId,
      clientIp: ctx.clientIp,
      clientUserAgent: ctx.clientUserAgent,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      eventSourceUrl: params.eventSourceUrl,
      customData: {
        method: params.method || "email",
      },
    });
  }

  // ── Convenience: ViewContent Event ────────────────────────────────────────

  async sendViewContentEvent(params: {
    email?: string;
    phone?: string;
    userId?: string;
    productId: string;
    productName: string;
    value?: number;
    currency?: string;
    req?: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } };
    eventSourceUrl?: string;
  }): Promise<boolean> {
    const ctx = params.req ? this.extractRequestContext(params.req) : {};

    return this.sendEvent({
      eventName: "ViewContent",
      eventId: `view_${params.productId}_${Date.now()}`,
      email: params.email,
      phone: params.phone,
      userId: params.userId,
      clientIp: ctx.clientIp,
      clientUserAgent: ctx.clientUserAgent,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      eventSourceUrl: params.eventSourceUrl,
      customData: {
        content_name: params.productName,
        content_ids: [params.productId],
        content_type: "product",
        value: params.value,
        currency: params.currency || "BRL",
      },
    });
  }

  // ── Convenience: Contact Event ────────────────────────────────────────────

  async sendContactEvent(params: {
    email?: string;
    phone?: string;
    userId?: string;
    method?: string;
    req?: { headers?: Record<string, string | string[]>; ip?: string; connection?: { remoteAddress?: string } };
    eventSourceUrl?: string;
  }): Promise<boolean> {
    const ctx = params.req ? this.extractRequestContext(params.req) : {};

    return this.sendEvent({
      eventName: "Contact",
      eventId: `contact_${params.userId || "guest"}_${Date.now()}`,
      email: params.email,
      phone: params.phone,
      userId: params.userId,
      clientIp: ctx.clientIp,
      clientUserAgent: ctx.clientUserAgent,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      eventSourceUrl: params.eventSourceUrl,
      customData: {
        method: params.method || "whatsapp",
      },
    });
  }
}

// Singleton
const metaConversionsService = new MetaConversionsService();
export default metaConversionsService;
