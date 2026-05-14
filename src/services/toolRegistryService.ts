/**
 * ToolRegistry Service - Gerencia e sincroniza ferramentas do MCP
 * 
 * Responsabilidades:
 * - Manter lista centralizada de tools com definições
 * - Sincronizar com MCP server
 * - Filtrar tools por fase de vendas
 * - Fornecer acesso aos metadados
 */

import type { IToolDefinition } from "../types/tools";
import type { EmotionalState } from "../types/emotionalState";
import type { SalesPhase } from "./phaseGateService";
import logger from "../utils/logger";

const CALL_COST_NUMERIC: Record<NonNullable<IToolDefinition["callCost"]>, number> =
  { low: 1, medium: 3, high: 6 };

const TOOL_DEFINITIONS: IToolDefinition[] = [
  // ========================================================================
  // ALWAYS ALLOWED (todas as fases)
  // ========================================================================
  {
    name: "query_company_knowledge",
    description: "Consulta base de conhecimento da empresa",
    allowedPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
    callCost: "medium",
    priority: 90,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pergunta ou busca" },
      },
      required: ["query"],
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 300,
    category: "knowledge",
  },

  {
    name: "notify_human_support",
    description: "Escalate para suporte humano",
    allowedPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
    callCost: "low",
    priority: 95,
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        context: { type: "string" },
      },
      required: ["reason"],
    },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },

  {
    name: "get_current_business_hours",
    description: "Obter horário comercial atual",
    allowedPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
    priority: 70,
    inputSchema: {
      type: "object",
      properties: {},
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 3600,
    category: "admin",
  },

  {
    name: "get_active_holidays",
    description: "Obter feriados ativos",
    allowedPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
    priority: 70,
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "number" },
      },
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 86400,
    category: "admin",
  },

  {
    name: "math_calculator",
    description: "Calculadora para operações matemáticas",
    allowedPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
    priority: 50,
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string" },
      },
      required: ["expression"],
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 300,
    category: "admin",
  },

  // ========================================================================
  // DISCOVERY (Fase de descoberta)
  // ========================================================================
  // (Nenhuma tool adicional específica)

  // ========================================================================
  // CURATION (Fase de curadoria - FOCO EM PRODUTOS)
  // ========================================================================
  {
    name: "consultarCatalogo",
    description:
      "Busca estruturada no catálogo de produtos com query expansion",
    allowedPhases: ["CURATION", "CUSTOMIZATION", "CHECKOUT"],
    callCost: "high",
    allowedEmotionalStates: ["animado", "indeciso", "frustrado"],
    priority: 100,
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              filter_by: {
                type: "string",
                enum: ["category", "name", "description", "price_max", "all"],
              },
            },
          },
        },
        top_k_per_item: { type: "number" },
        context: {
          type: "object",
          description:
            "Opcional: ocasião, orçamento, tags, destinatário (merchandising)",
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
    fallbackBehavior: "required",
    cacheable: true,
    cacheTTL: 600,
    category: "product_search",
  },

  {
    name: "query_catalog_sql",
    description: "Busca SQL avançada no catálogo (SELECT only)",
    allowedPhases: ["CURATION", "CUSTOMIZATION", "CHECKOUT"],
    callCost: "medium",
    allowedEmotionalStates: ["animado", "indeciso", "frustrado"],
    priority: 85,
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" },
        top_k: { type: "number" },
      },
      required: ["sql"],
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 600,
    category: "product_search",
  },

  {
    name: "get_product_details",
    description: "Obter detalhes completos de um produto",
    allowedPhases: ["CURATION", "CUSTOMIZATION", "CHECKOUT"],
    callCost: "medium",
    priority: 80,
    inputSchema: {
      type: "object",
      properties: {
        product_name: { type: "string" },
      },
      required: ["product_name"],
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 300,
    category: "product_search",
  },

  // ========================================================================
  // CUSTOMIZATION (Customização)
  // ========================================================================
  {
    name: "can_produce_in_time",
    description: "Verificar se produto pode ser feito no prazo",
    allowedPhases: ["CUSTOMIZATION", "CHECKOUT"],
    callCost: "medium",
    priority: 90,
    inputSchema: {
      type: "object",
      properties: {
        product_name: { type: "string" },
        delivery_date: { type: "string", description: "DD/MM/YYYY" },
        delivery_time: { type: "string", description: "HH:MM" },
      },
      required: ["product_name", "delivery_date", "delivery_time"],
    },
    fallbackBehavior: "required",
    cacheable: true,
    cacheTTL: 300,
    category: "delivery",
  },

  {
    name: "validate_delivery_availability",
    description: "Validar disponibilidade de entrega",
    allowedPhases: ["CUSTOMIZATION", "CHECKOUT"],
    callCost: "medium",
    priority: 85,
    inputSchema: {
      type: "object",
      properties: {
        date_str: { type: "string", description: "YYYY-MM-DD" },
        time_str: { type: "string", description: "HH:MM opcional" },
        production_time_hours: { type: "number" },
      },
      required: ["date_str"],
    },
    fallbackBehavior: "optional",
    cacheable: true,
    cacheTTL: 300,
    category: "delivery",
  },

  // ========================================================================
  // CHECKOUT (Finalização)
  // ========================================================================
  {
    name: "calculate_freight",
    description: "Calcular valor de frete",
    allowedPhases: ["CHECKOUT"],
    callCost: "low",
    priority: 95,
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string" },
        payment_method: { type: "string" },
      },
      required: ["city"],
    },
    fallbackBehavior: "required",
    cacheable: true,
    cacheTTL: 600,
    category: "delivery",
  },

  {
    name: "finalize_checkout",
    description: "Finalizar e confirmar compra",
    allowedPhases: ["CHECKOUT"],
    callCost: "high",
    priority: 100,
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
    fallbackBehavior: "required",
    cacheable: false,
    category: "checkout",
  },

  // Presentes no MCP mas não expostas ao LLM principal (uso interno / compat)
  {
    name: "save_customer_summary",
    description: "Persistir resumo do cliente (uso controlado pelo backend)",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "block_session",
    description: "Bloquear sessão (fluxos especiais)",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "check_mcp_health",
    description: "Healthcheck MCP",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "reset_mcp_cache",
    description: "Reset cache MCP",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "rank_products_for_curation",
    description: "Ranking interno de curadoria",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "product_search",
  },
  {
    name: "get_full_catalog",
    description: "Catálogo completo",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "product_search",
  },
  {
    name: "validate_price_manipulation",
    description: "Validação anti-manipulação de preço",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "list_available_menus",
    description: "Menus de fluxo",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "change_flow_node",
    description: "Alterar nó de fluxo",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
  {
    name: "route_to_flow_node",
    description: "Roteamento de fluxo",
    allowedPhases: [],
    priority: 0,
    inputSchema: { type: "object", properties: {} },
    fallbackBehavior: "optional",
    cacheable: false,
    category: "admin",
  },
];

