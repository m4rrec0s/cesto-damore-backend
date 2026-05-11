/**
 * Tipos centralizados para sistema de Tools e Busca de Produtos
 * Usado para comunicação entre Backend e MCP Server
 */

import type { SalesPhase } from "../services/phaseGateService";

// ============================================================================
// TOOL DEFINITIONS & REGISTRY
// ============================================================================

/**
 * Interface para definição de uma ferramenta (Tool) do MCP
 * Permite orquestração inteligente e filtragem por fase
 */
export interface IToolDefinition {
  /** Nome único da ferramenta */
  name: string;

  /** Descrição legível */
  description: string;

  /** Fases de venda onde essa tool é permitida */
  allowedPhases: SalesPhase[];

  /** Prioridade relativa (0-100, maior = mais importante) */
  priority: number;

  /** JSON Schema do input (compatible com OpenAI) */
  inputSchema: Record<string, any>;

  /** Comportamento em fallback: 'optional' não bloqueia, 'required' bloqueia fluxo */
  fallbackBehavior: "optional" | "required";

  /** Se true, resultados são cached por TTL */
  cacheable: boolean;

  /** TTL em segundos (0 = sem cache) */
  cacheTTL?: number;

  /** Se true, tool pode ser executada sem input explícito do LLM */
  autoExecutable?: boolean;

  /** Categoria para agrupamento lógico */
  category?: "product_search" | "delivery" | "checkout" | "knowledge" | "admin";

  /** Controle de taxa (máximo de execuções por minuto) */
  rateLimit?: number;
}

// ============================================================================
// TOOL RESULTS
// ============================================================================

/**
 * Resultado genérico de execução de uma ferramenta
 */
export interface IToolResult<T = any> {
  /** Nome da tool executada */
  toolName: string;

  /** Input que foi passado */
  input: Record<string, any>;

  /** Resultado da execução */
  output: T;

  /** Sucesso da execução */
  success: boolean;

  /** Mensagem de erro (se houver) */
  error?: string;

  /** Timestamp da execução */
  executedAt: string;

  /** Hash para cache (MD5 do input) */
  cacheHash?: string;

  /** Se resultado veio do cache */
  fromCache?: boolean;

  /** Tempo de execução em ms */
  executionTimeMs?: number;

  /** Raciocínio interno (para debugar decisões) */
  reasoning?: string;
}

// ============================================================================
// PRODUCT SEARCH & RANKING
// ============================================================================

/**
 * Tipo de produto (categorização automática)
 */
export enum ProductType {
  QUADRO_FOTO = "QUADRO_FOTO", // Quadros, Polaroides, Fotos
  FLOR = "FLOR", // Buquês, Rosas, Flores
  PELUCIA = "PELUCIA", // Pelúcias, Ursos
  QUEBRA_CABECA = "QUEBRA_CABECA", // Quebra-cabeças
  CANECA = "CANECA", // Canecas
  BAR_DRINKS = "BAR_DRINKS", // Coquetéis, Drinks
  CESTA = "CESTA", // Cestas (padrão)
}

/**
 * Produto com metadados de busca/ranking
 */
export interface SearchableProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  imageUrl?: string;

  /** Categoria automática */
  productType?: ProductType;

  /** Score de similaridade semântica (0-1) */
  similarityScore?: number;

  /** Bônus por relevância contextual (fase, histórico) */
  contextBonus?: number;

  /** Score final de relevância */
  relevanceScore?: number;

  /** Razão pela qual foi ranqueado (para debug) */
  rankingReason?: string;

  /** Se está sendo "focado" na sessão atual */
  isFocused?: boolean;
}

/**
 * Estratégia de busca usada
 */
export enum SearchStrategy {
  VECTOR = "VECTOR", // Embedding + cosine similarity
  KEYWORD = "KEYWORD", // Busca textual
  HYBRID = "HYBRID", // Combinação de vetor + keyword
  SEMANTIC_EXPAND = "SEMANTIC_EXPAND", // Com query rewriting (sinônimos)
  CONTEXT_AWARE = "CONTEXT_AWARE", // Considerando histórico da sessão
}

/**
 * Resultado de uma busca de produtos
 */
export interface IProductSearchResult extends IToolResult {
  output: {
    /** Produtos encontrados (já ranqueados) */
    products: SearchableProduct[];

    /** Estratégia usada nesta busca */
    strategy: SearchStrategy;

    /** Detalhes do ranking */
    rankingDetails: {
      /** Termo de busca original */
      originalQuery: string;

      /** Termo expandido (com sinônimos) se aplicável */
      expandedQuery?: string;

      /** Número de produtos considerados antes de ranking */
      candidatesCount: number;

      /** Score mínimo de relevância usado para filtrar */
      minRelevanceThreshold: number;
    };

    /** Recomendações adicionais para refinar busca */
    suggestions?: string[];

    /** Se nenhum produto foi encontrado com score adequado */
    hadFallback: boolean;

    /** Tempo da busca vetorial (ms) */
    vectorSearchTimeMs?: number;

    /** Tempo do ranking (ms) */
    rankingTimeMs?: number;
  };
}

