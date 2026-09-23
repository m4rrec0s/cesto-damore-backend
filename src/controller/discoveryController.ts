import type { Request, Response } from "express";
import prisma from "../database/prisma";
import {
  curateDiscoveryProducts,
  describeDiscovery,
  discoveryMatchTier,
  parseDiscoveryIntent,
} from "../services/discoveryCuratorService";
import discoveryCurationService from "../services/discoveryCurationService";

type DiscoveryRequest = {
  prompt?: unknown;
  surprise?: unknown;
};

function readRequest(body: unknown): { prompt: string; surprise: boolean } | null {
  if (!body || typeof body !== "object") return null;
  const value = body as DiscoveryRequest;
  if (value.surprise !== true && (typeof value.prompt !== "string" || !value.prompt.trim())) return null;
  return { prompt: typeof value.prompt === "string" ? value.prompt.trim().slice(0, 500) : "surpreenda-me", surprise: value.surprise === true };
}

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

class DiscoveryController {
  private async search(request: { prompt: string; surprise: boolean }) {
    if (!request.surprise) {
      void discoveryCurationService.recordSearch(request.prompt);
    }
    const products = await prisma.product.findMany({
      where: { is_active: true },
      include: {
        type: { select: { name: true } },
        categories: { include: { category: { select: { name: true } } } },
      },
    });
    const intent = parseDiscoveryIntent(request.prompt);
    const curated = request.surprise
      ? products.map((product) => ({ product, score: 0, reasons: [] })).sort((a, b) => b.product.price - a.product.price)
      : curateDiscoveryProducts(products, intent);
    if (request.surprise) {
      const selected = curated.slice(0, 12).map(({ product }) => product);
      const alsoLike = curated.slice(12, 24).map(({ product }) => product);
      return { intent, products: selected, alsoLike };
    }

    const productsWithMatch = curated
      .filter(({ score }) => discoveryMatchTier(score) > 0)
      .sort((a, b) =>
        discoveryMatchTier(b.score) - discoveryMatchTier(a.score) ||
        b.product.price - a.product.price,
      )
      .slice(0, 12)
      .map(({ product }) => product);
    const alsoLike = curated
      .filter(({ score }) => discoveryMatchTier(score) === 0)
      .sort((a, b) => b.product.price - a.product.price)
      .slice(0, 12)
      .map(({ product }) => product);
    return { intent, products: productsWithMatch, alsoLike };
  }

  async recommend(req: Request, res: Response) {
    const request = readRequest(req.body);
    if (!request) return res.status(400).json({ error: "Informe para quem é, a ocasião ou escolha uma surpresa." });
    const result = await this.search(request);
    return res.json({ message: describeDiscovery(result.intent, result.products.length), products: result.products, alsoLike: result.alsoLike, intent: result.intent, local: true });
  }

  async recommendStream(req: Request, res: Response) {
    const request = readRequest(req.body);
    if (!request) return res.status(400).json({ error: "Informe para quem é, a ocasião ou escolha uma surpresa." });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    try {
      const result = await this.search(request);
      sendEvent(res, "token", { token: describeDiscovery(result.intent, result.products.length) });
      sendEvent(res, "products", { products: result.products, local: true, intent: result.intent });
      sendEvent(res, "also_like", { products: result.alsoLike });
      sendEvent(res, "done", {});
    } catch {
      sendEvent(res, "error", { error: "Não foi possível consultar o catálogo agora." });
    }
    return res.end();
  }
}

export default new DiscoveryController();
