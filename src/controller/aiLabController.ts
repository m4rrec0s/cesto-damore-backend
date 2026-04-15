import { Request, Response } from "express";
import aiAgentService, { LabTraceEvent } from "../services/aiAgentService";
import logger from "../utils/logger";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function extractMetaTag(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return "";
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim() || "";
}

function normalizePreviewUrl(candidate: string, baseUrl: string) {
  if (!candidate) return "";
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return "";
  }
}

class AILabController {
  private getUserId(req: Request) {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      throw new Error("Usuário não autenticado");
    }
    return userId;
  }

  private resolveErrorStatus(error: any) {
    const message = (error?.message || "").toString().toLowerCase();
    if (message.includes("não autenticado") || message.includes("nao autenticado")) {
      return 401;
    }
    if (
      message.includes("não encontrada") ||
      message.includes("nao encontrada")
    ) {
      return 404;
    }
    return 500;
  }

  async createSession(req: Request, res: Response) {
    try {
      const userId = this.getUserId(req);
      const session = await aiAgentService.createLabSession(userId);
      return res.json({ session });
    } catch (error: any) {
      return res.status(this.resolveErrorStatus(error)).json({ error: error.message });
    }
  }

  async listSessions(req: Request, res: Response) {
    try {
      const userId = this.getUserId(req);
      const sessions = await aiAgentService.listLabSessions(userId);
      return res.json({ sessions });
    } catch (error: any) {
      return res.status(this.resolveErrorStatus(error)).json({ error: error.message });
    }
  }

  async getSessionMessages(req: Request, res: Response) {
    try {
      const userId = this.getUserId(req);
      const { sessionId } = req.params;
      const messages = await aiAgentService.getLabSessionHistory(userId, sessionId);
      return res.json({ messages });
    } catch (error: any) {
      return res.status(this.resolveErrorStatus(error)).json({ error: error.message });
    }
  }

  async deleteSession(req: Request, res: Response) {
    try {
      const userId = this.getUserId(req);
      const { sessionId } = req.params;
      await aiAgentService.deleteLabSession(userId, sessionId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(this.resolveErrorStatus(error)).json({ error: error.message });
    }
  }

  async getSessionMemorySnapshot(req: Request, res: Response) {
    try {
      const userId = this.getUserId(req);
      const { sessionId } = req.params;
      const snapshot = await aiAgentService.getLabMemorySnapshot(userId, sessionId);
      return res.json(snapshot);
    } catch (error: any) {
      return res.status(this.resolveErrorStatus(error)).json({ error: error.message });
    }
  }

  async chatStream(req: Request, res: Response) {
    const { sessionId, message, customerName, managerUser } = req.body || {};

    if (!sessionId || !message) {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: sessionId e message" });
    }

    let userId: string;
    try {
      userId = this.getUserId(req);
    } catch (error: any) {
      return res.status(401).json({ error: error.message });
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();

    const writeEvent = async (event: LabTraceEvent) => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await aiAgentService.chatLabWithTrace(
        sessionId,
        message,
        userId,
        (customerName || "").toString().trim() || "Cliente",
        {
          id: (managerUser?.id || "").toString().trim() || userId,
          name: (managerUser?.name || "").toString().trim() || null,
          phone: (managerUser?.phone || "").toString().trim() || null,
          email: (managerUser?.email || "").toString().trim() || null,
        },
        writeEvent,
      );
      res.end();
    } catch (error: any) {
      logger.error("❌ [AILab] Erro no stream:", error);
      try {
        await writeEvent({
          type: "error",
          message: error.message || "Falha no streaming",
          timestamp: new Date().toISOString(),
        });
      } finally {
        res.end();
      }
    }
  }

  async getLinkPreview(req: Request, res: Response) {
    const target = (req.query.url as string | undefined)?.trim();
    if (!target) {
      return res.status(400).json({ error: "Parâmetro url é obrigatório" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(target);
    } catch {
      return res.status(400).json({ error: "URL inválida" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Apenas URLs http(s) são permitidas" });
    }

    if (BLOCKED_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
      return res.status(400).json({ error: "Host bloqueado para preview" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "CestoDAMore-LabPreview/1.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const finalUrl = response.url || parsedUrl.toString();
      const contentType = (response.headers.get("content-type") || "").toLowerCase();

      if (contentType.startsWith("image/")) {
        return res.json({
          url: finalUrl,
          title: finalUrl.split("/").pop() || "Imagem",
          description: "",
          image: finalUrl,
          host: new URL(finalUrl).hostname,
        });
      }

      const html = await response.text();
      const title =
        extractMetaTag(html, "og:title") ||
        extractMetaTag(html, "twitter:title") ||
        extractTitle(html) ||
        parsedUrl.hostname;
      const description =
        extractMetaTag(html, "og:description") ||
        extractMetaTag(html, "twitter:description") ||
        extractMetaTag(html, "description");
      const imageCandidate =
        extractMetaTag(html, "og:image") || extractMetaTag(html, "twitter:image");
      const image = normalizePreviewUrl(imageCandidate, finalUrl);

      return res.json({
        url: finalUrl,
        title,
        description,
        image,
        host: new URL(finalUrl).hostname,
      });
    } catch (error: any) {
      return res.status(502).json({
        error: "Falha ao buscar preview do link",
        detail: error.message || "Erro desconhecido",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export default new AILabController();