// ============================================================================
// QUERY EXPANSION & CONTEXT
// ============================================================================

/**
 * Mapa de sinônimos para expansão de query
 */
export interface QuerySynonymMap {
  [term: string]: string[];
}

/**
 * Contexto da conversa para melhorar busca
 */
export interface SearchContext {
  /** Últimos turnos da conversa (últimos 5) */
  conversationHistory: {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }[];

  /** Produtos já apresentados nesta sessão */
  presentedProductIds: string[];

  /** Tipo de produto que o cliente mostrou interesse */
  preferredProductTypes?: ProductType[];

  /** Faixa de preço preferida */
  priceRange?: {
    min?: number;
    max?: number;
  };

  /** Fase de vendas atual */
  currentPhase: SalesPhase;

  /** Histórico de compras do cliente (se conhecido) */
  customerPurchaseHistory?: {
    productType: ProductType;
    count: number;
  }[];

  /** Intent detectado na mensagem atual */
  detectedIntent?: string; // 'browse', 'price_check', 'recommendation', etc
}

// ============================================================================
// CURATION (Fase 2)
// ============================================================================

/**
 * Estratégia de curadoria para uma recomendação
 */
export interface ICurationStrategy {
  /** ID do produto sendo recomendado */
  productId: string;

  /** Por que este produto foi escolhido */
  reasoning: string;

  /** Fase onde se aplica melhor */
  bestForPhase: SalesPhase;

  /** Nível de engajamento esperado (1-5) */
  expectedEngagement: number;

  /** Alternativas caso o cliente rejeite */
  alternativeIds?: string[];

  /** Timestamp da curadoria */
  curatedAt: string;
}

// ============================================================================
// SKILL SYSTEM (Fase 4)
// ============================================================================

/**
 * Definição de um Skill (conhecimento carregável sob demanda)
 */
export interface ISkillDefinition {
  /** ID único do skill */
  id: string;

  /** Nome legível */
  name: string;

  /** Descrição breve */
  description: string;

  /** Intents que ativam este skill */
  triggers: string[];

  /** Fases onde é relevante */
  phases: SalesPhase[];

  /** Conteúdo do skill (pode ser markdown, JSON, etc) */
  content: string;

  /** Estimativa de tokens que esse skill ocupa */
  estimatedTokens: number;

  /** Prioridade se houver limite de contexto (0-100) */
  priority: number;

  /** TTL em minutos (quanto tempo manter na memória ativa) */
  ttl?: number;

  /** Categoria */
  category?: "product" | "delivery" | "payment" | "troubleshooting" | "general";
}

/**
 * Skill carregado na sessão
 */
export interface IActiveSkill extends ISkillDefinition {
  /** Quando foi carregado */
  loadedAt: string;

  /** Se foi recently used */
  lastAccessedAt: string;

  /** Score de relevância atual (0-1) */
  relevanceScore: number;
}

// ============================================================================
// CONTEXT COMPRESSION (Fase 4)
// ============================================================================

/**
 * Tópico identificado na conversa (para compressão)
 */
export interface IConversationTopic {
  /** Identificador do tópico */
  id: string;

  /** Nome do tópico (ex: "frete", "produto_X", "entrega") */
  name: string;

  /** Contexto original (pode ser longo) */
  originalContext: string;

  /** Contexto compactado (1-2 linhas chave) */
  compactedContext: string;

  /** Número de mensagens neste tópico */
  messageCount: number;

  /** Relevância para o fluxo atual (0-1) */
  relevance: number;

  /** Se deve ser mantido em contexto ou arquivado */
  archived: boolean;
}

/**
 * Estado da compressão de contexto
 */
export interface IContextCompressionState {
  /** Tópicos identificados */
  topics: IConversationTopic[];

  /** Estimativa atual de tokens */
  estimatedTokens: number;

  /** Limite de tokens da sessão */
  tokenBudget: number;

  /** Percentual de uso */
  utilizationPercent: number;

  /** Se compressão foi aplicada na última iteração */
  wasCompressed: boolean;

  /** Timestamp da última compressão */
  lastCompressionAt?: string;

  /** Checkpoints (resumos de conversas completas) */
  checkpoints: Array<{
    turnNumber: number;
    summary: string;
    tokensRecovered: number;
  }>;
}

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/**
 * Estimativa de tokens de um texto
 */
export interface ITokenEstimate {
  /** Texto estimado */
  text: string;

  /** Estimativa de tokens (simplificado: ~4 chars = 1 token) */
  estimatedTokens: number;

  /** Método usado ('heuristic' ou 'tiktoken') */
  method: "heuristic" | "tiktoken";

  /** Se estimativa pode ser imprecisa */
  isEstimate: boolean;
}
