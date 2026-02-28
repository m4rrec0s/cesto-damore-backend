import { Request, Response } from "express";
import aiAgentService from "../services/aiAgentService";
import n8nChatHistoryService from "../services/n8nChatHistoryService";
import logger from "../utils/logger";

class AIAgentController {
  async chat(req: Request, res: Response) {
    const {
      sessionId,
      message,
      customerPhone,
      customerName,
      remoteJidAlt,
      event,
      chatId,
      sessionKey,
      pushName,
    } = req.body;

    const resolvedSessionId = sessionId || sessionKey;
    const resolvedCustomerName = customerName || pushName;
    const resolvedRemoteJidAlt = remoteJidAlt || chatId;
    const resolvedCustomerPhone =
      customerPhone || (chatId ? chatId.replace(/\D/g, "") : undefined);
    let resolvedMessage = message;

    if (!resolvedMessage && event === "CART_ADDED") {
      resolvedMessage =
        "[Interno] O cliente adicionou um produto ao carrinho pessoal.";
    }

    if (
      resolvedMessage &&
      /evento\s*=\s*cart_added/i.test(resolvedMessage)
    ) {
      resolvedMessage =
        "[Interno] O cliente adicionou um produto ao carrinho pessoal.";
    }

    if (!resolvedSessionId || !resolvedMessage) {
      return res
        .status(400)
        .json({ error: "sessionId and message are required" });
    }

    try {
      const stream = await aiAgentService.chat(
        resolvedSessionId,
        resolvedMessage,
        resolvedCustomerPhone,
        resolvedCustomerName,
        resolvedRemoteJidAlt,
      );

      let fullContent = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullContent += content;
        }
      }

      await aiAgentService.saveResponse(resolvedSessionId, fullContent);

      res.setHeader("Content-Type", "application/json");
      res.status(200).json({
        output: fullContent,
      });
    } catch (error: any) {
      logger.error(`❌ Chat error: ${error.message}`);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  async getHistory(req: Request, res: Response) {
    const { sessionId } = req.params;
    const { page, limit } = req.query;
    try {
      const session = await n8nChatHistoryService.getSessionMessages(
        sessionId,
        page,
        limit,
      );
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async listSessions(req: Request, res: Response) {
    try {
      const sessions = await n8nChatHistoryService.listSessions();
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async blockSession(req: Request, res: Response) {
    const { sessionId } = req.params;
    try {
      const session = await n8nChatHistoryService.blockSession(sessionId);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async unblockSession(req: Request, res: Response) {
    const { sessionId } = req.params;
    try {
      const session = await n8nChatHistoryService.unblockSession(sessionId);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async clearSessionHistory(req: Request, res: Response) {
    const { sessionId } = req.params;
    try {
      const result = await n8nChatHistoryService.clearSessionHistory(sessionId);
      res.json({ success: true, deletedCount: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new AIAgentController();
