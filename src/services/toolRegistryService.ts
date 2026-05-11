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
import type { SalesPhase } from "./phaseGateService";
import logger from "../utils/logger";

const TOOL_DEFINITIONS: IToolDefinition[] = [
  // ========================================================================
  // ALWAYS ALLOWED (todas as fases)
  // ========================================================================
  {
    name: "query_company_knowledge",
    description: "Consulta base de conhecimento da empresa",
    allowedPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
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
    priority: 80,
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
      },
      required: ["product_id"],
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
    priority: 90,
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        desired_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["product_id", "desired_date"],
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
    priority: 85,
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["address", "date"],
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
    priority: 95,
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string" },
        product_ids: { type: "array", items: { type: "string" } },
      },
      required: ["address", "product_ids"],
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
    priority: 100,
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        date: { type: "string" },
        address: { type: "string" },
        payment_method: { type: "string", enum: ["PIX", "CARTAO"] },
      },
      required: ["product_id", "date", "address", "payment_method"],
    },
    fallbackBehavior: "required",
    cacheable: false,
    category: "checkout",
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

export default toolRegistry;
