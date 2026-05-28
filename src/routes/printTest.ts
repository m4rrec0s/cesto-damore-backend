import { Router, Request, Response } from "express";
import { Server } from "http";
import {
  printAgentHub,
  setupPrintAgentWebSocket,
} from "./ws-print-agent";

export function createPrintTestRoutes(router: Router): Router {
  router.get("/api/print-test/status", (_req: Request, res: Response) => {
    res.json(printAgentHub.getStatus());
  });

  router.get("/api/print-test/history", (_req: Request, res: Response) => {
    const history = printAgentHub.getHistory();
    res.json({ messages: history, total: history.length });
  });

  router.post("/api/print-test/check-printer", (_req: Request, res: Response) => {
    const result = printAgentHub.sendRaw({ type: "CHECK_PRINTER" });
    res.status(result.success ? 200 : 503).json(result);
  });

  router.post("/api/print-test/print-test", (req: Request, res: Response) => {
    const content =
      typeof req.body.content === "string" ? req.body.content : "Teste de Impressao";
    const result = printAgentHub.sendRaw({
      type: "PRINT_TEST",
      content,
    });
    res.status(result.success ? 200 : 503).json(result);
  });

  router.post("/api/print-test/send-command", (req: Request, res: Response) => {
    const type = typeof req.body.type === "string" ? req.body.type : "";
    const payload =
      typeof req.body.payload === "object" && req.body.payload !== null
        ? (req.body.payload as Record<string, unknown>)
        : {};

    if (!type) {
      return res.status(400).json({ error: "Campo 'type' e obrigatorio" });
    }

    const result = printAgentHub.sendRaw({ type, ...payload });
    return res.status(result.success ? 200 : 503).json(result);
  });

  return router;
}

export function setupPrintTestWebSocket(server: Server) {
  return setupPrintAgentWebSocket(server);
}
