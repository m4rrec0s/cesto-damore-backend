/**
 * 📊 PHASE 4: Token Estimator Utility
 * 
 * Estima tokens em uma string sem chamar API OpenAI.
 * Usa heurística simples: 1 token ≈ 4 caracteres (para Português)
 * 
 * Mais preciso que character count, menos preciso que real tokenization,
 * mas suficiente para alocar contexto dinamicamente.
 */

export interface TokenEstimate {
  text: string;
  characterCount: number;
  tokenEstimate: number;
  wordCount: number;
  lineCount: number;
}

export interface ContextBudget {
  systemPrompt: number;
  conversationHistory: number;
  knowledge: number;
  availableForResponse: number;
  total: number;
  utilisationPercent: number;
}

export class TokenEstimator {
  // Empirical constant: Português tem ~4 chars por token
  private static readonly CHARS_PER_TOKEN_PT = 4;
  
  // Overhead de structure (JSON formatting, separators, etc)
  private static readonly STRUCTURE_OVERHEAD = 0.1; // 10%
  
  // Máximo recomendado antes de começar a comprimir contexto
  private static readonly COMPRESSION_THRESHOLD = 0.8; // 80% de uso

  /**
   * Estima quantidade de tokens em um texto
   */
  static estimate(text: string): TokenEstimate {
    const characterCount = text.length;
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const lineCount = text.split("\n").length;
    
    // Heurística: 1 token ≈ 4 chars (português tem mais caracteres por token que inglês)
    let tokenEstimate = Math.ceil(characterCount / TokenEstimator.CHARS_PER_TOKEN_PT);
    
    // Adicionar overhead por estrutura (JSON, markdown, etc)
    tokenEstimate = Math.ceil(tokenEstimate * (1 + TokenEstimator.STRUCTURE_OVERHEAD));
    
    return {
      text,
      characterCount,
      tokenEstimate,
      wordCount,
      lineCount
    };
  }

  /**
   * Estima tokens em multiplas strings
   */
  static estimateMultiple(texts: string[]): number {
    return texts.reduce((sum, text) => sum + TokenEstimator.estimate(text).tokenEstimate, 0);
  }

  /**
   * Calcula orçamento de contexto para conversação
   * 
   * Orçamento típico (modelo 4k context):
   * - System prompt: ~500 tokens
   * - Conhecimento (skills): ~800 tokens
   * - Histórico: até 2000 tokens
   * - Resposta: ~700 tokens
   * TOTAL: ~4000 tokens
   */
  static calculateContextBudget(
    systemPrompt: string,
    conversationHistory: string,
    knowledge: string,
    maxContextTokens: number = 4000
  ): ContextBudget {
    const systemEstimate = TokenEstimator.estimate(systemPrompt).tokenEstimate;
    const historyEstimate = TokenEstimator.estimate(conversationHistory).tokenEstimate;
    const knowledgeEstimate = TokenEstimator.estimate(knowledge).tokenEstimate;
    
    // Reserva ~15% para resposta (prompt_tokens response)
    const responseReserve = Math.ceil(maxContextTokens * 0.15);
    
    const utilisedTokens = systemEstimate + historyEstimate + knowledgeEstimate + responseReserve;
    const availableForResponse = Math.max(0, maxContextTokens - utilisedTokens);
    const utilisationPercent = utilisedTokens / maxContextTokens;

    return {
      systemPrompt: systemEstimate,
      conversationHistory: historyEstimate,
      knowledge: knowledgeEstimate,
      availableForResponse,
      total: maxContextTokens,
      utilisationPercent
    };
  }

  /**
   * Verifica se contexto precisa ser comprimido
   */
  static shouldCompress(utilisationPercent: number): boolean {
    return utilisationPercent > TokenEstimator.COMPRESSION_THRESHOLD;
  }

  /**
   * Retorna quantos tokens podem ser salvos se removemos um componente
   */
  static calculateSavings(text: string): number {
    return TokenEstimator.estimate(text).tokenEstimate;
  }

  /**
   * Trunca texto para caber em um orçamento de tokens
   */
  static truncateToTokenBudget(text: string, maxTokens: number): string {
    const estimate = TokenEstimator.estimate(text);
    
    if (estimate.tokenEstimate <= maxTokens) {
      return text;
    }

    // Aproximação: manter proporção de caracteres
    const targetChars = Math.floor(
      (text.length * maxTokens) / estimate.tokenEstimate * 0.9 // 90% para margem
    );

    if (targetChars <= 0) return "...";
    
    return text.substring(0, targetChars) + "...";
  }

  /**
   * Estima tokens de um objeto JSON (common case)
   */
  static estimateJSON(obj: object): number {
    const json = JSON.stringify(obj);
    return TokenEstimator.estimate(json).tokenEstimate;
  }

  /**
   * Recomendação: quantos tokens são necessários comprimir?
   */
  static compressionNeeded(currentTokens: number, maxTokens: number): number {
    const threshold = maxTokens * TokenEstimator.COMPRESSION_THRESHOLD;
    return Math.max(0, currentTokens - Math.floor(threshold * 0.9));
  }

  /**
   * Breakdown detalhado do uso de contexto (para debugging)
   */
  static printContextBreakdown(budget: ContextBudget): string {
    const lines = [
      "=== CONTEXT BUDGET BREAKDOWN ===",
      `System Prompt: ${budget.systemPrompt} tokens`,
      `Conversation: ${budget.conversationHistory} tokens`,
      `Knowledge: ${budget.knowledge} tokens`,
      `Response Reserve: ${budget.total - budget.systemPrompt - budget.conversationHistory - budget.knowledge - budget.availableForResponse} tokens`,
      `Available for Response: ${budget.availableForResponse} tokens`,
      `---`,
      `Total Used: ${budget.total - budget.availableForResponse} / ${budget.total} tokens`,
      `Utilisation: ${(budget.utilisationPercent * 100).toFixed(1)}%`,
      budget.utilisationPercent > TokenEstimator.COMPRESSION_THRESHOLD
        ? `⚠️ CRITICAL: Compression needed! (>${TokenEstimator.COMPRESSION_THRESHOLD * 100}%)`
        : `✅ Healthy usage`,
      "================================"
    ];
    return lines.join("\n");
  }
}

export default TokenEstimator;
