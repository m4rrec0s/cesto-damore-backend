import type { Request, Response } from "express";
import OpenAI from "openai";
import prisma from "../database/prisma";
import logger from "../utils/logger";

import { createHash } from "crypto";
type DiscoveryRequest = {
  prompt?: unknown;
  surprise?: unknown;
};

type ModelResponse = {
  message: string;
  productIds: string[];
};

const model = process.env.NVIDIA_DISCOVERY_MODEL || "meta/llama-3.1-8b-instruct";

function readDiscoveryRequest(body: unknown): { prompt: string; surprise: boolean } | null {
  if (!body || typeof body !== "object") return null;

  const { prompt, surprise } = body as DiscoveryRequest;
  if (typeof surprise === "boolean" && surprise) {
    return { prompt: "", surprise: true };
  }
  if (typeof prompt !== "string" || !prompt.trim()) return null;
  return { prompt: prompt.trim().slice(0, 500), surprise: false };
}

function parseModelResponse(content: string | null): ModelResponse | null {
  if (!content) return null;
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;

  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as { message?: unknown; productIds?: unknown };
    if (
      typeof value.message !== "string" ||
      !Array.isArray(value.productIds) ||
      !value.productIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    return { message: value.message, productIds: value.productIds };
  } catch {
    return null;
  }
}

class DiscoveryController {
  async recommendStream(req: Request, res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const chunks: string[] = [];
    const originalJson = res.json.bind(res);
    res.json = ((payload: unknown) => {
      const data = payload as { message?: string; products?: unknown[]; error?: string };
      if (data.error) res.write(`event: error\ndata: ${JSON.stringify({ error: data.error })}\n\n`);
      if (data.message) {
        for (const word of data.message.split(/(\s+)/)) {
          chunks.push(word);
          res.write(`event: token\ndata: ${JSON.stringify({ token: word })}\n\n`);
        }
      }
      res.write(`event: products\ndata: ${JSON.stringify({ products: data.products || [] })}\n\n`);
      res.write("event: done\ndata: {}\n\n");
      return res.end();
    }) as Response["json"];
    await this.recommend(req, res);
    res.json = originalJson;
  }

  async recommend(req: Request, res: Response) {
    const request = readDiscoveryRequest(req.body);
    if (!request) {
      return res.status(400).json({ error: "Informe o que procura ou escolha uma surpresa." });
    }

    const query = request.surprise ? "surpreenda-me" : request.prompt.toLocaleLowerCase("pt-BR");
    const queryHash = createHash("sha256").update(query).digest("hex");
    const now = new Date();

    try {
      const cached = await prisma.discoveryQueryCache.findUnique({ where: { query_hash: queryHash } });
      if (cached && cached.expires_at > now) {
        const productIds = Array.isArray(cached.product_ids) ? cached.product_ids.filter((id): id is string => typeof id === "string") : [];
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, is_active: true } });
        return res.json({ message: cached.message, products, cached: true });
      }

      if (!process.env.NVIDIA_API_KEY) {
        return res.status(503).json({ error: "Curadoria indisponível no momento." });
      }

      const products = await prisma.product.findMany({
        where: { is_active: true },
        orderBy: request.surprise ? { price: "desc" } : { updated_at: "desc" },
        take: 24,
        select: { id: true, name: true, description: true, price: true, discount: true, image_url: true, categories: { select: { category: { select: { name: true } } } } },
      });
      const catalog = products.map((product) => ({ id: product.id, name: product.name, description: product.description, price: product.price, categories: product.categories.map(({ category }) => category.name) }));
      const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: "https://integrate.api.nvidia.com/v1" });
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: "Você é curadora da Cesto d'Amore. Responda exclusivamente JSON válido: {\"message\": string, \"productIds\": string[]}. Escolha no máximo 3 IDs presentes no catálogo. Mensagem curta, calorosa, em português." },
          { role: "user", content: `${request.surprise ? "Escolha até 3 opções premium e surpreendentes." : `Pedido da cliente: ${request.prompt}`}\nCatálogo: ${JSON.stringify(catalog)}` },
        ],
      });
      const response = parseModelResponse(completion.choices[0]?.message.content ?? null);
      if (!response) return res.status(502).json({ error: "Não consegui preparar uma seleção agora." });

      const byId = new Map(products.map((product) => [product.id, product]));
      const selected = response.productIds.map((id) => byId.get(id)).filter((product): product is (typeof products)[number] => Boolean(product));
      await prisma.discoveryQueryCache.upsert({
        where: { query_hash: queryHash },
        create: { query_hash: queryHash, query_text: query, message: response.message, product_ids: selected.map((product) => product.id), expires_at: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30) },
        update: { message: response.message, product_ids: selected.map((product) => product.id), expires_at: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30) },
      });
      return res.json({ message: response.message, products: selected, cached: false });
    } catch (error) {
      logger.error({ error }, "Erro ao recomendar produtos com NVIDIA");
      return res.status(500).json({ error: "Não foi possível criar sua seleção." });
    }
  }
}

export default new DiscoveryController();
