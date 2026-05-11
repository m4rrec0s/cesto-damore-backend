/**
 * 📚 PHASE 4: Skills System Types & Manifest
 * 
 * Define estrutura de "skills" — conhecimento sob demanda.
 * Um skill é um tópico de conhecimento que LLM pode carregar quando precisa.
 * 
 * Exemplos:
 * - skill: "delivery_guide" (conhecimento sobre prazos/frete)
 * - skill: "customization_guide" (como funciona personalização)
 * - skill: "troubleshooting" (respostas para problemas comuns)
 */

export type SalesPhase = "DISCOVERY" | "CURATION" | "CUSTOMIZATION" | "CHECKOUT";

export interface ISkill {
  id: string;
  name: string;
  description: string;
  category: "reference" | "troubleshooting" | "process" | "product" | "policy";
  requiredInPhases: SalesPhase[];
  priority: number; // 1-10, onde 10 = deve-estar-sempre
  tokenEstimate: number; // Aproximado de tokens que consome
  cacheableTTL?: number; // Segundos. Se 0, não cachear
  keywords: string[]; // Termos que disparam este skill
  content?: string; // Conteúdo apenas se for reference pequena
  contentPath?: string; // Path no Obsidian/BD se for grande
}

export interface ISkillManifest {
  // Skill ID → quando carregar
  [skillId: string]: {
    intent: string; // Intent that triggers this skill
    skill: ISkill;
    alternateKeywords?: string[];
    conflictsWith?: string[]; // Skills que não podem estar juntas (espaço)
  };
}

export interface ISkillState {
  skillId: string;
  loadedAt: number; // timestamp
  usedInTurns: number;
  lastAccessedAt: number;
  priority: number;
}

// ========== PREDEFINED SKILLS MANIFEST ==========

