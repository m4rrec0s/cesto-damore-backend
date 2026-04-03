/**
 * Router Determinístico - Substituição completa da LLM
 * 
 * Este serviço implementa roteamento baseado em keywords, sinônimos
 * e score de similaridade, sem depender de chamadas OpenAI.
 */

import type { FlowCatalogNode, RouterDecision } from "../types/flowRouter";
import logger from "../utils/logger";
import { BOT_CONFIG } from "../config/botConfig";

// Mapa de sinônimos para expandir matching
const MENU_SYNONYMS: Record<string, string[]> = {
  // Produtos
  cestas: ["cesta", "cesto", "basket", "kit", "conjunto"],
  flores: ["flor", "buque", "buquê", "rosas", "rosa", "girassol", "arranjo"],
  buques: ["buque", "buquê", "bouquet", "flores"],
  chocolate: ["chocolates", "choco", "ferrero", "trufas"],
  pelucia: ["pelúcia", "urso", "ursinho", "plush", "bicho"],
  caneca: ["canecas", "mug", "xícara", "xicara"],
  quadro: ["quadros", "porta-retrato", "moldura"],
  
  // Navegação
  voltar: ["volta", "retorna", "retornar", "menu", "anterior"],
  inicio: ["inicial", "começo", "comeco", "start", "principal"],
  menu: ["menus", "opcoes", "opções", "lista"],
  catalogo: ["catálogo", "produtos", "itens", "ver", "mostrar"],
  
  // Ações
  comprar: ["adquirir", "pedir", "encomendar", "quero"],
  entrega: ["entregar", "delivery", "frete", "enviar", "envio"],
  pagamento: ["pagar", "pix", "cartao", "cartão", "boleto", "débito", "credito"],
  
  // Informações
  horario: ["horário", "hora", "funcionamento", "aberto", "fechado", "atendimento"],
  preco: ["preço", "valor", "valores", "quanto", "custo", "precos", "preços"],
  local: ["localização", "localizacao", "endereço", "endereco", "onde", "aonde"],
  
  // Ocasiões
  aniversario: ["aniversário", "niver", "birthday", "parabens", "parabéns"],
  namorados: ["namorado", "namorada", "amor", "casal"],
  mae: ["mãe", "mamãe", "mamae", "mother"],
  pai: ["papai", "papa", "father"],
  natal: ["natalino", "christmas"],
  pascoa: ["páscoa"],
  
  // Checkout
  confirmar: ["confirma", "sim", "ok", "aceitar", "aceito"],
  cancelar: ["cancela", "não", "nao", "recusar", "desistir"],
  
  // Suporte
  humano: ["atendente", "pessoa", "atendimento", "suporte", "ajuda"],
  falar: ["conversar", "contato", "comunicar"],
};

// Keywords que indicam intenção de voltar ao menu principal
const MAIN_MENU_KEYWORDS = [
  "menu principal",
  "primeiro menu",
  "voltar menu",
  "inicio",
  "inicial",
  "começo",
  "comeco",
  "menu",
  "opcoes",
  "opções",
];

// Keywords que indicam solicitação de atendimento humano
const HUMAN_HANDOFF_KEYWORDS = [
  "atendente",
  "atendimento",
  "humano",
  "pessoa",
  "suporte",
  "falar com",
  "conversar com",
  "ajuda",
];

// Keywords suspeitas (tentativa de manipulação)
const SUSPICIOUS_KEYWORDS = [
  "prompt",
  "instrucoes internas",
  "instrucao interna",
  "chave pix",
  "dados bancarios",
  "token",
  "api key",
  "sistema",
  "banco de dados",
  "database",
];

