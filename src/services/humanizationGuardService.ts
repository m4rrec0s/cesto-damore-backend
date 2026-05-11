/**
 * 🛡️ PHASE 3: HumanizationGuard Service
 * 
 * Valida respostas da IA contra guidelines de humanização.
 * Detecta: linguagem robótica, emojis excessivos, erros de formatação,
 * vazamento de contexto interno, pressão de venda inadequada.
 */

import { HUMANIZATION, PERSONA_BY_PHASE, TONE_BY_SENTIMENT } from "../config/humanization";

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-1
  violations: string[];
  warnings: string[];
  suggestions: string[];
  phase: string;
}

export class HumanizationGuardService {
  private static instance: HumanizationGuardService;

  private constructor() {}

  static getInstance(): HumanizationGuardService {
    if (!HumanizationGuardService.instance) {
      HumanizationGuardService.instance = new HumanizationGuardService();
    }
    return HumanizationGuardService.instance;
  }

  /**
   * Valida resposta contra guidelines de humanização
   */
  validate(
    response: string,
    phase: string,
    customerContext?: { sentiment?: string; product_count?: number }
  ): ValidationResult {
    const violations: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    let score = 1.0;

    // 1. Detectar linguagem robótica
    const roboticViolations = this._checkRobotic(response, phase);
    violations.push(...roboticViolations.violations);
    warnings.push(...roboticViolations.warnings);
    score -= roboticViolations.violations.length * 0.15;
    score -= roboticViolations.warnings.length * 0.05;

    // 2. Detectar emojis excessivos
    const emojiViolation = this._checkEmojis(response, phase);
    if (emojiViolation.violation) {
      violations.push(emojiViolation.violation);
      score -= 0.15;
    }
    if (emojiViolation.warning) {
      warnings.push(emojiViolation.warning);
      score -= 0.05;
    }

    // 3. Detectar vazamento de contexto
    const contextViolations = this._checkContextLeakage(response);
    violations.push(...contextViolations);
    score -= contextViolations.length * 0.2;

    // 4. Detectar erros de formatação WhatsApp
    const formatViolations = this._checkWhatsAppFormat(response);
    violations.push(...formatViolations);
    score -= formatViolations.length * 0.1;

    // 5. Detectar pressão de venda inadequada
    const pressureViolation = this._checkSalesPressure(response, phase);
    if (pressureViolation) {
      violations.push(pressureViolation);
      score -= 0.2;
    }

    // 6. Validar comprimento
    const lengthViolation = this._checkLength(response, phase);
    if (lengthViolation) {
      warnings.push(lengthViolation);
      score -= 0.05;
    }

    // 7. Gerar sugestões de melhoria
    if (score < 0.8) {
      suggestions.push(...this._suggestImprovements(response, phase, violations));
    }

    return {
      isValid: violations.length === 0,
      score: Math.max(0, score),
      violations,
      warnings,
      suggestions,
      phase
    };
  }

  /**
   * Detecta linguagem robótica
   */
  private _checkRobotic(
    response: string,
    phase: string
  ): { violations: string[]; warnings: string[] } {
    const violations: string[] = [];
    const warnings: string[] = [];
    const lower = response.toLowerCase();

    // Templates robóticos
    const roboticPatterns = [
      /um momento, vou/,
      /deixe-?me buscar/,
      /processando sua solicitação/,
      /acionando a ferramenta/,
      /chamando o agente/,
      /consultando o banco de dados/,
      /aguarde enquanto/,
      /como posso ajudá-?lo|como posso ajuda-lo/,
      /estou aqui para/
    ];

    roboticPatterns.forEach(pattern => {
      if (pattern.test(lower)) {
        violations.push(`Linguagem robótica detectada: "${response.substring(0, 50)}..."`);
      }
    });

    // Checklist de patterns que indicam robotismo
    const roboticSpeech = ["será feito", "processo", "solicitar", "requisição", "sistema"];
    const matches = roboticSpeech.filter(p => lower.includes(p)).length;
    if (matches >= 2) {
      warnings.push("Resposta parece muito técnica/formal para esta fase");
    }

    return { violations, warnings };
  }

  /**
   * Detecta emojis excessivos
   */
  private _checkEmojis(response: string, phase: string): { violation?: string; warning?: string } {
    const emojiRegex = /[\p{Emoji}]/gu;
    const emojiCount = (response.match(emojiRegex) || []).length;
    const lineCount = response.split("\n").length;

    // Máximo 2 emojis por mensagem
    if (emojiCount > 2) {
      return {
        violation: `Emojis excessivos (${emojiCount}, máximo 2)`
      };
    }

    // Em checkout, deve ter ✅
    if (phase === "CHECKOUT" && !response.includes("✅") && emojiCount === 0) {
      return {
        warning: "Checkout sem emoji de confirmação (recomendado ✅)"
      };
    }

    return {};
  }

  /**
   * Detecta vazamento de contexto interno
   */
  private _checkContextLeakage(response: string): string[] {
    const violations: string[] = [];
    const lower = response.toLowerCase();

    const internalPatterns = [
      /tool|mcp|agente-?catalogo|agente-?curation|openai/,
      /\[informação interna\]|\[internal\]/,
      /\[pensar\]|\[think\]/,
      /\{.*\}/, // JSON structures
      /json|api|endpoint/,
      /memory|context|token/
    ];

    internalPatterns.forEach(pattern => {
      if (pattern.test(lower)) {
        violations.push(`Contexto interno vaza: "${response.substring(0, 50)}..."`);
      }
    });

    return violations;
  }

