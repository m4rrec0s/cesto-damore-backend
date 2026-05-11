/**
 * 🗜️ PHASE 4: Context Compressor Service
 * 
 * Compacta conversação quando tokens chegam perto do limite.
 * Mantém informações essenciais, remove contexto obsoleto.
 * 
 * Estratégia:
 * 1. Identifica "tópicos principais" (produto, frete, data, etc)
 * 2. Resuma cada tópico em 1-2 linhas chave
 * 3. Remove duplicatas e turnas antigas (>30 turnos)
 * 4. Mantém apenas últimas N mensagens + checkpoint comprimido
 */

import TokenEstimator from "../utils/tokenEstimator";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ConversationCheckpoint {
  turnsProcessed: number;
  keyTopics: Map<string, string>; // topic -> summary
  createdAt: number;
}

export interface CompressionResult {
  original: {
    turnCount: number;
    tokenCount: number;
  };
  compressed: {
    turnCount: number;
    tokenCount: number;
    checkpoint: ConversationCheckpoint;
  };
  savings: {
    tokensSaved: number;
    percentSaved: number;
  };
}

export class ContextCompressorService {
  private static instance: ContextCompressorService;

  private constructor() {}

  static getInstance(): ContextCompressorService {
    if (!ContextCompressorService.instance) {
      ContextCompressorService.instance = new ContextCompressorService();
    }
    return ContextCompressorService.instance;
  }

  /**
   * Comprime histórico de conversação
   * 
   * Mantém: últimas N turnos + checkpoint comprimido dos anteriores
   */
  compressConversation(
    turns: ConversationTurn[],
    maxTurnsToKeep: number = 10,
    compressionThreshold: number = 0.8
  ): ConversationResult {
    const originalTokens = TokenEstimator.estimate(
      turns.map(t => t.content).join("\n")
    ).tokenEstimate;

    // Se ainda não atingiu threshold, não comprimir
    if (originalTokens < compressionThreshold * 4000) {
      return {
        original: { turnCount: turns.length, tokenCount: originalTokens },
        compressed: { turnCount: turns.length, tokenCount: originalTokens },
        checkpoint: null,
        savings: { tokensSaved: 0, percentSaved: 0 }
      };
    }

    // Separar turnos a comprimir dos recentes
    const toCompress = turns.slice(0, turns.length - maxTurnsToKeep);
    const toKeep = turns.slice(turns.length - maxTurnsToKeep);

    // Gerar checkpoint dos turnos antigos
    const checkpoint = this._generateCheckpoint(toCompress);

    // Montar resultado
    const compressedTurns = toKeep;
    const compressedContent = compressedTurns.map(t => t.content).join("\n");
    const checkpointText = this._checkpointToString(checkpoint);
    const compressedTokens = TokenEstimator.estimate(
      checkpointText + compressedContent
    ).tokenEstimate;

    return {
      original: { turnCount: turns.length, tokenCount: originalTokens },
      compressed: { turnCount: compressedTurns.length, tokenCount: compressedTokens, checkpoint },
      checkpoint: checkpointText,
      savings: {
        tokensSaved: originalTokens - compressedTokens,
        percentSaved: ((originalTokens - compressedTokens) / originalTokens) * 100
      }
    };
  }

  /**
   * Gera checkpoint com tópicos principais
   */
  private _generateCheckpoint(turns: ConversationTurn[]): ConversationCheckpoint {
    const keyTopics = new Map<string, string>();

    // Extrai tópicos principais
    for (const turn of turns) {
      const topics = this._extractTopics(turn.content);
      for (const [topic, summary] of Object.entries(topics)) {
        keyTopics.set(topic, summary);
      }
    }

    return {
      turnsProcessed: turns.length,
      keyTopics,
      createdAt: Date.now()
    };
  }

