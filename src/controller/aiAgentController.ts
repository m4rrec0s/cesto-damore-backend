import { Request, Response } from "express";
import aiAgentService from "../services/aiAgentService";
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
      productName,
    } = req.body;

    const resolvedSessionId = sessionId || sessionKey;
    const resolvedCustomerName = customerName || pushName;
    const resolvedRemoteJidAlt = remoteJidAlt || chatId;
    let resolvedMessage = message;

    if (!resolvedMessage && event === "CART_ADDED") {
      const productLine = productName ? ` Produto: ${productName}.` : "";
      resolvedMessage =
        `[Interno] O cliente adicionou um produto ao carrinho pessoal.${productLine}`;
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
        customerPhone,
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

      // Save the final response to database for memory
      await aiAgentService.saveResponse(resolvedSessionId, fullContent);

      // Return response in structured JSON format
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
    try {
      const session = await aiAgentService.getSession(sessionId);
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async listSessions(req: Request, res: Response) {
    try {
      const sessions = await aiAgentService.listSessions();
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async blockSession(req: Request, res: Response) {
    const { sessionId } = req.params;
    try {
      const session = await aiAgentService.blockSession(sessionId);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async unblockSession(req: Request, res: Response) {
    const { sessionId } = req.params;
    try {
      const session = await aiAgentService.unblockSession(sessionId);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async clearSessionHistory(req: Request, res: Response) {
    const { sessionId } = req.params;
    try {
      const result = await aiAgentService.clearSessionHistory(sessionId);
      res.json({ success: true, deletedCount: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new AIAgentController();
