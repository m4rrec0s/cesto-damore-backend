import { createHash } from "crypto";
import type { Request, Response } from "express";
import OpenAI from "openai";
import prisma from "../database/prisma";
import logger from "../utils/logger";

type DiscoveryRequest = { prompt?: unknown; surprise?: unknown; history?: unknown };
type ModelResponse = { message: string; productIds: string[] };
type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  discount: number | null;
  image_url: string | null;
  categories: { category: { name: string } }[];
};

const model = process.env.NVIDIA_DISCOVERY_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const embeddingModel = process.env.NVIDIA_DISCOVERY_EMBEDDING_MODEL || "nvidia/nv-embed-v1";
const cacheTtlMs = 1000 * 60 * 60 * 24 * 30;
const stopWords = new Set(["a", "o", "as", "os", "uma", "um", "para", "pra", "de", "do", "da", "dos", "das", "com", "por", "que", "meu", "minha", "seu", "sua", "quero", "preciso", "gostaria", "presente", "favor"]);
const intentTerms: Record<string, string[]> = {
  mulher: ["romantica", "amor", "namorados", "cesta"], esposa: ["romantica", "amor", "namorados"], namorada: ["romantica", "amor", "namorados"],
  mae: ["maes", "amor", "cesta"], aniversario: ["festa", "celebrar", "cesta"], bebe: ["bebe", "nascimento", "infantil"],
  homem: ["bar", "cerveja", "time", "cesta"], amigo: ["amizade", "cesta", "bar"], rapido: ["express", "pronta entrega"],
};

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function readDiscoveryRequest(body: unknown): { prompt: string; surprise: boolean; history: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const { prompt, surprise } = body as DiscoveryRequest;
  const rawHistory: unknown = (body as DiscoveryRequest).history;
  const history = Array.isArray(rawHistory)
    ? rawHistory
        .filter((entry: unknown): entry is string => typeof entry === "string")
        .slice(-6)
        .map((entry: string) => entry.slice(0, 500))
    : [];
  if (surprise === true) return { prompt: "", surprise: true, history };
  if (typeof prompt !== "string" || !prompt.trim()) return null;
  return { prompt: prompt.trim().slice(0, 500), surprise: false, history };
}

function parseModelResponse(content: string): ModelResponse | null {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string" && Array.isArray((parsed as { productIds?: unknown }).productIds)) {
        const productIds = (parsed as { productIds: unknown[] }).productIds;
        if (productIds.every((id): id is string => typeof id === "string")) return { message: (parsed as { message: string }).message, productIds };
      }
    } catch {
      // Try the streaming format below.
    }
  }
  const ids = content.match(/PRODUCT_IDS\s*:\s*(\[[^\]]*\])/i)?.[1];
  const message = content.replace(/\s*PRODUCT_IDS\s*:\s*\[[\s\S]*$/i, "").trim();
  if (!ids || !message) return null;
  try {
    const productIds: unknown = JSON.parse(ids);
    if (!Array.isArray(productIds) || !productIds.every((id) => typeof id === "string")) return null;
    return { message, productIds };
  } catch {
    return null;
  }
}

function writeEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

class DiscoveryController {
  private async createEmbedding(client: OpenAI, query: string) {
    const response = await client.embeddings.create({ model: embeddingModel, input: query });
    const embedding = response.data[0]?.embedding;
    return embedding?.length ? `[${embedding.join(",")}]` : null;
  }

