export type DiscoveryContext = {
  recipient?: string[];
  occasion?: string[];
  style?: string[];
  delivery?: "express";
  maxPrice?: number;
  terms?: string[];
};

type SearchProfile = {
  recipients?: string[];
  occasions?: string[];
  styles?: string[];
  deliveryModes?: string[];
  searchTerms?: string[];
};

type CuratableProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  production_time: number | null;
  search_profile: unknown;
  categories: { category: { name: string } }[];
  type: { name: string };
};

export type CuratedProduct<T extends CuratableProduct> = {
  product: T;
  score: number;
  reasons: string[];
};

const stopWords = new Set([
  "a", "o", "as", "os", "uma", "um", "para", "pra", "de", "do", "da", "dos", "das", "com", "por", "que", "meu", "minha", "seu", "sua", "quero", "preciso", "gostaria", "presente", "favor", "porfavor", "ser", "e", "em", "no", "na",
]);

const dictionary = {
  recipient: {
    mulher: ["mulher", "esposa", "namorada", "noiva", "ela"],
    homem: ["homem", "esposo", "namorado", "noivo", "ele"],
    mae: ["mae", "mamae", "mamãe"],
    pai: ["pai", "papai"],
    amigo: ["amigo", "amiga", "colega"],
    crianca: ["crianca", "criança", "bebe", "bebê", "filho", "filha"],
  },
  occasion: {
    aniversario: ["aniversario", "aniversário", "parabens", "parabéns"],
    romantico: ["romantico", "romântica", "romance", "namoro", "amor", "apaixonado"],
    dia_das_maes: ["dia das maes", "dia das mães"],
    agradecimento: ["agradecimento", "obrigado", "obrigada", "agradecer"],
    nascimento: ["nascimento", "cha de bebe", "chá de bebê", "maternidade"],
  },
  style: {
    romantico: ["romantico", "romântica", "amor", "fofo"],
    premium: ["premium", "luxo", "sofisticado", "especial"],
    divertido: ["divertido", "engracado", "engraçado", "criativo"],
    personalizado: ["personalizado", "foto", "nome", "mensagem"],
  },
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function containsAny(text: string, values: string[]) {
  return values.some((value) => text.includes(normalize(value)));
}

function canonical(value: string) {
  return normalize(value).replace(/[\s_-]+/g, "");
}

const aliasLabels = new Map<string, string>();
for (const entries of Object.values(dictionary) as Record<string, string[]>[]) {
  for (const [label, aliases] of Object.entries(entries)) {
    aliasLabels.set(canonical(label), label);
    for (const alias of aliases) aliasLabels.set(canonical(alias), label);
  }
}

function canonicalLabel(value: string) {
  const key = canonical(value);
  return aliasLabels.get(key) || key;
}

function matchesLabel(target: string, values: string[]) {
  const wanted = canonicalLabel(target);
  return values.some((value) => canonicalLabel(value) === wanted);
}

function profileOf(value: unknown): SearchProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profile = value as SearchProfile;
  return {
    recipients: Array.isArray(profile.recipients) ? profile.recipients.map(normalize) : [],
    occasions: Array.isArray(profile.occasions) ? profile.occasions.map(normalize) : [],
    styles: Array.isArray(profile.styles) ? profile.styles.map(normalize) : [],
    deliveryModes: Array.isArray(profile.deliveryModes) ? profile.deliveryModes.map(normalize) : [],
    searchTerms: Array.isArray(profile.searchTerms) ? profile.searchTerms.map(normalize) : [],
  };
}

function mergeValues(current: string[] | undefined, values: string[]) {
  return [...new Set([...(current || []), ...values])];
}

export function parseDiscoveryIntent(prompt: string, prior: DiscoveryContext = {}): DiscoveryContext {
  const text = normalize(prompt);
  const intent: DiscoveryContext = { ...prior };

  for (const [kind, entries] of Object.entries(dictionary)) {
    for (const [label, aliases] of Object.entries(entries)) {
      if (!containsAny(text, aliases)) continue;
      if (kind === "recipient") intent.recipient = mergeValues(intent.recipient, [label]);
      if (kind === "occasion") intent.occasion = mergeValues(intent.occasion, [label]);
      if (kind === "style") intent.style = mergeValues(intent.style, [label]);
    }
  }

  if (/(hoje|amanha|amanhã|urgente|rapido|rápido|express|pronta entrega)/.test(text)) intent.delivery = "express";
  const price = text.match(/(?:ate|até|no maximo|maximo|menos de)?\s*(?:r\$\s*)?(\d{2,4})(?:[,.]\d{2})?/);
  if (price && /(?:ate|até|maximo|maximo|menos|r\$)/.test(text)) intent.maxPrice = Number(price[1]);

  const terms = text.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 3 && !stopWords.has(term));
  intent.terms = mergeValues(intent.terms, terms).slice(-12);
  return intent;
}

export function curateDiscoveryProducts<T extends CuratableProduct>(products: T[], intent: DiscoveryContext): CuratedProduct<T>[] {
  return products
    .filter((product) => intent.maxPrice === undefined || product.price <= intent.maxPrice)
    .filter((product) => intent.delivery !== "express" || (product.production_time || 0) <= 1 || profileOf(product.search_profile).deliveryModes?.includes("express"))
    .map((product) => {
      const profile = profileOf(product.search_profile);
      const corpus = normalize([product.name, product.description || "", product.type.name, ...product.categories.map(({ category }) => category.name), ...(profile.searchTerms || [])].join(" "));
      let score = 0;
      const reasons: string[] = [];
      const profileValues = {
        recipient: profile.recipients || [], occasion: profile.occasions || [], style: profile.styles || [],
      };

      for (const [kind, weight] of [["recipient", 12], ["occasion", 10], ["style", 7]] as const) {
        for (const value of intent[kind] || []) {
          const matched = matchesLabel(value, profileValues[kind]) || corpus.includes(value);
          if (!matched) continue;
          score += weight;
          reasons.push(value);
        }
      }
      for (const term of intent.terms || []) {
        if (corpus.includes(term)) score += 4;
      }
      if (intent.delivery === "express") {
        score += 5;
        reasons.push("entrega rápida");
      }
      return { product, score, reasons };
    })
    .filter(({ score }) => score > 0 || !intent.terms?.length)
    .sort((a, b) => b.score - a.score || b.product.price - a.product.price);
}

export function describeDiscovery(intent: DiscoveryContext, count: number) {
  const parts = [
    intent.style?.includes("romantico") || intent.occasion?.includes("romantico") ? "opções românticas" : "opções",
    intent.recipient?.[0] ? `para ${intent.recipient[0]}` : "",
    intent.maxPrice ? `até R$ ${intent.maxPrice.toFixed(2).replace(".", ",")}` : "",
    intent.delivery === "express" ? "com entrega rápida" : "",
  ].filter(Boolean);
  return count ? `Separei ${parts.join(" ")} que combinam com o que você procura.` : "Ainda não encontrei uma combinação exata. Tente mudar a ocasião, pessoa ou faixa de preço.";
}
