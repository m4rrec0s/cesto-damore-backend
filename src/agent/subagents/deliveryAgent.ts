import { BaseAgent } from "./baseAgent";
import type { ToolDefinition } from "../core/types";
import { loadPrompt } from "../prompts/loader";

export class DeliveryAgent extends BaseAgent {
  readonly name = "delivery";
  readonly tools: ToolDefinition[] = [
    { name: "validate_delivery_availability", description: "Validar disponibilidade de entrega", source: "mcp", inputSchema: { type: "object", properties: { date_str: { type: "string" }, time_str: { type: "string" }, production_time_hours: { type: "number" } }, required: ["date_str"] } },
    { name: "can_produce_in_time", description: "Verificar prazo de produção", source: "mcp", inputSchema: { type: "object", properties: { product_name: { type: "string" }, delivery_date: { type: "string" }, delivery_time: { type: "string" } }, required: ["product_name", "delivery_date", "delivery_time"] } },
    { name: "calculate_freight", description: "Calcular frete", source: "mcp", inputSchema: { type: "object", properties: { city: { type: "string" }, payment_method: { type: "string" } }, required: ["city"] } },
    { name: "get_active_holidays", description: "Feriados ativos", source: "mcp", inputSchema: { type: "object", properties: { month: { type: "number" } } } },
  ];

  get prompt(): string {
    try { return loadPrompt("subagents/delivery.md"); }
    catch { return "Você é o agente de entrega. Valide datas, horários e calcule fretes."; }
  }
}
