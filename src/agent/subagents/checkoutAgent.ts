import { BaseAgent } from "./baseAgent";
import type { ToolDefinition } from "../core/types";
import { loadPrompt } from "../prompts/loader";

export class CheckoutAgent extends BaseAgent {
  readonly name = "checkout";
  readonly tools: ToolDefinition[] = [
    { name: "finalize_checkout", description: "Finalizar compra", source: "mcp", inputSchema: { type: "object", properties: { customer_context: { type: "string" }, customer_name: { type: "string" }, customer_phone: { type: "string" }, session_id: { type: "string" }, product_name: { type: "string" }, product_price: { type: "string" }, delivery_date: { type: "string" }, delivery_time: { type: "string" }, delivery_address: { type: "string" }, payment_method: { type: "string" } }, required: ["customer_context"] } },
    { name: "validate_price_manipulation", description: "Validar preço", source: "mcp", inputSchema: { type: "object", properties: { product_name: { type: "string" }, claimed_price: { type: "string" } }, required: ["product_name", "claimed_price"] } },
    { name: "calculate_freight", description: "Calcular frete", source: "mcp", inputSchema: { type: "object", properties: { city: { type: "string" }, payment_method: { type: "string" } }, required: ["city"] } },
  ];

  get prompt(): string {
    try { return loadPrompt("subagents/checkout.md"); }
    catch { return "Você é o agente de checkout. Finalize pedidos validando todos os dados."; }
  }
}
