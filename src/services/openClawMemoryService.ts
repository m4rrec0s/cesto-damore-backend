import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import logger from "../utils/logger";

export interface SessionPresentedProduct {
  id: string;
  name: string;
  price: number | null;
  imageUrl: string | null;
}

export interface SessionMemoryState {
  client: {
    name: string | null;
    recipientName: string | null;
    city: string | null;
    occasion: string | null;
    budget: string | null;
    audience: string | null;
  };
  authenticatedUser: {
    isAuthenticated: boolean;
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  conversation: {
    salesPhase: "DISCOVERY" | "CURATION" | "CUSTOMIZATION" | "CHECKOUT";
    selectedProductConfirmed: boolean;
    selectedProductConfirmedAt: string | null;
    awaitingResponse: string | null;
    optionPresented: boolean;
    greetingDone: boolean;
    contextReiteratedCount: number;
    lastAssistantQuestion: string | null;
    lastUserIntent: string | null;
    urgency: "low" | "medium" | "high" | null;
    isFirstPurchase: boolean | null;
    notes: string[];
  };
  toolCache: {
    productDetailsByKey: Record<
      string,
      {
        productName: string;
        toolOutput: string;
        turn: number;
        updatedAt: string;
      }
    >;
  };
  presentedProducts: SessionPresentedProduct[];
  focusedProductId: string | null;
  flags: {
    attemptedPriceManipulation: boolean;
    transferredToHuman: boolean;
    freightCalculated: boolean;
  };
  updatedAt: string;
}

export interface CustomerMemoryState {
  purchaseHistory: string[];
  inferredPreferences: string[];
  notes: string[];
  lastUpdatedAt: string;
}

const DEFAULT_SESSION_MEMORY: SessionMemoryState = {
  client: {
    name: null,
    recipientName: null,
    city: null,
    occasion: null,
    budget: null,
    audience: null,
  },
  authenticatedUser: {
    isAuthenticated: false,
    name: null,
    phone: null,
    email: null,
  },
  conversation: {
    salesPhase: "DISCOVERY",
    selectedProductConfirmed: false,
    selectedProductConfirmedAt: null,
    awaitingResponse: null,
    optionPresented: false,
    greetingDone: false,
    contextReiteratedCount: 0,
    lastAssistantQuestion: null,
    lastUserIntent: null,
    urgency: null,
    isFirstPurchase: null,
    notes: [],
  },
  toolCache: {
    productDetailsByKey: {},
  },
  presentedProducts: [],
  focusedProductId: null,
  flags: {
    attemptedPriceManipulation: false,
    transferredToHuman: false,
    freightCalculated: false,
  },
  updatedAt: new Date(0).toISOString(),
};

const DEFAULT_CUSTOMER_MEMORY: CustomerMemoryState = {
  purchaseHistory: [],
  inferredPreferences: [],
  notes: [],
  lastUpdatedAt: new Date(0).toISOString(),
};

class OpenClawMemoryService {
  private readonly baseDir = path.resolve(
    process.cwd(),
    process.env.LLM_MEMORY_DIR || "storage/llm-memory",
  );
  private readonly sessionDir = path.join(this.baseDir, "sessions");
  private readonly customerDir = path.join(this.baseDir, "customers");

  private buildKeyHash(scope: "session" | "customer", raw: string) {
    return crypto
      .createHash("sha256")
      .update(`${scope}:${raw}`)
      .digest("hex")
      .slice(0, 24);
  }

  private async ensureDirs() {
    await fs.mkdir(this.sessionDir, { recursive: true });
    await fs.mkdir(this.customerDir, { recursive: true });
  }

  private async readFileSafe(filePath: string) {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeFileSafe(filePath: string, content: string) {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, filePath);
  }

  private extractJsonBlock<T>(markdown: string, fallback: T): T {
    const match = markdown.match(/```json-memory\s*([\s\S]*?)\s*```/i);
    if (!match?.[1]) return fallback;
    try {
      return JSON.parse(match[1]) as T;
    } catch {
      return fallback;
    }
  }

