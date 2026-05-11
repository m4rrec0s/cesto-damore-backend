/**
 * Curation Service - Estratégia de curadoria inteligente de produtos
 * 
 * Responsabilidades:
 * - Selecionar melhores produtos para apresentar baseado em:
 *   * Histórico do cliente
 *   * Fase de vendas
 *   * Contexto da conversa
 *   * Relevância semântica
 * - Justificar por que cada produto foi escolhido
 * - Sugerir alternativas
 */

import prisma from "../database/prisma";
import logger from "../utils/logger";
import toolRegistry from "./toolRegistryService";
import obsidianKnowledgeService from "./obsidianKnowledgeService";
import type { SalesPhase } from "./phaseGateService";
import type {
  ICurationStrategy,
  SearchContext,
} from "../types/tools";

export interface CurationResult {
  primaryProduct: {
    id: string;
    name: string;
    price: number;
    reasoning: string;
    bestForPhase: SalesPhase;
    expectedEngagement: number;
  };
  alternativeProducts: Array<{
    id: string;
    name: string;
    price: number;
    reason: string;
  }>;
  curationStrategy: string;
  confidenceScore: number;
  suggestedNextAction: string;
}

class CurationService {
  /**
   * Seleciona melhor produto para curadoria
   */
  async curateProduct(
    productIds: string[],
    context: SearchContext,
    customerPhone?: string
  ): Promise<CurationResult | null> {
    if (productIds.length === 0) {
      return null;
    }

    try {
      // 1. Fetch dados completos dos produtos
      const products = await Promise.all(
        productIds.map((id) =>
          prisma.product.findUnique({ where: { id } })
        )
      );
      const validProducts = products.filter(Boolean);

      if (validProducts.length === 0) {
        return null;
      }

      // 2. Score cada produto pela estratégia
      const scored = validProducts.map((product) => {
        const score = this._calculateCurationScore(
          product,
          context
        );
        return { product, score };
      });

      // 3. Seleciona principal (melhor score)
      scored.sort((a, b) => b.score.total - a.score.total);
      const primaryScore = scored[0];
      const alternativeScores = scored.slice(1, 4);

      // 4. Constrói resultado
      return {
        primaryProduct: {
          id: primaryScore.product.id,
          name: primaryScore.product.name,
          price: primaryScore.product.price,
          reasoning: this._buildReasoning(primaryScore.score),
          bestForPhase: this._determineBestPhase(primaryScore.product),
          expectedEngagement: this._estimateEngagement(primaryScore.score),
        },
        alternativeProducts: alternativeScores.map((alt) => ({
          id: alt.product.id,
          name: alt.product.name,
          price: alt.product.price,
          reason: `Alternativa relevante (score: ${alt.score.total.toFixed(2)})`,
        })),
        curationStrategy: this._determineCurationStrategy(primaryScore.score),
        confidenceScore: Math.min(primaryScore.score.total, 1.0),
        suggestedNextAction: this._suggestNextAction(
          primaryScore.score,
          context.currentPhase
        ),
      };
    } catch (error) {
      logger.error(`[CurationService] Error curatingProduct: ${error}`);
      return null;
    }
  }

  /**
   * Calcula score de curadoria baseado em múltiplos fatores
   */
  private _calculateCurationScore(
    product: any,
    context: SearchContext
  ): Record<string, number> {
    const name = (product.name || "").toLowerCase();
    const description = (product.description || "").toLowerCase();
    const combined = `${name} ${description}`;

    // Componentes do score
    const scores = {
      relevance: this._scoreRelevance(combined, context),
      phase_fit: this._scorePhase(product, context.currentPhase),
      engagement: this._scoreEngagement(product),
      availability: this._scoreAvailability(product),
      price_alignment: this._scorePriceAlignment(product, context),
      total: 0,
    };

    // Pesos por fase
    const phaseWeights = {
      DISCOVERY: { relevance: 0.4, phase_fit: 0.2, engagement: 0.2, availability: 0.1, price_alignment: 0.1 },
      CURATION: { relevance: 0.3, phase_fit: 0.3, engagement: 0.2, availability: 0.1, price_alignment: 0.1 },
      CUSTOMIZATION: { relevance: 0.2, phase_fit: 0.4, engagement: 0.2, availability: 0.1, price_alignment: 0.1 },
      CHECKOUT: { relevance: 0.1, phase_fit: 0.3, engagement: 0.3, availability: 0.2, price_alignment: 0.1 },
    };

    const weights = phaseWeights[context.currentPhase] || phaseWeights.DISCOVERY;

    scores.total =
      scores.relevance * weights.relevance +
      scores.phase_fit * weights.phase_fit +
      scores.engagement * weights.engagement +
      scores.availability * weights.availability +
      scores.price_alignment * weights.price_alignment;

    return scores;
  }