  /**
   * Extrai tópicos principais de uma mensagem
   */
  private _extractTopics(text: string): Record<string, string> {
    const lower = text.toLowerCase();
    const topics: Record<string, string> = {};

    // Padrões de extração
    const patterns = [
      {
        key: "produto",
        regex: /(?:quero|escolhi|prefiro|produto|cesta|buquê|quadro|caneca|chocolate)\s+([a-z\s]+?)(?:\.|,|$|para|com)/,
        extractor: (m: RegExpMatchArray) =>
          `Produto escolhido: ${m[1]?.trim() || "indefinido"}`
      },
      {
        key: "entrega",
        regex: /(?:entrega|frete|data|horário|quando)\s+(?:em|à|para)?\s+([a-z0-9\s]+?)(?:\.|,|$)/,
        extractor: (m: RegExpMatchArray) =>
          `Entrega/prazo: ${m[1]?.trim() || "não especificado"}`
      },
      {
        key: "pagamento",
        regex: /(?:pag|cartão|pix|boleto|crédito)\s+([a-z\s]+?)(?:\.|,|$)/,
        extractor: (m: RegExpMatchArray) =>
          `Pagamento: ${m[1]?.trim() || "indefinido"}`
      },
      {
        key: "personalização",
        regex: /(?:personalizar|quadro|caneca|adicionar|foto|frase)\s+([a-z\s]+?)(?:\.|,|$|com)/,
        extractor: (m: RegExpMatchArray) =>
          `Personalização: ${m[1]?.trim() || "sim"}`
      },
      {
        key: "endereço",
        regex: /(?:endereço|bairro|cidade|rua|logradouro|puxinanã|campina|são josé)\s+([a-z\s]+?)(?:\.|,|$)/,
        extractor: (m: RegExpMatchArray) =>
          `Local: ${m[1]?.trim() || "indefinido"}`
      }
    ];

    for (const { key, regex, extractor } of patterns) {
      const match = text.match(regex);
      if (match) {
        topics[key] = extractor(match);
      }
    }

    return topics;
  }

  /**
   * Converte checkpoint para string formatada
   */
  private _checkpointToString(checkpoint: ConversationCheckpoint): string {
    const topics = Array.from(checkpoint.keyTopics.entries())
      .map(([topic, summary]) => `• **${topic}:** ${summary}`)
      .join("\n");

    return `
## 📋 RESUMO HISTÓRICO (${checkpoint.turnsProcessed} turnos anteriores comprimidos)

${topics}

---
`.trim();
  }

  /**
   * Detecta se contexto precisa ser comprimido
   */
  shouldCompress(currentTokens: number, maxTokens: number = 4000): boolean {
    const threshold = maxTokens * 0.8;
    return currentTokens > threshold;
  }

  /**
   * Remove duplicatas em histórico
   */
  deduplicateTurns(turns: ConversationTurn[]): ConversationTurn[] {
    const seen = new Set<string>();
    return turns.filter(turn => {
      const hash = this._hashTurn(turn);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }

  /**
   * Hash para detectar turnas idênticas
   */
  private _hashTurn(turn: ConversationTurn): string {
    const content = turn.content.substring(0, 100); // Primeiros 100 chars
    return `${turn.role}:${content}`;
  }

  /**
   * Remove turnos muito antigos (>30 minutos)
   */
  removeStaleMessages(
    turns: ConversationTurn[],
    maxAgeMinutes: number = 30
  ): ConversationTurn[] {
    const cutoffTime = Date.now() - maxAgeMinutes * 60 * 1000;
    return turns.filter(turn => turn.timestamp > cutoffTime);
  }

  /**
   * Recomendação: estratégia de compressão
   */
  recommendCompressionStrategy(
    currentTokens: number,
    maxTokens: number,
    turnCount: number
  ): string {
    const utilisation = currentTokens / maxTokens;

    if (utilisation < 0.7) {
      return "✅ Nenhuma ação necessária. Contexto saudável.";
    } else if (utilisation < 0.8) {
      return "⚠️ AVISO: Contexto próximo do limite. Considere comprimir na próxima mensagem.";
    } else if (utilisation < 0.9) {
      return "🔴 CRÍTICO: Comprima AGORA. Contexto em ~80% do limite.";
    } else {
      return "🚨 EMERGÊNCIA: Comprima IMEDIATAMENTE. Contexto em >90%.";
    }
  }
}

export interface CompressionResult {
  original: { turnCount: number; tokenCount: number };
  compressed: { turnCount: number; tokenCount: number; checkpoint?: ConversationCheckpoint };
  checkpoint?: string;
  savings: { tokensSaved: number; percentSaved: number };
}

export default ContextCompressorService.getInstance();