  private sanitizeSessionMemory(memory: SessionMemoryState): SessionMemoryState {
    const rawCache = memory?.toolCache?.productDetailsByKey || {};
    const normalizedCacheEntries = Object.entries(rawCache)
      .filter(([key, value]) => {
        if (!key || typeof key !== "string") return false;
        if (!value || typeof value !== "object") return false;
        if (typeof (value as any).toolOutput !== "string") return false;
        if (typeof (value as any).turn !== "number") return false;
        return true;
      })
      .slice(-50);

    const sanitized: SessionMemoryState = {
      ...DEFAULT_SESSION_MEMORY,
      ...memory,
      client: {
        ...DEFAULT_SESSION_MEMORY.client,
        ...(memory?.client || {}),
      },
      authenticatedUser: {
        ...DEFAULT_SESSION_MEMORY.authenticatedUser,
        ...(memory?.authenticatedUser || {}),
      },
      conversation: {
        ...DEFAULT_SESSION_MEMORY.conversation,
        ...(memory?.conversation || {}),
        notes: Array.isArray(memory?.conversation?.notes)
          ? memory.conversation.notes
              .filter((note) => typeof note === "string" && note.trim().length > 0)
              .slice(0, 20)
          : [],
      },
      toolCache: {
        productDetailsByKey: Object.fromEntries(normalizedCacheEntries),
      },
      flags: {
        ...DEFAULT_SESSION_MEMORY.flags,
        ...(memory?.flags || {}),
      },
      presentedProducts: Array.isArray(memory?.presentedProducts)
        ? memory.presentedProducts.slice(0, 20)
        : [],
    };

    if (sanitized.flags.freightCalculated && !sanitized.client.city) {
      sanitized.flags.freightCalculated = false;
    }

    return sanitized;
  }