class ToolRegistry {
  private tools: Map<string, IToolDefinition> = new Map();
  private lastSyncAt: Date | null = null;

  constructor() {
    this.initialize();
  }

  /**
   * Inicializa o registro com definições padrão
   */
  private initialize() {
    for (const tool of TOOL_DEFINITIONS) {
      this.tools.set(tool.name, tool);
    }
    this.lastSyncAt = new Date();
    logger.info(
      `[ToolRegistry] Initialized with ${this.tools.size} tools`
    );
  }

  /**
   * Retorna todas as ferramentas (ou filtradas por fase)
   */
  getAllTools(phase?: SalesPhase): IToolDefinition[] {
    const toolArray = Array.from(this.tools.values());

    if (!phase) {
      return toolArray;
    }

    return toolArray.filter((tool) => tool.allowedPhases.includes(phase));
  }

  /**
   * Retorna ferramenta específica
   */
  getTool(name: string): IToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Verifica se tool é permitida em uma fase
   */
  isToolAllowedInPhase(toolName: string, phase: SalesPhase): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    return tool.allowedPhases.includes(phase);
  }

  /**
   * Retorna tools ordenadas por prioridade (maior primeiro)
   */
  getToolsByPriority(phase: SalesPhase): IToolDefinition[] {
    return this.getAllTools(phase).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Retorna tools que são cacheáveis
   */
  getCacheableTools(phase?: SalesPhase): IToolDefinition[] {
    const tools = this.getAllTools(phase);
    return tools.filter((t) => t.cacheable);
  }

  /**
   * Retorna tools por categoria
   */
  getToolsByCategory(
    category: string,
    phase?: SalesPhase
  ): IToolDefinition[] {
    const tools = this.getAllTools(phase);
    return tools.filter((t) => t.category === category);
  }

  /**
   * Registra nova ferramenta (para extensibilidade)
   */
  registerTool(tool: IToolDefinition): void {
    this.tools.set(tool.name, tool);
    logger.info(`[ToolRegistry] Registered tool: ${tool.name}`);
  }

  /**
   * Retorna informações de sincronismo
   */
  getSyncInfo() {
    return {
      toolCount: this.tools.size,
      lastSyncAt: this.lastSyncAt,
      categories: Array.from(
        new Set(Array.from(this.tools.values()).map((t) => t.category))
      ),
    };
  }

  /**
   * Gera JSON de ferramentas para OpenAI (format functools)
   */
  getToolsForOpenAI(phase: SalesPhase) {
    const tools = this.getAllTools(phase);
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}

// Singleton
const toolRegistry = new ToolRegistry();

export function estimateToolNumericCost(def: IToolDefinition): number {
  return CALL_COST_NUMERIC[def.callCost ?? "low"];
}

export type McpToolShape = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

/**
 * Intersecta tools retornadas pelo MCP com metadados do registry (fase, emoção, custo).
 * Tools sem entrada no registry são bloqueadas (com log).
 */
export function filterMcpToolsForAgentContext(
  mcpTools: McpToolShape[],
  phase: SalesPhase,
  emotion: EmotionalState,
  options?: { costBudget?: number; sessionId?: string },
): McpToolShape[] {
  const emotionFilterOn = process.env.EMOTION_TOOL_FILTER === "true";
  const budget =
    options?.costBudget ??
    Number(process.env.TOOL_COST_BUDGET_PER_TURN || "1000");
  let spent = 0;
  const out: McpToolShape[] = [];
  const sid = options?.sessionId;

  for (const tool of mcpTools) {
    const def = toolRegistry.getTool(tool.name);
    if (!def) {
      logger.warn(
        `[ToolGate] not_in_registry name=${tool.name} phase=${phase}${sid ? ` session=${sid}` : ""}`,
      );
      continue;
    }
    if (!def.allowedPhases.length) {
      continue;
    }
    if (!def.allowedPhases.includes(phase)) {
      logger.info(
        `[ToolGate] blocked=phase name=${tool.name} phase=${phase}${sid ? ` session=${sid}` : ""}`,
      );
      continue;
    }
    if (
      emotionFilterOn &&
      def.allowedEmotionalStates?.length &&
      !def.allowedEmotionalStates.includes(emotion)
    ) {
      logger.info(
        `[ToolGate] blocked=emotion name=${tool.name} emotion=${emotion}${sid ? ` session=${sid}` : ""}`,
      );
      continue;
    }
    const cost = estimateToolNumericCost(def);
    if (spent + cost > budget) {
      logger.info(
        `[ToolGate] blocked=cost_cap name=${tool.name} spent=${spent} add=${cost} budget=${budget}${sid ? ` session=${sid}` : ""}`,
      );
      continue;
    }
    spent += cost;
    out.push(tool);
  }
  return out;
}

export default toolRegistry;
