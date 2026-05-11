/**
 * 🎯 PHASE 2: Curation Service
 * 
 * Seleciona produtos ideais através de scoring multi-fator:
 * - Relevância (similaridade com contexto)
 * - Phase fit (compatibilidade com fase de vendas)
 * - Engagement (nível de envolvimento esperado)
 * - Disponibilidade (preço, stock, produção)
 * - Alinhamento de preço
 */

export interface SearchContext {
  clientMessage: string;
  currentPhase: "DISCOVERY" | "CURATION" | "CUSTOMIZATION" | "CHECKOUT";
  clientHistory?: string;
}

export interface CurationResult {
  primaryProduct: {
    id: string;
    name: string;
    price: number;
    reasoning: string;
    bestForPhase: string;
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

const logger = {
  error: (msg: string) => console.error(msg),
  info: (msg: string) => console.info(msg)
};

export class CurationService {
  private static instance: CurationService;

  private constructor() {}

  static getInstance(): CurationService {
    if (!CurationService.instance) {
      CurationService.instance = new CurationService();
    }
    return CurationService.instance;
  }

  /**
   * Seleciona melhores produtos para curadoria
   */
  curateProducts(
    products: any[],
    context: SearchContext
  ): CurationResult | null {
    try {
      if (!products || products.length === 0) {
        return null;
      }

      // 1. Calcula score para cada produto
      const scored = products.map(product => ({
        product,
        score: this._calculateCurationScore(product, context)
      }));

      // 2. Ordena por score total (descendente)
      scored.sort((a, b) => b.score.total - a.score.total);

      // 3. Extrai primary e alternatives
      const primaryScore = scored[0];
      const alternativeScores = scored.slice(1, 4);

      if (!primaryScore?.product) {
        return null;
      }

      const primary = primaryScore.product;
      
      // 4. Constrói resultado
      return {
        primaryProduct: {
          id: primary.id || "",
          name: primary.name || "Produto",
          price: primary.price || 0,
          reasoning: this._buildReasoning(primaryScore.score),
          bestForPhase: this._determineBestPhase(primary),
          expectedEngagement: this._estimateEngagement(primaryScore.score),
        },
        alternativeProducts: alternativeScores
          .filter(alt => alt?.product)
          .map((alt) => ({
            id: alt.product.id || "",
            name: alt.product.name || "Produto",
            price: alt.product.price || 0,
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

    const scores = {
      relevance: this._scoreRelevance(combined, context),
      phase_fit: this._scorePhase(product, context.currentPhase),
      engagement: this._scoreEngagement(product),
      availability: this._scoreAvailability(product),
      price_alignment: this._scorePriceAlignment(product, context),
      total: 0,
    };

    const phaseWeights: Record<string, Record<string, number>> = {
      DISCOVERY: { relevance: 0.4, phase_fit: 0.2, engagement: 0.2, availability: 0.1, price_alignment: 0.1 },
      CURATION: { relevance: 0.3, phase_fit: 0.3, engagement: 0.2, availability: 0.1, price_alignment: 0.1 },
      CUSTOMIZATION: { relevance: 0.2, phase_fit: 0.4, engagement: 0.2, availability: 0.1, price_alignment: 0.1 },
      CHECKOUT: { relevance: 0.1, phase_fit: 0.3, engagement: 0.3, availability: 0.2, price_alignment: 0.1 },
    };

    const weights = phaseWeights[context.currentPhase] || phaseWeights.DISCOVERY;

    scores.total =
      (scores.relevance * weights.relevance) +
      (scores.phase_fit * weights.phase_fit) +
      (scores.engagement * weights.engagement) +
      (scores.availability * weights.availability) +
      (scores.price_alignment * weights.price_alignment);

    return scores;
  }

  private _scoreRelevance(combined: string, context: SearchContext): number {
    const msg = context.clientMessage.toLowerCase();
    const words = msg.split(/\s+/);
    const matches = words.filter(w => combined.includes(w)).length;
    return Math.min(matches / Math.max(words.length, 1), 1.0);
  }

  private _scorePhase(product: any, phase: string): number {
    if (phase === "CUSTOMIZATION") {
      const desc = (product.description || "").toLowerCase();
      if (desc.includes("personalizado") || desc.includes("custom")) return 1.0;
    }
    if (phase === "CHECKOUT") {
      if ((product.price || 0) <= 300) return 0.9;
    }
    return 0.6;
  }

  private _scoreEngagement(product: any): number {
    const hasImage = !!product.image_url;
    const hasDesc = (product.description || "").length > 100;
    return (hasImage ? 0.5 : 0) + (hasDesc ? 0.5 : 0);
  }

  private _scoreAvailability(product: any): number {
    const prodTime = product.production_time || 30;
    if (prodTime <= 7) return 1.0;
    if (prodTime <= 14) return 0.7;
    return 0.5;
  }

  private _scorePriceAlignment(product: any, _context: SearchContext): number {
    const price = product.price || 0;
    if (50 <= price && price <= 300) return 1.0;
    if (30 <= price || price <= 500) return 0.7;
    return 0.3;
  }

  private _buildReasoning(scores: Record<string, number>): string {
    const topFactor = Object.entries(scores)
      .filter(([k]) => k !== "total")
      .sort(([, a], [, b]) => b - a)[0];

    if (!topFactor) return "Produto recomendado";

    const factorNames: Record<string, string> = {
      relevance: "alta relevância",
      phase_fit: "adequado à fase",
      engagement: "muito atrativo",
      availability: "disponibilidade",
      price_alignment: "preço ideal"
    };

    return `Selecionado por ${factorNames[topFactor[0]] || "qualidade"}`;
  }

  private _determineBestPhase(product: any): string {
    if ((product.name || "").toLowerCase().includes("personalizado")) {
      return "CUSTOMIZATION";
    }
    return "CURATION";
  }

  private _estimateEngagement(scores: Record<string, number>): number {
    return Math.min(scores.total * 1.2, 1.0);
  }

  private _determineCurationStrategy(scores: Record<string, number>): string {
    if (scores.total > 0.8) return "STRONG_MATCH";
    if (scores.total > 0.6) return "GOOD_MATCH";
    return "ALTERNATIVE";
  }

  private _suggestNextAction(scores: Record<string, number>, phase: string): string {
    if (phase === "DISCOVERY") return "Quer ver mais opções?";
    if (phase === "CURATION") return "Gostou? Quer customizar?";
    if (phase === "CUSTOMIZATION") return "Como personalizar?";
    return "Confirma o pedido?";
  }
}

export default CurationService.getInstance();
