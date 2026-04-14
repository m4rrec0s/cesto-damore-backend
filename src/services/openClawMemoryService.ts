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
    city: string | null;
    occasion: string | null;
    budget: string | null;
    audience: string | null;
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
    city: null,
    occasion: null,
    budget: null,
    audience: null,
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
    const sanitized: SessionMemoryState = {
      ...DEFAULT_SESSION_MEMORY,
      ...memory,
      client: {
        ...DEFAULT_SESSION_MEMORY.client,
        ...(memory?.client || {}),
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
- cidade: ${memory.client.city || "null"}
- ocasiao: ${memory.client.occasion || "null"}
- orcamento_estimado: ${memory.client.budget || "null"}
- publico_presente: ${memory.client.audience || "null"}

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

    const nameMatch = userMessage.match(
      /(?:meu nome é|meu nome e|me chamo|sou o|sou a)\s+([A-Za-zÀ-ú'’\-]{2,30})/i,
    );
    if (nameMatch?.[1]) {
      memory.client.name = nameMatch[1].trim();
    }

    const cityMatch = userMessage.match(
      /(?:sou de|moro em|entrega em|cidade\s*[:\-]?)\s*([A-Za-zÀ-ú'’\-\s]{2,40})/i,
    );
    if (cityMatch?.[1]) {
      memory.client.city = cityMatch[1].trim();
    }
    const cityLooseMatch = userMessage.match(
      /(?:aqui em|em)\s+([A-Za-zÀ-ú'’\-\s]{2,40})/i,
    );
    if (!memory.client.city && cityLooseMatch?.[1]) {
      memory.client.city = cityLooseMatch[1].trim();
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

    memory.updatedAt = new Date().toISOString();
    await this.saveSessionMemory(sessionId, memory);
  }

  async patchSessionClientData(
    sessionId: string,
    patch: Partial<SessionMemoryState["client"]>,
  ) {
    const memory = await this.getSessionMemory(sessionId);
    memory.client = {
      ...memory.client,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => {
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

    return `### SESSION_MEMORY_COMPACT
cliente: cidade=${memory.client.city || "null"}; ocasiao=${memory.client.occasion || "null"}; orcamento=${memory.client.budget || "null"}; publico=${memory.client.audience || "null"}
produto_em_foco: ${memory.focusedProductId || "null"}
flags: preco_manipulado=${memory.flags.attemptedPriceManipulation}; transferido=${memory.flags.transferredToHuman}; frete_calculado=${memory.flags.freightCalculated}
produtos_apresentados:
${productLines || "- nenhum"}
regras:
1) "opção N" deve mapear para a mesma opção da memória.
2) Não trocar nome/preço entre turnos.
3) Se listar produto, incluir URL da imagem na primeira menção.`;
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