export const SKILLS_MANIFEST: ISkillManifest = {
  delivery_guide: {
    intent: "delivery_check",
    skill: {
      id: "delivery_guide",
      name: "Guia de Entrega",
      description: "Informações sobre prazos, cobertura geográfica, horários comerciais",
      category: "reference",
      requiredInPhases: ["CURATION", "CUSTOMIZATION", "CHECKOUT"],
      priority: 8,
      tokenEstimate: 200,
      cacheableTTL: 3600, // 1 hora
      keywords: [
        "entrega", "quando", "prazo", "frete", "quanto custa",
        "horário", "amanhã", "hoje", "data", "horario"
      ],
      contentPath: "knowledge/delivery_guide.md"
    },
    alternateKeywords: ["shipping", "delivery_time", "production_time"]
  },

  customization_guide: {
    intent: "customization",
    skill: {
      id: "customization_guide",
      name: "Guia de Personalização",
      description: "Como funciona personalização de canecas, quadros, fotos, cartões",
      category: "process",
      requiredInPhases: ["CUSTOMIZATION", "CHECKOUT"],
      priority: 7,
      tokenEstimate: 250,
      cacheableTTL: 3600,
      keywords: [
        "personalizar", "foto", "frase", "nome", "texto",
        "customizar", "quadro", "caneca", "mudar", "trocar"
      ],
      contentPath: "knowledge/customization_guide.md"
    },
    alternateKeywords: ["personalization", "custom", "adicionar"]
  },

  product_catalogue: {
    intent: "product_search",
    skill: {
      id: "product_catalogue",
      name: "Catálogo de Produtos",
      description: "Tipos de produtos: flores, cestas, quadros, canecas, pelúcias, chocolates",
      category: "product",
      requiredInPhases: ["DISCOVERY", "CURATION"],
      priority: 9,
      tokenEstimate: 500,
      cacheableTTL: 86400, // 24 horas
      keywords: [
        "cesta", "buquê", "quadro", "caneca", "flor", "rosa",
        "chocolate", "pelucia", "tem", "qual", "mostre"
      ],
      contentPath: "knowledge/product_catalogue.md"
    }
  },

  payment_guide: {
    intent: "checkout",
    skill: {
      id: "payment_guide",
      name: "Guia de Pagamento",
      description: "Formas de pagamento: PIX, cartão, débito automático",
      category: "reference",
      requiredInPhases: ["CHECKOUT"],
      priority: 8,
      tokenEstimate: 150,
      cacheableTTL: 7200,
      keywords: [
        "como pago", "pagamento", "cartão", "pix", "boleto",
        "débito", "crédito", "parcelado"
      ],
      contentPath: "knowledge/payment_guide.md"
    }
  },

  troubleshooting: {
    intent: "problem_reported",
    skill: {
      id: "troubleshooting",
      name: "Troubleshooting Comum",
      description: "Respostas para problemas: 'onde tá meu pedido?', 'produto chegou quebrado'",
      category: "troubleshooting",
      requiredInPhases: ["CHECKOUT"],
      priority: 6,
      tokenEstimate: 300,
      cacheableTTL: 3600,
      keywords: [
        "problema", "erro", "quebrado", "não chegou", "atrasado",
        "onde está", "perdido", "não recebi", "defeito"
      ],
      contentPath: "knowledge/troubleshooting.md"
    },
    conflictsWith: ["product_catalogue"] // Não há produto, há problema
  },

  business_hours: {
    intent: "location_info",
    skill: {
      id: "business_hours",
      name: "Horários Comerciais",
      description: "Quando estamos abertos, feriados, períodos de férias",
      category: "reference",
      requiredInPhases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
      priority: 5,
      tokenEstimate: 80,
      cacheableTTL: 7200,
      keywords: [
        "horário", "quando abre", "domingo", "feriado",
        "está aberto", "funciona", "fechado", "férias"
      ],
      content: `
# Horários Comerciais - Cesto d'Amore

## Semana Regular:
- Seg-Sex: 08:30-12:00 | 14:00-17:00
- Sábado: 08:00-11:00
- Domingo: FECHADO

## Feriados Nacionais:
- Fechado (Natal, Ano Novo, Páscoa, etc)

## Períodos de Férias:
- Recesso: 20/12 a 01/01 (confira o ano vigente)
      `.trim()
    }
  },

  customer_retention: {
    intent: "repeat_customer",
    skill: {
      id: "customer_retention",
      name: "Retenção + Upsell",
      description: "Como oferecer adicionais, combos, promoções especiais",
      category: "process",
      requiredInPhases: ["CUSTOMIZATION", "CHECKOUT"],
      priority: 4,
      tokenEstimate: 200,
      cacheableTTL: 0, // Não cachear
      keywords: [
        "adicional", "combo", "promoção", "desconto",
        "quer mais", "adicione", "oferta"
      ],
      contentPath: "knowledge/customer_retention.md"
    }
  }
};

// ========== HELPER TYPES & FUNCTIONS ==========

export interface SkillLoadRequest {
  skillId: string;
  reason: string; // Ex: "client asked about delivery"
  phase: SalesPhase;
}

export interface SkillContext {
  activeSkills: ISkillState[];
  totalTokens: number;
  maxTokens: number;
  phase: SalesPhase;
}

export function getSkillsForPhase(phase: SalesPhase): ISkill[] {
  return Object.values(SKILLS_MANIFEST)
    .filter(m => m.skill.requiredInPhases.includes(phase))
    .map(m => m.skill)
    .sort((a, b) => b.priority - a.priority);
}

export function findSkillByKeyword(keyword: string): ISkill | undefined {
  const lower = keyword.toLowerCase();
  for (const manifest of Object.values(SKILLS_MANIFEST)) {
    const { skill, alternateKeywords } = manifest;
    const allKeywords = [...skill.keywords, ...(alternateKeywords || [])];
    if (allKeywords.some(k => lower.includes(k) || k.includes(lower))) {
      return skill;
    }
  }
  return undefined;
}

export function getConflictingSkills(skillId: string): string[] {
  const manifest = SKILLS_MANIFEST[skillId];
  return manifest?.conflictsWith || [];
}