  private normalizeText(value: string) {
    return (value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private sanitizeCityCandidate(candidate: string | null | undefined) {
    if (!candidate) return "";
    const cleaned = candidate
      .replace(/[^\p{L}\s'’-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "";
    const normalized = this.normalizeText(cleaned);
    const blocked = new Set([
      "informacoes",
      "informacao",
      "informação",
      "dados",
      "detalhes",
      "ajuda",
      "duvida",
      "duvida sobre",
      "entrega",
      "presente",
      "produto",
      "catalogo",
      "catálogo",
      "cidade",
      "bairro",
      "endereco",
      "endereço",
    ]);
    if (blocked.has(normalized)) return "";
    if (cleaned.length < 2 || cleaned.length > 40) return "";
    return cleaned;
  }

  private inferUserIntent(message: string) {
    const normalized = this.normalizeText(message);
    if (!normalized) return "empty";
    if (/\b(mais opcoes|mais opçoes|tem outras|outras opcoes|outro modelo)\b/.test(normalized)) {
      return "ask_more_options";
    }
    if (/\b(quero|vou levar|fechar pedido|finalizar|confirmo)\b/.test(normalized)) {
      return "confirm_purchase";
    }
    if (/\b(preco|valor|quanto)\b/.test(normalized)) {
      return "ask_price";
    }
    if (/\b(entrega|frete|cidade|bairro|endereco)\b/.test(normalized)) {
      return "ask_delivery";
    }
    if (/\?$/.test(message.trim()) || /\b(como|qual|quando|onde)\b/.test(normalized)) {
      return "question";
    }
    return "generic";
  }

  private formatBudgetValue(raw: string) {
    const cleaned = raw.replace(/[^\d.,]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.includes(",") ? cleaned : cleaned.replace(".", ",");
  }

  private renderSessionMarkdown(memory: SessionMemoryState) {
    const products = memory.presentedProducts
      .slice(0, 10)
      .map((product, index) => {
        const price =
          typeof product.price === "number"
            ? `R$ ${product.price.toFixed(2).replace(".", ",")}`
            : "n/a";
        return `- [P${index + 1}] id: ${product.id} | nome: ${product.name} | preco: ${price} | url_img: ${product.imageUrl || "n/a"}`;
      })
      .join("\n");

    return `# session_memory.md

## Cliente
- nome_inferido: ${memory.client.name || "null"}
- destinatario_nome: ${memory.client.recipientName || "null"}
- cidade: ${memory.client.city || "null"}
- ocasiao: ${memory.client.occasion || "null"}
- orcamento_estimado: ${memory.client.budget || "null"}
- publico_presente: ${memory.client.audience || "null"}

## Contexto Conversacional
- fase_venda: ${memory.conversation.salesPhase}
- produto_confirmado: ${memory.conversation.selectedProductConfirmed}
- produto_confirmado_em: ${memory.conversation.selectedProductConfirmedAt || "null"}
- aguardando_resposta: ${memory.conversation.awaitingResponse || "null"}
- opcao_apresentada: ${memory.conversation.optionPresented}
- saudacao_feita: ${memory.conversation.greetingDone}
- contexto_reiterado: ${memory.conversation.contextReiteratedCount}
- ultima_pergunta_assistente: ${memory.conversation.lastAssistantQuestion || "null"}
- ultima_intencao_cliente: ${memory.conversation.lastUserIntent || "null"}
- urgencia: ${memory.conversation.urgency || "null"}
- primeira_compra: ${String(memory.conversation.isFirstPurchase)}
- notas:
${memory.conversation.notes.map((note) => `  - ${note}`).join("\n") || "  - (nenhuma)"}

## Usuário Autenticado (Manager)
- autenticado: ${memory.authenticatedUser.isAuthenticated}
- nome: ${memory.authenticatedUser.name || "null"}
- telefone: ${memory.authenticatedUser.phone || "null"}
- email: ${memory.authenticatedUser.email || "null"}

## Produtos Apresentados
${products || "- (nenhum)"}

## Produto em Foco
- id: ${memory.focusedProductId || "null"}

## Flags de Sessão
- preco_manipulado_tentado: ${memory.flags.attemptedPriceManipulation}
- transferido_humano: ${memory.flags.transferredToHuman}
- frete_calculado: ${memory.flags.freightCalculated}
- updated_at: ${memory.updatedAt}

\`\`\`json-memory
${JSON.stringify(memory)}
\`\`\`
`;
  }

  private renderCustomerMarkdown(memory: CustomerMemoryState) {
    const history = memory.purchaseHistory
      .slice(0, 12)
      .map((line) => `- ${line}`)
      .join("\n");
    const preferences = memory.inferredPreferences
      .slice(0, 12)
      .map((line) => `- ${line}`)
      .join("\n");
    const notes = memory.notes
      .slice(0, 12)
      .map((line) => `- ${line}`)
      .join("\n");

    return `# customer_memory.md

## Histórico de Compras
${history || "- (vazio)"}

## Preferências Inferidas
${preferences || "- (vazio)"}

## Notas
${notes || "- (vazio)"}

## Metadata
- updated_at: ${memory.lastUpdatedAt}

\`\`\`json-memory
${JSON.stringify(memory)}
\`\`\`
`;
  }

  private sessionFilePath(sessionId: string) {
    const key = this.buildKeyHash("session", sessionId);
    return path.join(this.sessionDir, `${key}.md`);
  }

  private customerFilePath(customerPhone: string) {
    const key = this.buildKeyHash("customer", customerPhone);
    return path.join(this.customerDir, `${key}.md`);
  }

  async getSessionMemoryMarkdown(sessionId: string) {
    await this.ensureDirs();
    const content = await this.readFileSafe(this.sessionFilePath(sessionId));
    if (content) return content;
    return this.renderSessionMarkdown({ ...DEFAULT_SESSION_MEMORY });
  }

  async getSessionMemory(sessionId: string): Promise<SessionMemoryState> {
    try {
      await this.ensureDirs();
      const content = await this.readFileSafe(this.sessionFilePath(sessionId));
      if (!content) return { ...DEFAULT_SESSION_MEMORY };
      const parsed = this.extractJsonBlock<SessionMemoryState>(
        content,
        DEFAULT_SESSION_MEMORY,
      );
      return this.sanitizeSessionMemory(parsed);
    } catch (error) {
      logger.warn("⚠️ [Memory] Falha ao ler memória de sessão", error);
      return { ...DEFAULT_SESSION_MEMORY };
    }
  }

  async saveSessionMemory(sessionId: string, memory: SessionMemoryState) {
    try {
      await this.ensureDirs();
      const normalized = this.sanitizeSessionMemory(memory);
      await this.writeFileSafe(
        this.sessionFilePath(sessionId),
        this.renderSessionMarkdown(normalized),
      );
    } catch (error) {
      logger.warn("⚠️ [Memory] Falha ao salvar memória de sessão", error);
    }
  }

  async updateSessionFromUserMessage(sessionId: string, userMessage: string) {
    const memory = await this.getSessionMemory(sessionId);
    const lower = userMessage.toLowerCase();
    const trimmedMessage = userMessage.trim();

    const nameMatch = userMessage.match(
      /(?:meu nome é|meu nome e|me chamo|sou o|sou a)\s+([A-Za-zÀ-ú'’\-]{2,30})/i,
    );
    if (nameMatch?.[1]) {
      memory.client.name = nameMatch[1].trim();
    }
    const recipientMatch = userMessage.match(
      /(?:nome de quem vai receber|nome da (?:m[aã]e|namorada|esposa|pessoa)|destinat[aá]ri[oa]\s*(?:é|e)?|vai receber\s*(?:é|e)?)\s*[:\-]?\s*([A-Za-zÀ-ú'’\-\s]{2,40})/i,
    );
    if (recipientMatch?.[1]) {
      const recipient = recipientMatch[1].trim();
      if (recipient.length >= 2 && recipient.length <= 40) {
        memory.client.recipientName = recipient;
      }
    }

    const cityMatch = userMessage.match(
      /(?:sou de|moro em|entrega em|cidade\s*[:\-]?)\s*([A-Za-zÀ-ú'’\-\s]{2,40})/i,
    );
    if (cityMatch?.[1]) {
      const sanitizedCity = this.sanitizeCityCandidate(cityMatch[1]);
      if (sanitizedCity) memory.client.city = sanitizedCity;
    }
    const cityLooseMatch = userMessage.match(
      /(?:aqui em|em)\s+([A-Za-zÀ-ú'’\-\s]{2,40})/i,
    );
    if (!memory.client.city && cityLooseMatch?.[1]) {
      const sanitizedCity = this.sanitizeCityCandidate(cityLooseMatch[1]);
      if (sanitizedCity) memory.client.city = sanitizedCity;
    }

    const audiencePatterns: Array<[RegExp, string]> = [
      [/\b(namorada|namorado|esposa|esposo)\b/i, "romantico"],
      [/\b(m[ãa]e|pai|av[oó]|av[ôo])\b/i, "familia"],
      [/\b(crian[çc]a|filho|filha|beb[eê])\b/i, "infantil"],
      [/\b(amigo|amiga)\b/i, "amizade"],
    ];
    for (const [pattern, label] of audiencePatterns) {
      if (pattern.test(userMessage)) {
        memory.client.audience = label;
        break;
      }
    }

    const occasionPatterns: Array<[RegExp, string]> = [
      [/\b(anivers[aá]rio)\b/i, "aniversario"],
      [/\b(namorados|rom[aâ]ntic|romantic)\b/i, "romantico"],
      [/\b(m[ãa]es|dia das m[ãa]es)\b/i, "dia_das_maes"],
      [/\b(pais|dia dos pais)\b/i, "dia_dos_pais"],
      [/\b(casamento|noivado)\b/i, "casamento"],
    ];
    for (const [pattern, label] of occasionPatterns) {
      if (pattern.test(userMessage)) {
        memory.client.occasion = label;
        break;
      }
    }

    const budgetRangeMatch = userMessage.match(
      /(?:r\$\s*)?(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:-|a|até|ate)\s*(?:r\$\s*)?(\d{2,4}(?:[.,]\d{1,2})?)/i,
    );
    if (budgetRangeMatch?.[1] && budgetRangeMatch?.[2]) {
      memory.client.budget = `R$ ${this.formatBudgetValue(budgetRangeMatch[1])} - R$ ${this.formatBudgetValue(budgetRangeMatch[2])}`;
    } else {
      const budgetRangeNoCurrency = userMessage.match(
        /\b(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:-|a|até|ate)\s*(\d{2,4}(?:[.,]\d{1,2})?)\b/i,
      );
      if (budgetRangeNoCurrency?.[1] && budgetRangeNoCurrency?.[2]) {
        memory.client.budget = `R$ ${this.formatBudgetValue(budgetRangeNoCurrency[1])} - R$ ${this.formatBudgetValue(budgetRangeNoCurrency[2])}`;
      }
      const budgetMatch = userMessage.match(
        /(?:at[eé]\s*)?r\$\s*(\d{2,4}(?:[.,]\d{1,2})?)/i,
      );
      if (budgetMatch?.[1]) {
        memory.client.budget = `R$ ${this.formatBudgetValue(budgetMatch[1])}`;
      } else {
        const budgetMaxNoCurrency = userMessage.match(
          /(?:at[eé]|ate)\s*(\d{2,4}(?:[.,]\d{1,2})?)/i,
        );
        if (budgetMaxNoCurrency?.[1]) {
          memory.client.budget = `até R$ ${this.formatBudgetValue(budgetMaxNoCurrency[1])}`;
        }
      }
    }

    if (/mudar.*(pre[cç]o|valor)|por\s*r\$\s*\d+/i.test(lower)) {
      memory.flags.attemptedPriceManipulation = true;
    }

    const inferredIntent = this.inferUserIntent(userMessage);
    memory.conversation.lastUserIntent = inferredIntent;
    if (memory.conversation.awaitingResponse) {
      memory.conversation.awaitingResponse = null;
    }
    const confirmsProduct =
      /\b(vou levar|vou querer|quero essa|quero esse|fechar pedido|pode finalizar|pode fechar|confirmo)\b/i.test(
        trimmedMessage,
      );
    const asksMoreOptions =
      /\b(tem outras|mais op[cç][oõ]es|me mostra mais|outra op[cç][aã]o)\b/i.test(
        trimmedMessage,
      );
    if (confirmsProduct && memory.focusedProductId) {
      memory.conversation.selectedProductConfirmed = true;
      memory.conversation.selectedProductConfirmedAt = new Date().toISOString();
      memory.conversation.salesPhase = "CUSTOMIZATION";
    } else if (asksMoreOptions) {
      memory.conversation.selectedProductConfirmed = false;
      memory.conversation.selectedProductConfirmedAt = null;
      memory.conversation.salesPhase = "CURATION";
    }
    if (inferredIntent === "ask_more_options") {
      memory.conversation.optionPresented = false;
    }
    if (
      /\b(rua|avenida|bairro|cidade|cep|pix|cart[aã]o|cartao|pagamento|entrega)\b/i.test(
        trimmedMessage,
      )
    ) {
      memory.conversation.salesPhase = "CHECKOUT";
    } else if (
      memory.presentedProducts.length > 0 &&
      memory.conversation.salesPhase === "DISCOVERY"
    ) {
      memory.conversation.salesPhase = "CURATION";
    }
    if (/\b(urgente|urgencia|urgência|hoje|agora|pra ja|pra já|quanto antes)\b/i.test(trimmedMessage)) {
      memory.conversation.urgency = "high";
    } else if (
      /\b(amanh[aã]|esta semana|essa semana|logo)\b/i.test(trimmedMessage) &&
      memory.conversation.urgency !== "high"
    ) {
      memory.conversation.urgency = "medium";
    } else if (!memory.conversation.urgency) {
      memory.conversation.urgency = "low";
    }
    if (/\b(primeira vez|nunca comprei|primeiro pedido)\b/i.test(trimmedMessage)) {
      memory.conversation.isFirstPurchase = true;
    }
    if (/\b(j[aá] comprei|pedido anterior|de novo|novamente)\b/i.test(trimmedMessage)) {
      memory.conversation.isFirstPurchase = false;
    }

    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async patchSessionClientData(
    sessionId: string,
    patch: Partial<SessionMemoryState["client"]>,
  ) {
    const memory = await this.getSessionMemory(sessionId);
    const sanitizedPatch = { ...patch };
    if (typeof sanitizedPatch.city === "string") {
      sanitizedPatch.city = this.sanitizeCityCandidate(sanitizedPatch.city) || null;
    }
    memory.client = {
      ...memory.client,
      ...Object.fromEntries(
        Object.entries(sanitizedPatch).filter(([, value]) => {
          if (typeof value === "string") return value.trim().length > 0;
          return value !== null && value !== undefined;
        }),
      ),
    };
    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async updateSessionProducts(
    sessionId: string,
    products: SessionPresentedProduct[],
    focusedProductId?: string | null,
  ) {
    if (!products.length && !focusedProductId) return;
    const memory = await this.getSessionMemory(sessionId);
    const merged = new Map<string, SessionPresentedProduct>();
    for (const product of memory.presentedProducts) merged.set(product.id, product);
    for (const product of products) merged.set(product.id, product);

    memory.presentedProducts = Array.from(merged.values()).slice(0, 20);
    if (focusedProductId) {
      memory.focusedProductId = focusedProductId;
    } else if (!memory.focusedProductId && memory.presentedProducts[0]) {
      memory.focusedProductId = memory.presentedProducts[0].id;
    }
    if (memory.presentedProducts.length > 0 && memory.conversation.salesPhase === "DISCOVERY") {
      memory.conversation.salesPhase = "CURATION";
    }
    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async markFlag(
    sessionId: string,
    flag: keyof SessionMemoryState["flags"],
    value: boolean,
  ) {
    const memory = await this.getSessionMemory(sessionId);
    if (flag === "freightCalculated" && value && !memory.client.city) {
      memory.flags[flag] = false;
    } else {
      memory.flags[flag] = value;
    }
    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async setFocusedProduct(sessionId: string, productId: string) {
    const memory = await this.getSessionMemory(sessionId);
    memory.focusedProductId = productId;
    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async setAuthenticatedUserContext(
    sessionId: string,
    user: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
    },
  ) {
    const memory = await this.getSessionMemory(sessionId);
    memory.authenticatedUser = {
      isAuthenticated: true,
      name: user.name?.trim() || memory.authenticatedUser.name || null,
      phone: user.phone?.trim() || memory.authenticatedUser.phone || null,
      email: user.email?.trim() || memory.authenticatedUser.email || null,
    };
    if (!memory.client.name && memory.authenticatedUser.name) {
      memory.client.name = memory.authenticatedUser.name;
    }
    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async registerAssistantResponse(
    sessionId: string,
    assistantMessage: string,
    userMessage: string,
  ) {
    const memory = await this.getSessionMemory(sessionId);
    const normalizedAssistant = this.normalizeText(assistantMessage);
    const normalizedUser = this.normalizeText(userMessage);

    if (/^(oi|ol[áa]|bom dia|boa tarde|boa noite)\b/i.test(assistantMessage.trim())) {
      memory.conversation.greetingDone = true;
    }
    if (/\?/.test(assistantMessage)) {
      memory.conversation.lastAssistantQuestion = assistantMessage
        .split("\n")
        .find((line) => line.includes("?"))
        ?.trim()
        .slice(0, 180) || assistantMessage.slice(0, 180);
      memory.conversation.awaitingResponse = "question";
    } else {
      memory.conversation.awaitingResponse = null;
    }
    if (normalizedAssistant.includes("pra sua mae") || normalizedAssistant.includes("para sua mae")) {
      memory.conversation.contextReiteratedCount += 1;
    }
    if (
      /vai querer|quer levar|gostou dessa|fechamos essa/i.test(assistantMessage) &&
      /\b(tem outras|outra opcao|mais opcoes)\b/i.test(normalizedUser)
    ) {
      memory.conversation.optionPresented = false;
      if (!memory.conversation.notes.includes("cliente pediu mais opções após confirmação")) {
        memory.conversation.notes.unshift("cliente pediu mais opções após confirmação");
      }
    }
    if (/opção|opcao|cesta|produto/i.test(assistantMessage)) {
      memory.conversation.optionPresented = true;
    }
    if (/(adicional|caneca personalizada|polaroid|fotos? polaroid)/i.test(assistantMessage)) {
      memory.conversation.salesPhase = "CUSTOMIZATION";
    }
    if (
      /(?:me passa|me informe|me diz).*(nome.*recebe|bairro|cidade|endere[cç]o|pagamento|pix|cart[aã]o)/i.test(
        assistantMessage,
      )
    ) {
      memory.conversation.salesPhase = "CHECKOUT";
    }
    if (
      /(pode continuar|quer que eu siga|quer que eu continue)\??/i.test(
        normalizedAssistant,
      )
    ) {
      if (
        !memory.conversation.notes.includes(
          "assistente usou pergunta de continuidade desnecessária",
        )
      ) {
        memory.conversation.notes.unshift(
          "assistente usou pergunta de continuidade desnecessária",
        );
      }
    }
    if (
      memory.client.occasion === "dia_das_maes" &&
      memory.client.recipientName &&
      memory.client.name &&
      this.normalizeText(memory.client.recipientName) === this.normalizeText(memory.client.name)
    ) {
      if (!memory.conversation.notes.includes("possível conflito: nome do cliente igual ao destinatário")) {
        memory.conversation.notes.unshift("possível conflito: nome do cliente igual ao destinatário");
      }
    }

    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async cacheProductDetails(
    sessionId: string,
    key: string,
    productName: string,
    toolOutput: string,
    turn: number,
  ) {
    const normalizedKey = this.normalizeText(key);
    if (!normalizedKey || !toolOutput?.trim()) return;
    const memory = await this.getSessionMemory(sessionId);
    memory.toolCache.productDetailsByKey[normalizedKey] = {
      productName: productName?.trim() || key,
      toolOutput: toolOutput.slice(0, 9000),
      turn,
      updatedAt: new Date().toISOString(),
    };
    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async getCachedProductDetails(
    sessionId: string,
    key: string,
    currentTurn: number,
    maxAgeTurns: number = 10,
  ) {
    const normalizedKey = this.normalizeText(key);
    if (!normalizedKey) return null;
    const memory = await this.getSessionMemory(sessionId);
    const cached = memory.toolCache.productDetailsByKey[normalizedKey];
    if (!cached) return null;
    if (currentTurn - cached.turn > maxAgeTurns) return null;
    return cached.toolOutput;
  }

  buildSessionPrompt(memory: SessionMemoryState) {
    const productLines = memory.presentedProducts
      .slice(0, 6)
      .map((product, index) => {
        const price =
          typeof product.price === "number"
            ? `R$ ${product.price.toFixed(2).replace(".", ",")}`
            : "n/a";
        return `- Opção ${index + 1}: id=${product.id}; nome=${product.name}; preço=${price}; img=${product.imageUrl || "n/a"}`;
      })
      .join("\n");

    const detailsCacheKeys = Object.keys(memory.toolCache.productDetailsByKey || {});
    return `### SESSION_MEMORY_COMPACT
cliente: nome=${memory.client.name || "null"}; destinatario=${memory.client.recipientName || "null"}; cidade=${memory.client.city || "null"}; ocasiao=${memory.client.occasion || "null"}; orcamento=${memory.client.budget || "null"}; publico=${memory.client.audience || "null"}
auth_manager: autenticado=${memory.authenticatedUser.isAuthenticated}; nome=${memory.authenticatedUser.name || "null"}; telefone=${memory.authenticatedUser.phone || "null"}
produto_em_foco: ${memory.focusedProductId || "null"}
flags: preco_manipulado=${memory.flags.attemptedPriceManipulation}; transferido=${memory.flags.transferredToHuman}; frete_calculado=${memory.flags.freightCalculated}
contexto_conversa: fase=${memory.conversation.salesPhase}; produto_confirmado=${memory.conversation.selectedProductConfirmed}; aguardando=${memory.conversation.awaitingResponse || "null"}; opcao_apresentada=${memory.conversation.optionPresented}; saudacao_feita=${memory.conversation.greetingDone}; contexto_reiterado=${memory.conversation.contextReiteratedCount}; ultima_intencao=${memory.conversation.lastUserIntent || "null"}
cache_tool_get_product_details_keys: ${detailsCacheKeys.slice(0, 8).join(", ") || "nenhum"}
produtos_apresentados:
${productLines || "- nenhum"}
regras:
1) "opção N" deve mapear para a mesma opção da memória.
2) Não trocar nome/preço entre turnos.
3) Se listar produto, incluir URL da imagem na primeira menção.
4) Evite loop de confirmação: se cliente já respondeu ou pediu mais opções, avance.
5) Antes de chamar get_product_details, use cache desta memória quando o produto for o mesmo (últimos 10 turnos).
6) Não repetir saudação/contexto em toda resposta; contextualize só quando necessário.
7) Se produto_confirmado=true, NÃO refaça busca de catálogo para o mesmo contexto; avance para customização e checkout.
8) Após confirmação, evite repetir link/imagem/preço técnico do item; conduza para fechamento.`;
  }

  async getCustomerMemory(customerPhone: string): Promise<CustomerMemoryState> {
    try {
      await this.ensureDirs();
      const content = await this.readFileSafe(this.customerFilePath(customerPhone));
      if (!content) return { ...DEFAULT_CUSTOMER_MEMORY };
      const parsed = this.extractJsonBlock<CustomerMemoryState>(
        content,
        DEFAULT_CUSTOMER_MEMORY,
      );
      return {
        ...DEFAULT_CUSTOMER_MEMORY,
        ...parsed,
        purchaseHistory: Array.isArray(parsed.purchaseHistory)
          ? parsed.purchaseHistory.slice(0, 30)
          : [],
        inferredPreferences: Array.isArray(parsed.inferredPreferences)
          ? parsed.inferredPreferences.slice(0, 30)
          : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 30) : [],
      };
    } catch (error) {
      logger.warn("⚠️ [Memory] Falha ao ler memória de cliente", error);
      return { ...DEFAULT_CUSTOMER_MEMORY };
    }
  }

  async getCustomerMemoryMarkdown(customerPhone: string) {
    await this.ensureDirs();
    const content = await this.readFileSafe(this.customerFilePath(customerPhone));
    if (content) return content;
    return this.renderCustomerMarkdown({ ...DEFAULT_CUSTOMER_MEMORY });
  }

  async saveCustomerMemory(customerPhone: string, memory: CustomerMemoryState) {
    try {
      await this.ensureDirs();
      await this.writeFileSafe(
        this.customerFilePath(customerPhone),
        this.renderCustomerMarkdown(memory),
      );
    } catch (error) {
      logger.warn("⚠️ [Memory] Falha ao salvar memória de cliente", error);
    }
  }

  async flushSessionToCustomer(
    sessionId: string,
    customerPhone: string,
    assistantMessage: string,
  ) {
    const sessionMemory = await this.getSessionMemory(sessionId);
    const customerMemory = await this.getCustomerMemory(customerPhone);

    const focused = sessionMemory.presentedProducts.find(
      (product) => product.id === sessionMemory.focusedProductId,
    );
    if (focused && focused.price !== null) {
      const line = `${new Date().toISOString().slice(0, 10)}: ${focused.name} R$ ${focused.price.toFixed(2).replace(".", ",")}`;
      if (!customerMemory.purchaseHistory.includes(line)) {
        customerMemory.purchaseHistory.unshift(line);
      }
    }

    if (sessionMemory.client.city) {
      const pref = `cidade: ${sessionMemory.client.city}`;
      if (!customerMemory.inferredPreferences.includes(pref)) {
        customerMemory.inferredPreferences.unshift(pref);
      }
    }
    if (sessionMemory.client.audience) {
      const pref = `publico: ${sessionMemory.client.audience}`;
      if (!customerMemory.inferredPreferences.includes(pref)) {
        customerMemory.inferredPreferences.unshift(pref);
      }
    }
    if (sessionMemory.client.budget) {
      const pref = `orcamento: ${sessionMemory.client.budget}`;
      if (!customerMemory.inferredPreferences.includes(pref)) {
        customerMemory.inferredPreferences.unshift(pref);
      }
    }

    if (/mudar.*(pre[cç]o|valor)|por\s*r\$\s*\d+/i.test(assistantMessage)) {
      if (!customerMemory.notes.includes("sinal de negociação de preço")) {
        customerMemory.notes.unshift("sinal de negociação de preço");
      }
    }

    customerMemory.lastUpdatedAt = new Date().toISOString();
    await this.saveCustomerMemory(customerPhone, customerMemory);
    return customerMemory;
  }

  buildCustomerPrompt(memory: CustomerMemoryState) {
    const history = memory.purchaseHistory.slice(0, 4).join(" | ") || "nenhum";
    const prefs =
      memory.inferredPreferences.slice(0, 5).join(" | ") || "nenhuma";
    const notes = memory.notes.slice(0, 4).join(" | ") || "nenhuma";
    return `### CUSTOMER_MEMORY_COMPACT
historico: ${history}
preferencias: ${prefs}
notas: ${notes}`;
  }

  buildCustomerSummaryForDb(memory: CustomerMemoryState) {
    const history = memory.purchaseHistory.slice(0, 2).join(" | ");
    const prefs = memory.inferredPreferences.slice(0, 3).join(" | ");
    const notes = memory.notes.slice(0, 2).join(" | ");
    return [`Histórico: ${history || "n/a"}`, `Preferências: ${prefs || "n/a"}`, `Notas: ${notes || "n/a"}`]
      .join("\n")
      .slice(0, 1400);
  }
}

export default new OpenClawMemoryService();
