import { Request, Response } from "express";
import { chatRealtimeService } from "../services/chatRealtimeService";

class ChatRealtimeController {
  async streamSessions(req: Request, res: Response) {
    chatRealtimeService.registerGlobalClient(res);
  }

  async streamSessionMessages(req: Request, res: Response) {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId é obrigatório" });
    }

    chatRealtimeService.registerSessionClient(sessionId, res);
  }
}

export default new ChatRealtimeController();
