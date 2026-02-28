import { Response } from "express";
import prisma from "../database/prisma";
import logger from "../utils/logger";

type StreamClient = {
  response: Response;
  pingInterval?: NodeJS.Timeout | null;
};

type ChatHistoryRow = {
  id: number;
  session_id: string;
  message: unknown;
  createdAt: Date;
};

class ChatRealtimeService {
  private sessionClients: Map<string, StreamClient[]> = new Map();
  private globalClients: StreamClient[] = [];
  private readonly clientTimeoutMs = 5 * 60 * 1000;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastSeenId = 0;

  private writeEvent(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private configureSseHeaders(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      (res as any).flushHeaders?.();
    } catch {
      // ignore
    }
  }

  private createClient(res: Response): StreamClient {
    const client: StreamClient = { response: res, pingInterval: null };

    client.pingInterval = setInterval(() => {
      try {
        res.write(": ping\\n\\n");
      } catch {
        this.removeGlobalClient(res);
        this.removeSessionClientByResponse(res);
      }
    }, 20000);

    setTimeout(() => {
      try {
        res.end();
      } catch {
        // ignore
      }
    }, this.clientTimeoutMs);

    return client;
  }

  private cleanupClient(client: StreamClient) {
    if (client.pingInterval) {
      clearInterval(client.pingInterval);
      client.pingInterval = null;
    }
  }

  private removeGlobalClient(res: Response) {
    this.globalClients = this.globalClients.filter((client) => {
      if (client.response === res) {
        this.cleanupClient(client);
        return false;
      }
      return true;
    });
  }

  private removeSessionClientByResponse(res: Response) {
    this.sessionClients.forEach((clients, sessionId) => {
      const remaining = clients.filter((client) => {
        if (client.response === res) {
          this.cleanupClient(client);
          return false;
        }
        return true;
      });

      if (remaining.length === 0) {
        this.sessionClients.delete(sessionId);
      } else {
        this.sessionClients.set(sessionId, remaining);
      }
    });
  }

  private normalizeMessage(row: ChatHistoryRow) {
    const raw =
      row.message && typeof row.message === "object" && !Array.isArray(row.message)
        ? (row.message as Record<string, unknown>)
        : ({ content: String(row.message ?? "") } as Record<string, unknown>);

    const rawType = (raw.type ?? raw.role ?? "").toString().toLowerCase();

    let role: "user" | "assistant" | "tool" | "system" = "assistant";
    if (rawType === "human" || rawType === "user") role = "user";
    if (rawType === "ai" || rawType === "assistant") role = "assistant";
    if (rawType === "tool") role = "tool";
    if (rawType === "system") role = "system";

    const content = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content ?? "");

    return {
      id: `n8n-${row.id}`,
      session_id: row.session_id,
      role,
      content,
      created_at: row.createdAt.toISOString(),
      raw: row.message,
    };
  }

  registerGlobalClient(res: Response) {
    this.configureSseHeaders(res);
    const client = this.createClient(res);
    this.globalClients.push(client);

    this.writeEvent(res, "connected", { scope: "sessions" });

    res.on("close", () => {
      this.removeGlobalClient(res);
    });
  }

  registerSessionClient(sessionId: string, res: Response) {
    this.configureSseHeaders(res);
    const client = this.createClient(res);
    const current = this.sessionClients.get(sessionId) || [];
    current.push(client);
    this.sessionClients.set(sessionId, current);

    this.writeEvent(res, "connected", { scope: "session", sessionId });

    res.on("close", () => {
      this.removeSessionClientByResponse(res);
    });
  }

  private emitGlobal(event: string, data: unknown) {
    this.globalClients.forEach((client) => {
      try {
        this.writeEvent(client.response, event, data);
      } catch {
        this.removeGlobalClient(client.response);
      }
    });
  }

  private emitSession(sessionId: string, event: string, data: unknown) {
    const clients = this.sessionClients.get(sessionId) || [];

    clients.forEach((client) => {
      try {
        this.writeEvent(client.response, event, data);
      } catch {
        this.removeSessionClientByResponse(client.response);
      }
    });
  }

  async initCursor() {
    const latest = await prisma.n8n_chat_histories.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });

    this.lastSeenId = latest?.id || 0;
    logger.info(`📡 [ChatStream] Cursor inicializado em ID ${this.lastSeenId}`);
  }

  startPolling() {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(async () => {
      try {
        const rows = await prisma.n8n_chat_histories.findMany({
          where: { id: { gt: this.lastSeenId } },
          orderBy: { id: "asc" },
          take: 300,
        });

        if (rows.length === 0) {
          return;
        }

        this.lastSeenId = rows[rows.length - 1].id;

        const sessionDeltaMap = new Map<string, number>();

        for (const row of rows) {
          const normalized = this.normalizeMessage(row as ChatHistoryRow);
          this.emitSession(normalized.session_id, "message:new", normalized);

          sessionDeltaMap.set(
            normalized.session_id,
            (sessionDeltaMap.get(normalized.session_id) || 0) + 1,
          );
        }

        sessionDeltaMap.forEach((count, sessionId) => {
          this.emitGlobal("session:updated", {
            session_id: sessionId,
            delta_messages: count,
            timestamp: new Date().toISOString(),
          });
        });
      } catch (error) {
        logger.error("❌ [ChatStream] Erro no polling de mensagens:", error);
      }
    }, 2000);
  }

  cleanupDeadConnections() {
    this.globalClients = this.globalClients.filter((client) => {
      try {
        client.response.write(": health-check\\n\\n");
        return true;
      } catch {
        this.cleanupClient(client);
        return false;
      }
    });

    this.sessionClients.forEach((clients, sessionId) => {
      const active = clients.filter((client) => {
        try {
          client.response.write(": health-check\\n\\n");
          return true;
        } catch {
          this.cleanupClient(client);
          return false;
        }
      });

      if (active.length === 0) {
        this.sessionClients.delete(sessionId);
      } else {
        this.sessionClients.set(sessionId, active);
      }
    });
  }
}

export const chatRealtimeService = new ChatRealtimeService();
