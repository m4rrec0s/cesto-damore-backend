import type { ToolDefinition } from "../core/types";

const TOOLS: ToolDefinition[] = [
  // === Product Search (MCP) ===
  {
    name: "consultarCatalogo",
    description: "Busca estruturada no catálogo de produtos com query expansion e sinônimos",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              filter_by: { type: "string", enum: ["category", "name", "description", "price_max", "all"] },
            },
          },
        },
        top_k_per_item: { type: "number" },
        context: {
          type: "object",
          properties: {
            occasion: { type: "string" },
            budget_hint: { type: "string" },
            boost_tags: { type: "array", items: { type: "string" } },
            recipient: { type: "string" },
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "get_product_details",
    description: "Obter detalhes completos de um produto pelo nome",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: { product_name: { type: "string" } },
      required: ["product_name"],
    },
  },
  {
    name: "get_full_catalog",
    description: "Retorna o catálogo completo de produtos disponíveis",
    source: "mcp",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_catalog_sql",
    description: "Busca SQL avançada no catálogo (SELECT only)",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" }, top_k: { type: "number" } },
      required: ["sql"],
    },
  },

  // === Delivery (MCP) ===
  {
    name: "validate_delivery_availability",
    description: "Validar se a data/hora de entrega está disponível",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        date_str: { type: "string", description: "YYYY-MM-DD" },
        time_str: { type: "string", description: "HH:MM" },
        production_time_hours: { type: "number" },
      },
      required: ["date_str"],
    },
  },
  {
    name: "can_produce_in_time",
    description: "Verificar se o produto pode ser produzido a tempo para a entrega",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        product_name: { type: "string" },
        delivery_date: { type: "string", description: "DD/MM/YYYY" },
        delivery_time: { type: "string", description: "HH:MM" },
      },
      required: ["product_name", "delivery_date", "delivery_time"],
    },
  },
  {
    name: "calculate_freight",
    description: "Calcular valor de frete por cidade",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string" },
        payment_method: { type: "string" },
      },
      required: ["city"],
    },
  },
  {
    name: "get_active_holidays",
    description: "Obter feriados ativos que afetam entregas",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: { month: { type: "number" } },
    },
  },

  // === Checkout (MCP) ===
  {
    name: "finalize_checkout",
    description: "Finalizar e confirmar a compra do cliente",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        customer_context: { type: "string" },
        customer_name: { type: "string" },
        customer_phone: { type: "string" },
        session_id: { type: "string" },
        product_name: { type: "string" },
        product_price: { type: "string" },
        delivery_date: { type: "string" },
        delivery_time: { type: "string" },
        delivery_address: { type: "string" },
        payment_method: { type: "string" },
      },
      required: ["customer_context"],
    },
  },
  {
    name: "validate_price_manipulation",
    description: "Validar se o preço informado pelo cliente é legítimo (anti-fraude)",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        product_name: { type: "string" },
        claimed_price: { type: "string" },
      },
      required: ["product_name", "claimed_price"],
    },
  },

  // === Knowledge & Admin (MCP) ===
  {
    name: "query_company_knowledge",
    description: "Consultar base de conhecimento da empresa (FAQ, políticas, regras)",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Pergunta ou busca" } },
      required: ["query"],
    },
  },
  {
    name: "notify_human_support",
    description: "Escalar atendimento para suporte humano",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        context: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "get_current_business_hours",
    description: "Obter horário comercial atual da loja",
    source: "mcp",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "math_calculator",
    description: "Calculadora para operações matemáticas",
    source: "mcp",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
  {
    name: "block_session",
    description: "Bloquear sessão atual (após escalação ou finalização)",
    source: "mcp",
    inputSchema: { type: "object", properties: {} },
  },
];

export function getAllTools(): ToolDefinition[] {
  return TOOLS;
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
