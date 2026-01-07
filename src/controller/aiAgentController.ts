import { Request, Response } from "express";
import aiAgentService from "../services/aiAgentService";
import logger from "../utils/logger";

class AIAgentController {
  async chat(req: Request, res: Response) {
    const { sessionId, message, customerPhone, customerName } = req.body;

    if (!sessionId || !message) {
      return res
        .status(400)
        .json({ error: "sessionId and message are required" });
    }

    try {
      const stream = await aiAgentService.chat(
        sessionId,
        message,
        customerPhone,
        customerName
      );

      let fullContent = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullContent += content;
        }
      }

      // Save the final response to database for memory
      await aiAgentService.saveResponse(sessionId, fullContent);

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
}

export default new AIAgentController();
