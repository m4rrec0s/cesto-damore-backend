import { Request, Response } from "express";
import { botFlowService } from "../services/botFlowService";

export const botFlowController = {
  async handleWebhook(req: Request, res: Response) {
    try {
      const { phone, message, contactName } = req.body;
      
      if (!phone) {
        return res.status(400).json({ error: "phone is required" });
      }

      const responseMessages = await botFlowService.processMessage({
        phone: phone.replace(/\D/g, ''),
        message: message || "",
        contactName
      });

      return res.json({ messages: responseMessages, responses: responseMessages });
    } catch (error) {
      console.error("[BotFlowController] Error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  async getFlow(req: Request, res: Response) {
    try {
      const flow = await botFlowService.getActiveFlow();
      return res.json(flow);
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  async saveFlow(req: Request, res: Response) {
    try {
      const { nodes, edges } = req.body;
      const flow = await botFlowService.saveFlow(nodes, edges);
      return res.json(flow);
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }
};
