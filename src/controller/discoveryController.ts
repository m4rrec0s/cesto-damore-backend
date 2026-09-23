import type { Request, Response } from "express";
import prisma from "../database/prisma";
import {
  curateDiscoveryProducts,
  describeDiscovery,
  parseDiscoveryIntent,
  type DiscoveryContext,
} from "../services/discoveryCuratorService";

type DiscoveryRequest = {
  prompt?: unknown;
  surprise?: unknown;
  context?: unknown;
};

function readRequest(body: unknown): { prompt: string; surprise: boolean; context: DiscoveryContext } | null {
  if (!body || typeof body !== "object") return null;
  const value = body as DiscoveryRequest;
  if (value.surprise !== true && (typeof value.prompt !== "string" || !value.prompt.trim())) return null;
  const context = value.context && typeof value.context === "object" && !Array.isArray(value.context)
    ? value.context as DiscoveryContext
    : {};
  return { prompt: typeof value.prompt === "string" ? value.prompt.trim().slice(0, 500) : "surpreenda-me", surprise: value.surprise === true, context };
}

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

class DiscoveryController {
  private async search(request: { prompt: string; surprise: boolean; context: DiscoveryContext }) {
    const products = await prisma.product.findMany({
      where: { is_active: true },
      include: {
        type: { select: { name: true } },
        categories: { include: { category: { select: { name: true } } } },
      },
    });
    const intent = parseDiscoveryIntent(request.prompt, request.context);
    const curated = request.surprise
      ? products.map((product) => ({ product, score: 0, reasons: [] })).sort((a, b) => b.product.price - a.product.price)
      : curateDiscoveryProducts(products, intent);
    const selected = curated.map(({ product }) => product);
    const selectedIds = new Set(selected.map((product) => product.id));
    const alsoLike = products.filter((product) => !selectedIds.has(product.id)).sort((a, b) => b.price - a.price).slice(0, 8);
    return { intent, products: selected, alsoLike };
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
