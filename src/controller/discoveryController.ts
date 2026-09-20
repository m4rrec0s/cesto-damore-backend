import type { Request, Response } from "express";
import OpenAI from "openai";
import prisma from "../database/prisma";
import logger from "../utils/logger";

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
  async recommend(req: Request, res: Response) {
    const request = readDiscoveryRequest(req.body);
    if (!request) {
      return res.status(400).json({ error: "Informe o que procura ou escolha uma surpresa." });
    }

    if (!process.env.NVIDIA_API_KEY) {
      logger.error("NVIDIA_API_KEY ausente para discovery");
      return res.status(503).json({ error: "Curadoria indisponível no momento." });
    }

    try {
      const products = await prisma.product.findMany({
        where: { is_active: true },
        orderBy: request.surprise ? { price: "desc" } : { updated_at: "desc" },
        take: 24,
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          discount: true,
          image_url: true,
          categories: { select: { category: { select: { name: true } } } },
        },
      });

      const client = new OpenAI({
        apiKey: process.env.NVIDIA_API_KEY,
        baseURL: "https://integrate.api.nvidia.com/v1",
      });
      const catalog = products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        categories: product.categories.map(({ category }) => category.name),
      }));
      const intent = request.surprise
        ? "Escolha até 3 opções premium e surpreendentes."
        : `Pedido da cliente: ${request.prompt}`;
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "Você é curadora da Cesto d'Amore. Responda exclusivamente JSON válido: {\"message\": string, \"productIds\": string[]}. Escolha no máximo 3 IDs presentes no catálogo. Mensagem curta, calorosa, em português.",
          },
          { role: "user", content: `${intent}\nCatálogo: ${JSON.stringify(catalog)}` },
        ],
      });
      const response = parseModelResponse(completion.choices[0]?.message.content ?? null);
      if (!response) {
        logger.error("Resposta inválida do modelo de discovery");
        return res.status(502).json({ error: "Não consegui preparar uma seleção agora." });
      }

      const byId = new Map(products.map((product) => [product.id, product]));
      const selected = response.productIds
        .map((id) => byId.get(id))
        .filter((product): product is (typeof products)[number] => Boolean(product));

      return res.json({ message: response.message, products: selected });
    } catch (error) {
      logger.error({ error }, "Erro ao recomendar produtos com NVIDIA");
      return res.status(500).json({ error: "Não foi possível criar sua seleção." });
    }
  }
}

export default new DiscoveryController();