  private async getSemanticCached(embedding: string, now: Date) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ message: string; product_ids: unknown }>>(
        `SELECT message, product_ids FROM "DiscoveryQueryCache"
         WHERE expires_at > $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector LIMIT 1`,
        now,
        embedding,
      );
      const cached = rows[0];
      if (!cached) return null;
      const ids = Array.isArray(cached.product_ids)
        ? cached.product_ids.filter((id): id is string => typeof id === "string")
        : [];
      const products = await prisma.product.findMany({ where: { id: { in: ids }, is_active: true } });
      return products.length ? { message: cached.message, products } : null;
    } catch (error) {
      logger.warn({ error }, "Cache semântico de descoberta indisponível");
      return null;
    }
  }

  private async getLocalMatches(request: { prompt: string; surprise: boolean }) {
    const terms = normalizeSearch(request.prompt).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 3 && !stopWords.has(term));
    const expandedTerms = [...new Set(terms.flatMap((term) => [term, ...(intentTerms[term] || [])]))];
    const products = await prisma.product.findMany({ where: { is_active: true }, include: { categories: { include: { category: true } } } });
    if (!expandedTerms.length || request.surprise) return products.sort((a, b) => b.price - a.price);

    return products
      .map((product) => {
        const name = normalizeSearch(product.name);
        const description = normalizeSearch(product.description || "");
        const categories = normalizeSearch(product.categories.map(({ category }) => category.name).join(" "));
        const score = expandedTerms.reduce((total, term) => total + (name.includes(term) ? 6 : 0) + (categories.includes(term) ? 4 : 0) + (description.includes(term) ? 2 : 0), 0);
        return { product, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.product.price - a.product.price || b.score - a.score)
      .map(({ product }) => product);
  }

  private async getCached(queryHash: string, now: Date) {
    const cached = await prisma.discoveryQueryCache.findUnique({ where: { query_hash: queryHash } });
    if (!cached || cached.expires_at <= now) return null;
    const ids = Array.isArray(cached.product_ids)
      ? cached.product_ids.filter((id): id is string => typeof id === "string")
      : [];
    const products = await prisma.product.findMany({ where: { id: { in: ids }, is_active: true }, orderBy: { price: "desc" } });
    return { message: cached.message, products };
  }

  private async getCatalog(request: { prompt: string; surprise: boolean }): Promise<CatalogProduct[]> {
    return prisma.product.findMany({
      where: { is_active: true },
      orderBy: { price: "desc" },
      select: {
        id: true, name: true, description: true, price: true, discount: true, image_url: true,
        categories: { select: { category: { select: { name: true } } } },
      },
    });
  }

  private getAlsoLike(excludedIds: string[]) {
    return prisma.product.findMany({
      where: { is_active: true, id: { notIn: excludedIds } },
      orderBy: { price: "desc" },
      take: 8,
      include: { categories: { include: { category: true } } },
    });
  }

  private createCompletion(client: OpenAI, request: { prompt: string; surprise: boolean; history: string[] }, products: CatalogProduct[], stream: true) {
    const catalog = products.map(({ id, name, description, price, categories }) => ({
      id, name, description, price, categories: categories.map(({ category }) => category.name),
    }));
    return client.chat.completions.create({
      model,
      temperature: 0.4,
      stream,
      messages: [
        { role: "system", content: "Você é curadora da Cesto d'Amore. Responda em português com uma frase curta e calorosa. Na última linha, escreva exatamente PRODUCT_IDS:[\"id1\",\"id2\"]. Inclua todos IDs do catálogo que combinam com pedido, sem limite artificial. Não use markdown." },
        { role: "user", content: `${request.history.length ? `Contexto da conversa: ${request.history.join("\n")}\n` : ""}${request.surprise ? "Escolha até 3 opções premium e surpreendentes." : `Pedido da cliente: ${request.prompt}`}\nCatálogo: ${JSON.stringify(catalog)}` },
      ],
    });
  }

  private async persist(queryHash: string, query: string, response: ModelResponse, selected: CatalogProduct[], now: Date) {
    await prisma.discoveryQueryCache.upsert({
      where: { query_hash: queryHash },
      create: { query_hash: queryHash, query_text: query, message: response.message, product_ids: selected.map((product) => product.id), expires_at: new Date(now.getTime() + cacheTtlMs) },
      update: { message: response.message, product_ids: selected.map((product) => product.id), expires_at: new Date(now.getTime() + cacheTtlMs) },
    });
  }

  private async persistEmbedding(queryHash: string, embedding: string | null) {
    if (!embedding) return;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "DiscoveryQueryCache" SET embedding = $1::vector WHERE query_hash = $2`,
        embedding,
        queryHash,
      );
    } catch (error) {
      logger.warn({ error }, "Não foi possível salvar embedding de descoberta");
    }
  }

  async recommend(req: Request, res: Response) {
    const request = readDiscoveryRequest(req.body);
    if (!request) return res.status(400).json({ error: "Informe o que procura ou escolha uma surpresa." });
    const query = request.surprise ? "surpreenda-me" : request.prompt.toLocaleLowerCase("pt-BR");
    const queryHash = createHash("sha256").update(query).digest("hex");
    const now = new Date();
    try {
      const cached = await this.getCached(queryHash, now);
      if (cached) return res.json({ ...cached, cached: true });
      if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: "Curadoria indisponível no momento." });
      const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: "https://integrate.api.nvidia.com/v1" });
      const embedding = await this.createEmbedding(client, query).catch(() => null);
      if (embedding) {
        const semantic = await this.getSemanticCached(embedding, now);
        if (semantic) return res.json({ ...semantic, cached: true, semantic: true });
      }
      const products = await this.getCatalog(request);
      const stream = await this.createCompletion(client, request, products, true);
      let content = "";
      for await (const chunk of stream) content += chunk.choices[0]?.delta.content || "";
      const response = parseModelResponse(content);
      if (!response) return res.status(502).json({ error: "Não consegui preparar uma seleção agora." });
      const byId = new Map(products.map((product) => [product.id, product]));
      const selected = response.productIds.map((id) => byId.get(id)).filter((product): product is CatalogProduct => Boolean(product)).sort((a, b) => b.price - a.price);
      await this.persist(queryHash, query, response, selected, now);
      await this.persistEmbedding(queryHash, embedding);
      return res.json({ message: response.message, products: selected, alsoLike: await this.getAlsoLike(selected.map((product) => product.id)), cached: false });
    } catch (error) {
      logger.error({ error }, "Erro ao recomendar produtos com NVIDIA");
      const products = await this.getLocalMatches(request);
      return res.json({ message: "Encontrei essas opções para você 🤩", products, cached: false, fallback: true });
    }
  }

  async recommendStream(req: Request, res: Response) {
    const request = readDiscoveryRequest(req.body);
    if (!request) return res.status(400).json({ error: "Informe o que procura ou escolha uma surpresa." });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const query = request.surprise ? "surpreenda-me" : request.prompt.toLocaleLowerCase("pt-BR");
    const queryHash = createHash("sha256").update(query).digest("hex");
    const now = new Date();
    try {
      const cached = await this.getCached(queryHash, now);
      if (cached) {
        writeEvent(res, "token", { token: cached.message });
        writeEvent(res, "products", { products: cached.products, cached: true });
        writeEvent(res, "also_like", { products: await this.getAlsoLike(cached.products.map((product) => product.id)) });
        writeEvent(res, "done", {});
        return res.end();
      }
      if (!process.env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY ausente");
      const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: "https://integrate.api.nvidia.com/v1" });
      const embedding = await this.createEmbedding(client, query).catch(() => null);
      if (embedding) {
        const semantic = await this.getSemanticCached(embedding, now);
        if (semantic) {
          writeEvent(res, "token", { token: semantic.message });
          writeEvent(res, "products", { products: semantic.products, cached: true, semantic: true });
          writeEvent(res, "also_like", { products: await this.getAlsoLike(semantic.products.map((product) => product.id)) });
          writeEvent(res, "done", {});
          return res.end();
        }
      }
      const products = await this.getCatalog(request);
      const stream = await this.createCompletion(client, request, products, true);
      let content = "";
      let sent = 0;
      for await (const chunk of stream) {
        content += chunk.choices[0]?.delta.content || "";
        const marker = content.search(/\n?PRODUCT_IDS\s*:/i);
        const visible = marker >= 0 ? content.slice(0, marker) : content.slice(0, Math.max(0, content.length - 40));
        if (visible.length > sent) {
          writeEvent(res, "token", { token: visible.slice(sent) });
          sent = visible.length;
        }
      }
      const response = parseModelResponse(content);
      if (!response) throw new Error("Resposta NVIDIA inválida");
      if (response.message.length > sent) writeEvent(res, "token", { token: response.message.slice(sent) });
      const byId = new Map(products.map((product) => [product.id, product]));
      const selected = response.productIds.map((id) => byId.get(id)).filter((product): product is CatalogProduct => Boolean(product)).sort((a, b) => b.price - a.price);
      await this.persist(queryHash, query, response, selected, now);
      await this.persistEmbedding(queryHash, embedding);
      writeEvent(res, "products", { products: selected, cached: false });
      writeEvent(res, "also_like", { products: await this.getAlsoLike(selected.map((product) => product.id)) });
      writeEvent(res, "done", {});
    } catch (error) {
      logger.error({ error }, "Erro no stream de descoberta");
      const products = await this.getLocalMatches(request);
      writeEvent(res, "token", { token: "Encontrei essas opções para você 🤩" });
      writeEvent(res, "products", { products, fallback: true });
      writeEvent(res, "also_like", { products: await this.getAlsoLike(products.map((product) => product.id)) });
      writeEvent(res, "done", {});
    }
    return res.end();
  }
}

export default new DiscoveryController();
