import { BaseAgent } from "./baseAgent";
import type { ToolDefinition } from "../core/types";
import { loadPrompt } from "../prompts/loader";

export class CuratorAgent extends BaseAgent {
  readonly name = "curator";
  readonly tools: ToolDefinition[] = [
    { name: "consultarCatalogo", description: "Busca no catálogo com query expansion", source: "mcp", inputSchema: { type: "object", properties: { items: { type: "array" }, top_k_per_item: { type: "number" }, context: { type: "object" } }, required: ["items"] } },
    { name: "get_product_details", description: "Detalhes completos de um produto", source: "mcp", inputSchema: { type: "object", properties: { product_name: { type: "string" } }, required: ["product_name"] } },
    { name: "get_full_catalog", description: "Catálogo completo", source: "mcp", inputSchema: { type: "object", properties: {} } },
  ];

  get prompt(): string {
    try { return loadPrompt("subagents/curator.md"); }
    catch { return "Você é o agente curador. Busque produtos no catálogo e retorne resultados formatados."; }
  }
}