class DeterministicRouterService {
  /**
   * Normaliza texto removendo acentos, convertendo para minúsculas
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Tokeniza texto em palavras individuais, removendo stopwords
   */
  private tokenize(text: string): string[] {
    const normalized = this.normalizeText(text);
    const stopwords = new Set([
      "o",
      "a",
      "os",
      "as",
      "um",
      "uma",
      "de",
      "da",
      "do",
      "das",
      "dos",
      "em",
      "no",
      "na",
      "nos",
      "nas",
      "por",
      "para",
      "com",
      "sem",
      "e",
      "ou",
      "que",
      "qual",
      "quais",
    ]);

    return normalized
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !stopwords.has(token));
  }

  /**
   * Expande tokens com sinônimos se configurado
   */
  private expandTokensWithSynonyms(tokens: string[]): Set<string> {
    const expanded = new Set(tokens);

    if (!BOT_CONFIG.deterministicRouter.useExpandedSynonyms) {
      return expanded;
    }

    for (const token of tokens) {
      for (const [base, synonyms] of Object.entries(MENU_SYNONYMS)) {
        if (synonyms.includes(token) || token === base) {
          expanded.add(base);
          synonyms.forEach((syn) => expanded.add(syn));
        }
      }
    }

    return expanded;
  }

  /**
   * Verifica se mensagem contém alguma keyword da lista
   */
  private containsAnyKeyword(normalized: string, keywords: string[]): boolean {
    return keywords.some((kw) => normalized.includes(kw));
  }

  /**
   * Calcula score de similaridade entre mensagem do usuário e um node
   */
  private scoreNodeMatch(
    expandedTokens: Set<string>,
    originalTokens: string[],
    node: FlowCatalogNode,
  ): number {
    let score = 0;

    // 1. Match com keywords do node (peso 3)
    if (Array.isArray(node.keywords)) {
      for (const keyword of node.keywords) {
        const normalizedKeyword = this.normalizeText(keyword);
        if (expandedTokens.has(normalizedKeyword)) {
          score += 3;
        }
        // Partial match
        for (const token of originalTokens) {
          if (
            normalizedKeyword.includes(token) ||
            token.includes(normalizedKeyword)
          ) {
            score += 1;
          }
        }
      }
    }

    // 2. Match com título do node (peso 2)
    const titleTokens = this.tokenize(node.title);
    for (const token of titleTokens) {
      if (expandedTokens.has(token)) {
        score += 2;
      }
    }

    // 3. Match com summary (peso 1)
    if (node.summary) {
      const summaryTokens = this.tokenize(node.summary);
      for (const token of summaryTokens) {
        if (expandedTokens.has(token)) {
          score += 1;
        }
      }
    }

    // 4. Match com when_to_use (peso 2)
    if (node.when_to_use) {
      const whenTokens = this.tokenize(node.when_to_use);
      for (const token of whenTokens) {
        if (expandedTokens.has(token)) {
          score += 2;
        }
      }
    }

    // 5. Match com examples (peso 1.5)
    if (Array.isArray(node.examples)) {
      for (const example of node.examples) {
        const exampleTokens = this.tokenize(example);
        for (const token of exampleTokens) {
          if (expandedTokens.has(token)) {
            score += 1.5;
          }
        }
      }
    }

    return score;
  }

  /**
   * Verifica se node pode ser usado para roteamento
   */
  private isRoutableNode(node: FlowCatalogNode): boolean {
    // Excluir nodes especiais
    if (node.type === "startNode" || node.type === "blockNode") {
      return false;
    }

    return true;
  }

  /**
   * Encontra o node do menu principal
   */
  private findMainMenuNode(flowCatalog: FlowCatalogNode[]): FlowCatalogNode | null {
    // Procurar por node com título "Menu Principal" ou similar
    const mainMenuNode = flowCatalog.find(
      (node) =>
        node.type === "menuNode" &&
        (this.normalizeText(node.title).includes("menu principal") ||
          this.normalizeText(node.title).includes("menu inicial") ||
          node.keywords?.some((kw) =>
            this.normalizeText(kw).includes("menu principal"),
          )),
    );

    if (mainMenuNode) return mainMenuNode;

    // Fallback: primeiro menuNode encontrado
    return flowCatalog.find((node) => node.type === "menuNode") || null;
  }

  /**
   * Encontra melhor node de produtos/cestas
   */
  private findProductMenuNode(flowCatalog: FlowCatalogNode[]): FlowCatalogNode | null {
    const productNodes = flowCatalog.filter(
      (node) =>
        node.type === "menuNode" &&
        (node.keywords?.some((kw) => {
          const nkw = this.normalizeText(kw);
          return (
            nkw.includes("produto") ||
            nkw.includes("cesta") ||
            nkw.includes("tipo") ||
            nkw.includes("categoria")
          );
        }) ||
          this.normalizeText(node.title).includes("tipo") ||
          this.normalizeText(node.title).includes("categoria") ||
          this.normalizeText(node.title).includes("produto")),
    );

    return productNodes[0] || null;
  }

  /**
   * Router determinístico principal - substitui LLM completamente
   */
  public routeDeterministic(
    userMessage: string,
    flowCatalog: FlowCatalogNode[],
    currentNodeId: string | null,
  ): RouterDecision {
    const normalized = this.normalizeText(userMessage);
    const originalTokens = this.tokenize(normalized);
    const expandedTokens = this.expandTokensWithSynonyms(originalTokens);

    if (BOT_CONFIG.deterministicRouter.logDecisions) {
      logger.info(
        `[DeterministicRouter] Input: "${userMessage}" | Tokens: ${Array.from(expandedTokens).join(", ")}`,
      );
    }

    // 1. Detectar tentativas suspeitas
    if (this.containsAnyKeyword(normalized, SUSPICIOUS_KEYWORDS)) {
      logger.warn(
        `[DeterministicRouter] Suspicious request detected: "${userMessage}"`,
      );
      return {
        action: "handoff_human",
        confidence: 1,
        reason: "Tentativa de acesso a dados internos ou manipulação detectada",
      };
    }

    // 2. Detectar solicitação de atendimento humano
    if (this.containsAnyKeyword(normalized, HUMAN_HANDOFF_KEYWORDS)) {
      if (BOT_CONFIG.deterministicRouter.logDecisions) {
        logger.info("[DeterministicRouter] Human handoff requested");
      }
      return {
        action: "handoff_human",
        confidence: 1,
        reason: "Cliente solicitou atendimento humano",
      };
    }

    // 3. Detectar volta para menu principal
    if (this.containsAnyKeyword(normalized, MAIN_MENU_KEYWORDS)) {
      const mainMenu = this.findMainMenuNode(flowCatalog);
      if (mainMenu) {
        if (BOT_CONFIG.deterministicRouter.logDecisions) {
          logger.info(
            `[DeterministicRouter] Main menu requested → ${mainMenu.id}`,
          );
        }
        return {
          action: "route_node",
          node_id: mainMenu.id,
          confidence: 0.95,
          reason: "Cliente solicitou voltar ao menu principal",
        };
      }
    }

    // 4. Detectar consultas genéricas de preço
    const vaguePriceQuery =
      normalized === "valor" ||
      normalized === "valores" ||
      normalized === "preco" ||
      normalized === "precos" ||
      normalized === "preço" ||
      normalized === "preços" ||
      normalized === "quanto" ||
      normalized === "quanto custa" ||
      normalized === "faixa de preco" ||
      normalized === "faixa de preço";

    if (vaguePriceQuery) {
      const productMenu = this.findProductMenuNode(flowCatalog);
      if (productMenu) {
        if (BOT_CONFIG.deterministicRouter.logDecisions) {
          logger.info(
            `[DeterministicRouter] Vague price query → ${productMenu.id}`,
          );
        }
        return {
          action: "route_node",
          node_id: productMenu.id,
          confidence: 0.9,
          reason: "Consulta de preço genérica - direcionado para menu de produtos",
        };
      }
    }

    // 5. Pontuar todos os nodes
    const routableNodes = flowCatalog.filter((n) => this.isRoutableNode(n));
    const scoredNodes = routableNodes
      .map((node) => ({
        node,
        score: this.scoreNodeMatch(expandedTokens, originalTokens, node),
      }))
      .sort((a, b) => b.score - a.score);

    if (BOT_CONFIG.deterministicRouter.logDecisions && scoredNodes.length > 0) {
      logger.info(
        `[DeterministicRouter] Top 3 matches: ${scoredNodes
          .slice(0, 3)
          .map((s) => `${s.node.title} (${s.score})`)
          .join(", ")}`,
      );
    }

    // 6. Se melhor score >= threshold, roteia
    const bestMatch = scoredNodes[0];
    if (bestMatch && bestMatch.score >= BOT_CONFIG.deterministicRouter.minScoreThreshold) {
      if (BOT_CONFIG.deterministicRouter.logDecisions) {
        logger.info(
          `[DeterministicRouter] Match found: ${bestMatch.node.title} (score: ${bestMatch.score}) → ${bestMatch.node.id}`,
        );
      }
      return {
        action: "route_node",
        node_id: bestMatch.node.id,
        confidence: Math.min(bestMatch.score / 10, 0.95),
        reason: `Match por keywords: ${bestMatch.node.title}`,
      };
    }

    // 7. Fallback: permanece no node atual ou vai para menu principal
    const mainMenu = this.findMainMenuNode(flowCatalog);
    const fallbackNodeId = mainMenu?.id || currentNodeId || "";

    if (BOT_CONFIG.deterministicRouter.logDecisions) {
      logger.info(
        `[DeterministicRouter] No strong match (best: ${bestMatch?.score || 0}), fallback to ${fallbackNodeId}`,
      );
    }

    return {
      action: "route_node",
      node_id: fallbackNodeId,
      confidence: 0.3,
      reason: `Nenhum match forte encontrado (melhor: ${bestMatch?.score || 0}). Mostrando menu.`,
    };
  }
}

export default new DeterministicRouterService();