  private _scoreRelevance(combined: string, context: SearchContext): number {
    let score = 0;

    // Palavra-chave do query original
    if (context.conversationHistory.length > 0) {
      const lastUserMessage = context.conversationHistory
        .reverse()
        .find((m) => m.role === "user");
      if (lastUserMessage) {
        const words = lastUserMessage.content.toLowerCase().split(/\s+/);
        for (const word of words) {
          if (word.length > 3 && combined.includes(word)) {
            score += 0.15;
          }
        }
      }
    }

    // Preferências detectadas
    if (context.preferredProductTypes && context.preferredProductTypes.length > 0) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  private _scorePhase(product: any, phase: SalesPhase): number {
    const name = (product.name || "").toLowerCase();
    const description = (product.description || "").toLowerCase();
    const combined = `${name} ${description}`;

    switch (phase) {
      case "DISCOVERY":
        // Produtos populares, bem descritos
        return description.length > 150 ? 0.8 : 0.5;

      case "CURATION":
        // Produtos com imagem, preço adequado
        const hasImage = Boolean(product.image_url);
        const priceOk = product.price && product.price > 30 && product.price < 300;
        return (hasImage ? 0.5 : 0) + (priceOk ? 0.5 : 0);

      case "CUSTOMIZATION":
        // Produtos que permitem customização
        const canCustomize =
          combined.includes("personalizado") ||
          combined.includes("custom") ||
          combined.includes("gravado");
        return canCustomize ? 0.9 : 0.3;

      case "CHECKOUT":
        // Produtos em stock, disponíveis
        const inStock = product.stock > 0;
        return inStock ? 0.9 : 0.2;

      default:
        return 0.5;
    }
  }

  private _scoreEngagement(product: any): number {
    // Score baseado em características que geram engajamento
    const name = (product.name || "").toLowerCase();
    const hasEmoji = /[😀-🙏🌀-🗿🚀-🛿]/.test(product.name || "");
    const isPopular = name.includes("destaque") || name.includes("top");

    return (hasEmoji ? 0.3 : 0) + (isPopular ? 0.3 : 0) + 0.4;
  }

  private _scoreAvailability(product: any): number {
    const hasImage = Boolean(product.image_url);
    const hasDescription = Boolean(product.description && product.description.length > 50);
    const inStock = product.production_time && product.production_time <= 10;

    return (hasImage ? 0.3 : 0) + (hasDescription ? 0.3 : 0) + (inStock ? 0.4 : 0.1);
  }

  private _scorePriceAlignment(
    product: any,
    context: SearchContext
  ): number {
    if (!context.priceRange) {
      return 0.5; // Neutro
    }

    const price = product.price || 0;
    const { min, max } = context.priceRange;

    if (min && price < min) return 0.2;
    if (max && price > max) return 0.3;
    return 0.9; // Dentro da faixa
  }

  private _buildReasoning(scores: Record<string, number>): string {
    const reasons: string[] = [];

    if (scores.relevance > 0.7) reasons.push("Alta relevância com busca");
    if (scores.phase_fit > 0.7) reasons.push("Perfeito para esta fase");
    if (scores.engagement > 0.7) reasons.push("Produto muito atrativo");
    if (scores.availability > 0.7) reasons.push("Disponível e pronto");
    if (scores.price_alignment > 0.8) reasons.push("Preço dentro do orçamento");

    if (reasons.length === 0) {
      reasons.push("Melhor opção disponível");
    }

    return reasons.join(". ");
  }

  private _determineBestPhase(product: any): SalesPhase {
    const hasDetails = Boolean(product.description && product.description.length > 200);
    const hasImage = Boolean(product.image_url);
    const isCustomizable = (product.description || "").toLowerCase().includes("personalizado");

    if (isCustomizable) return "CUSTOMIZATION";
    if (hasDetails && hasImage) return "CURATION";
    return "DISCOVERY";
  }

  private _estimateEngagement(scores: Record<string, number>): number {
    const avg =
      (scores.relevance +
        scores.phase_fit +
        scores.engagement +
        scores.availability) /
      4;
    return Math.round(avg * 5); // 1-5 scale
  }

  private _determineCurationStrategy(scores: Record<string, number>): string {
    if (scores.relevance > 0.8) return "SEMANTIC_MATCH";
    if (scores.phase_fit > 0.8) return "PHASE_OPTIMIZED";
    if (scores.engagement > 0.8) return "ENGAGEMENT_FOCUSED";
    if (scores.availability > 0.8) return "AVAILABILITY_FIRST";
    return "BALANCED";
  }

  private _suggestNextAction(
    scores: Record<string, number>,
    phase: SalesPhase
  ): string {
    if (phase === "DISCOVERY") {
      return "Quer ver mais opções?";
    } else if (phase === "CURATION") {
      return "Gostou? Posso mostrar alternativas ou já quer customizar?";
    } else if (phase === "CUSTOMIZATION") {
      return "Como você gostaria de personalizar?";
    } else if (phase === "CHECKOUT") {
      return "Confirma o pedido?";
    }

    return "O que você acha?";
  }
}

export default new CurationService();