  /**
   * Detecta erros de formatação WhatsApp
   */
  private _checkWhatsAppFormat(response: string): string[] {
    const violations: string[] = [];

    // Markdown de imagem proibido
    if (/!\[.*?\]\(.*?\)/.test(response)) {
      violations.push("Markdown de imagem proibido: ![alt](url). Use apenas URL pura.");
    }

    // Markdown de link proibido
    if (/\[https?:\/\/.*?\]\(.*?\)|\[.*?\]\(https?:.*?\)/.test(response)) {
      violations.push("Markdown de link proibido: [texto](url). Use apenas URL pura.");
    }

    // Headers markdown
    if (/^#+\s/m.test(response)) {
      violations.push("Headers markdown (#, ##, ###) proibidos no WhatsApp");
    }

    // Code blocks
    if (/```/.test(response)) {
      violations.push("Code blocks (```) proibidos. Use negrito (*) ou itálico (_)");
    }

    // Tabelas markdown
    if (/\|.*\|.*\|/m.test(response)) {
      violations.push("Tabelas markdown proibidas no WhatsApp");
    }

    return violations;
  }

  /**
   * Detecta pressão de venda inadequada
   */
  private _checkSalesPressure(response: string, phase: string): string | undefined {
    const lower = response.toLowerCase();

    const pressurePatterns = [
      /agora|apressar|pressa|rápido/,
      /última chance|sem tempo|expira/,
      /garantido|100% seguro/,
      /não perca/,
      /todos querem/
    ];

    // Em DISCOVERY, pressão é muito inadequada
    if (phase === "DISCOVERY") {
      if (pressurePatterns.some(p => p.test(lower))) {
        return "Pressão de venda inadequada para fase DISCOVERY (qualificação)";
      }
    }

    // Em geral, avisar se há linguagem agressiva
    if (pressurePatterns.filter(p => p.test(lower)).length >= 2) {
      return "Pressão de venda detectada. Use tom mais consultivo.";
    }

    return undefined;
  }

  /**
   * Valida comprimento da resposta
   */
  private _checkLength(response: string, phase: string): string | undefined {
    const lineCount = response.split("\n").length;
    const charCount = response.length;

    // Guidelines de comprimento por fase
    const guidelines: Record<string, { minLines: number; maxLines: number; minChars: number; maxChars: number }> = {
      DISCOVERY: { minLines: 1, maxLines: 3, minChars: 10, maxChars: 200 },
      CURATION: { minLines: 1, maxLines: 5, minChars: 20, maxChars: 400 },
      CUSTOMIZATION: { minLines: 1, maxLines: 4, minChars: 15, maxChars: 300 },
      CHECKOUT: { minLines: 1, maxLines: 3, minChars: 10, maxChars: 200 }
    };

    const guide = guidelines[phase] || guidelines.DISCOVERY;

    if (lineCount > guide.maxLines) {
      return `Resposta muito longa (${lineCount} linhas, máximo ${guide.maxLines})`;
    }

    if (charCount < guide.minChars) {
      return `Resposta muito curta (${charCount} chars, mínimo ${guide.minChars})`;
    }

    return undefined;
  }

  /**
   * Gera sugestões de melhoria
   */
  private _suggestImprovements(
    response: string,
    phase: string,
    violations: string[]
  ): string[] {
    const suggestions: string[] = [];

    if (violations.some(v => v.includes("robótica"))) {
      suggestions.push("Varíe linguagem: use conversação natural, não templates");
      suggestions.push("Adicione validação emocional ('Que legal!', 'Entendi!')");
    }

    if (violations.some(v => v.includes("emoji"))) {
      suggestions.push("Use 2 emojis máximo. Prefira de emoção (😊, 💕, 🥰)");
    }

    if (violations.some(v => v.includes("interno"))) {
      suggestions.push("Remova termos internos: tool, MCP, agente, memory, token");
      suggestions.push("Fale como cliente falaria: 'Deixa eu buscar', não 'Acionando tool'");
    }

    if (violations.some(v => v.includes("WhatsApp"))) {
      suggestions.push("Respeite limitações do WhatsApp: URL pura, negrito (*), itálico (_)");
    }

    if (phase === "DISCOVERY" && violations.some(v => v.includes("pressão"))) {
      suggestions.push("DISCOVERY é qualificação, não venda. Pergunte, não presse");
    }

    return suggestions;
  }

  /**
   * Detecta sentimento do cliente a partir da mensagem
   */
  detectSentiment(customerMessage: string): string {
    const lower = customerMessage.toLowerCase();

    if (
      /adorei|perfeito|legal|ótimo|incrível|demais|top|show/.test(lower) ||
      /😊|💕|🥰|😍|❤️|🎉/.test(customerMessage)
    ) {
      return "happy";
    }

    if (/não entendi|como funciona|explica|confuso|dúvida|qual diferença/.test(lower)) {
      return "confused";
    }

    if (/!{2,}|ainda não|demora|cadê|where|aonde|onde está|TEM\?/.test(lower)) {
      return "frustrated";
    }

    return "neutral";
  }
}

export default HumanizationGuardService.getInstance();
