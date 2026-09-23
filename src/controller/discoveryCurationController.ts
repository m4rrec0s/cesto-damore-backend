import type { Request, Response } from "express";
import discoveryCurationService from "../services/discoveryCurationService";

class DiscoveryCurationController {
  async list(_req: Request, res: Response) {
    try {
      res.json(await discoveryCurationService.getQueue());
    } catch {
      res.status(500).json({ error: "Não foi possível carregar a fila de curadoria." });
    }
  }

  async diagnose(req: Request, res: Response) {
    try {
      if (typeof req.body?.query !== "string" || !req.body.query.trim()) {
        return res.status(400).json({ error: "Informe a busca para diagnosticar." });
      }
      return res.json(await discoveryCurationService.diagnose(req.body.query));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Diagnóstico indisponível." });
    }
  }
}

export default new DiscoveryCurationController();
