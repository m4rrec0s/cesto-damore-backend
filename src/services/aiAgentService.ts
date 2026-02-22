import OpenAI from "openai";
import prisma from "../database/prisma";
import mcpClientService from "./mcpClientService";
import logger from "../utils/logger";
import { addDays, isPast, format } from "date-fns";

enum ProcessingState {
  ANALYZING = "ANALYZING",
  GATHERING_DATA = "GATHERING_DATA",
  SYNTHESIZING = "SYNTHESIZING",
  READY_TO_RESPOND = "READY_TO_RESPOND",
}

enum CheckoutState {
  PRODUCT_SELECTED = "PRODUCT_SELECTED",
  WAITING_DATE = "WAITING_DATE",
  WAITING_ADDRESS = "WAITING_ADDRESS",
  WAITING_PAYMENT = "WAITING_PAYMENT",
  READY_TO_FINALIZE = "READY_TO_FINALIZE",
}

interface CheckoutData {
  productName: string;
  productPrice: number;
  deliveryDate: string;
  deliveryTime: string;
  deliveryType: "delivery" | "retirada";
  address: string;
  paymentMethod: "PIX" | "CARTAO";
  freight: number | null;
  totalValue: number;
}

interface ToolExecutionResult {
  toolName: string;
  input: any;
  output: string;
  success: boolean;
}

class AIAgentService {
  private openai: OpenAI;
  private model: string = "gpt-4o-mini";
  private advancedModel: string = "gpt-4-turbo";

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  

  private determineToolStrategy(
    userMessage: string,
    wasExplicitMatch: boolean,
    relevantPrompts: string[],
  ): {
    requiresToolCall: boolean;
    shouldOptimizeModel: boolean;
    model: string;
  } {
    const messageLower = userMessage.toLowerCase();
    const messageLength = userMessage.trim().length;

    const hardRequirements = {
      cartEvent: /\[interno\].*carrinho|evento\s*=\s*cart_added|cart_added|adicionou.*carrinho/i.test(
        userMessage,
      ),
      finalCheckout: /finaliza|confirma|fecha pedido|vou levar|como compro|como pago/i.test(
        messageLower,
      ),
    };

    if (hardRequirements.cartEvent || hardRequirements.finalCheckout) {
      return {
        requiresToolCall: true,
        shouldOptimizeModel: false,
        model: this.model,
      };
    }

    if (messageLength <= 30 && !wasExplicitMatch) {
      return {
        requiresToolCall: false,
        shouldOptimizeModel: false,
        model: this.model,
      };
    }

    if (!wasExplicitMatch) {
      return {
        requiresToolCall: false,
        shouldOptimizeModel: false,
        model: this.model,
      };
    }

    let toolNecessityScore = 0;

    const criticalPrompts = [
      "product_selection_guideline",
      "faq_production_guideline",
    ];

    const optionalPrompts = [
      "indecision_guideline",
      "delivery_rules_guideline",
      "location_guideline",
    ];

    const hasCriticalPrompt = relevantPrompts.some((p) =>
      criticalPrompts.includes(p),
    );
    const hasOptionalPrompt = relevantPrompts.some((p) =>
      optionalPrompts.includes(p),
    );

    if (hasCriticalPrompt) {
      toolNecessityScore += 100;
    }
    if (hasOptionalPrompt) {
      toolNecessityScore += 30;
    }

    const specificProductPatterns = [
      /cesta|cesto|buqu|caneca|flor|rosa|presente/i,
      /quanto cust|qual.*preço|valor/i,
      /tem de.*\$/i,
    ];

    const hasSpecificSearch = specificProductPatterns.some((p) =>
      p.test(messageLower),
    );
    if (hasSpecificSearch) {
      toolNecessityScore += 50;
    }

    const genericPatterns = [
      /mais opçõ|outro|diferente|parecido|similar/i,
      /como é|me explica|qual é|o que é/i,
    ];

    const isGenericQuestion = genericPatterns.some((p) =>
      p.test(messageLower),
    );
    if (isGenericQuestion) {
      toolNecessityScore -= 20;
    }

    const requiresToolCall = toolNecessityScore > 60;

    const complexityIndicators = [
      {
        pattern: /se.*então|mas|porém|however|comparar|differença|melhor|pior/i,
        weight: 40,
      },
      {
        pattern: /dois|três|vários|múltiplo|mais de|menos de/i,
        weight: 30,
      },
      { pattern: messageLength > 200, weight: 20 },
      { pattern: /\?.*\?.*\?/i, weight: 25 },
    ];

    let complexityScore = 0;
    for (const indicator of complexityIndicators) {
      if (typeof indicator.pattern === "object") {
        if (indicator.pattern.test(messageLower)) {
          complexityScore += indicator.weight;
        }
      } else {
        if (indicator.pattern) {
          complexityScore += indicator.weight;
        }
      }
    }

    const shouldOptimizeModel =
      complexityScore > 40 && relevantPrompts.length > 1;

    return {
      requiresToolCall,
      shouldOptimizeModel,
      model: shouldOptimizeModel ? this.advancedModel : this.model,
    };
  }

  

  private detectContextualPrompts(userMessage: string): { prompts: string[]; wasExplicitMatch: boolean } {
    const messageLower = userMessage.toLowerCase();

    const isGreetingOnly = (() => {
      const cleaned = messageLower
        .replace(/[^a-z\sáàâãéèêíìîóòôõúùûç]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return false;
      const greetings = [
        "oi",
        "ola",
        "olá",
        "bom dia",
        "boa tarde",
        "boa noite",
        "eai",
        "e aí",
      ];
      if (greetings.some((g) => cleaned === g)) return true;
      if (cleaned.length <= 12 && greetings.some((g) => cleaned.startsWith(g))) {
        return true;
      }
      return false;
    })();

    const contextMap = [
      {
        patterns: [
          /\[interno\].*carrinho/i,
          /evento\s*=\s*cart_added/i,
          /cart_added/i,
          /adicionou.*carrinho/i,
        ],
        prompt: "cart_protocol_guideline",
        priority: 0,
      },
      {
        patterns: [
          /catálogo|catalogo|cardápio|cardapio|menu|opções e valores|opcoes e valores|lista de preços|lista de precos|quais produtos|o que vocês têm|o que voces tem|todos os produtos|tudo que tem/i,
        ],
        prompt: "indecision_guideline",
        priority: 1,
      },
      {
        patterns: [
          /entrega|João pessoa|Queimadas|Galante|Puxinanã|São José|cobertura|cidad|faz entrega|onde fica|localiza/i,
        ],
        prompt: "delivery_rules_guideline",
        priority: 1,
      },
      {
        patterns: [/horário|que horas|quando|amanhã|hoje|noite|tarde|manhã|prazo|demora|tempo de produção/i],
        prompt: "delivery_rules_guideline",
        priority: 1,
      },
      {
        patterns: [
          /finaliza|confirma|fecha|pedido|compro|quer esse|quero essa|vou levar|como compro|como pago/i,
        ],
        prompt: "closing_protocol_guideline",
        priority: 1,
      },
      {
        patterns: [
          /quanto cust|qual o preço|preço mínimo|preço minimo|valor mínimo|valor minimo|preço|valor|barato|caro|mais em conta|a partir de quanto|tem de quanto|custa quanto|valores|preços|quanto é|quanto fica/i,
        ],
        prompt: "product_selection_guideline",
        priority: 1,
      },
      {
        patterns: [/produto|cesta|flor|caneca|chocolate|presente|buquê|rosa|cone|quadro|quebra|pelúcia|urso/i],
        prompt: "product_selection_guideline",
        priority: 2,
      },
      {
        patterns: [/personaliza|foto|nome|customiza|adesivo|bilhete|frase/i],
        prompt: "customization_guideline",
        priority: 2,
      },
      {
        patterns: [/mais opçõ|outro|diferente|parecido|similar|dúvida|indecis/i],
        prompt: "indecision_guideline",
        priority: 2,
      },
      {
        patterns: [/retirada|retirar|loja|endereço da loja|onde vocês ficam/i],
        prompt: "location_guideline",
        priority: 2,
      },
      {
        patterns: [/quanto tempo|prazo|produção|pronta entrega|personalizado|demora quanto/i],
        prompt: "faq_production_guideline",
        priority: 2,
      },
      {
        patterns: [
          /falar com humano|falar com atendente|pessoa|atendimento humano|falar com alguém|falar com alguem|suporte|falar com paulo|manda pro paulo|chama o paulo|falar com o paulo/i,
        ],
        prompt: "human_transfer_guideline",
        priority: 0,
      },
    ];

    if (isGreetingOnly) {
      return {
        prompts: ["core_identity_guideline"],
        wasExplicitMatch: false,
      };
    }

    const matched = contextMap
      .filter((ctx) =>
        ctx.patterns.some((pattern) => pattern.test(messageLower)),
      )
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 5)
      .map((ctx) => ctx.prompt);

    const uniquePrompts = [...new Set(matched)];
    const wasExplicitMatch = uniquePrompts.length > 0;

    if (uniquePrompts.length === 0) {
      uniquePrompts.push("product_selection_guideline");
    }

    return {
      prompts: ["core_identity_guideline", ...uniquePrompts],
      wasExplicitMatch,
    };
  }

  

  private getSynthesisPrompt(toolResults: ToolExecutionResult[]): string {
    const resultsText = toolResults
      .map(
        (r) =>
          `FERRAMENTA: ${r.toolName}\nENTRADA: ${JSON.stringify(r.input)}\nRESULTADO: ${r.output}\n`,
      )
      .join("\n---\n");

    return `Você coletou as seguintes informações através de ferramentas:

${resultsText}

AGORA é hora de responder ao cliente com UMA mensagem completa e organizada.

REGRAS PARA SUA RESPOSTA:
1. NÃO use mais tool_calls agora
2. ORGANIZE todas as informações coletadas de forma clara
3. Use emojis para deixar visual e amigável
4. Seja natural e conversacional
5. NUNCA mencione que "consultou" ou "verificou" algo
6. Apresente as informações como se você já soubesse
7. Mencione tempo de produção somente quando o produto e o tempo forem conhecidos
8. Se produto tiver "caneca" no nome, mencione opções de customização
9. DESCREVA OS PRODUTOS EXATAMENTE COMO RETORNADOS. NÃO invente itens (comidas, bebidas) que não estão listados no JSON da ferramenta.
10. FECHAMENTO DE PEDIDO: Se estiver finalizando um pedido (com data, endereço e pagamento), use OBRIGATORIAMENTE o formato de Resumo Visual:
    ═══ 📋 RESUMO DO SEU PEDIDO ═══
    (detalhes aqui...)
    ════════════════════════════
11. ATENDIMENTO HUMANO: Se as ferramentas indicarem que o suporte foi notificado, informe ao cliente que o time já vai atender e cite o horário comercial se necessário.
12. ⛔ DATAS DE ENTREGA: Se a ferramenta retornou suggested_slots, APRESENTE TODOS ao cliente e PERGUNTE qual ele prefere. NUNCA escolha um horário por conta própria. O estimated_ready_time é tempo de produção, NÃO é o horário de entrega escolhido.
13. NUNCA mencione o nome de funcionários específicos ao cliente. Use "nosso time" ou "nosso atendente".

Gere APENAS a mensagem final para o cliente.`;
  }

  private normalizarTermoBusca(termo: string): string {
    return termo.trim().toLowerCase();
  }

  private hasCatalogKeyword(term: string): boolean {
    return /cest[ao]|buqu[eê]|caneca|chocolate|pelu[cç]ia|quadro|quebra|bar|cafe|café|anivers[aá]rio|namorad|rom[aâ]ntic|flores|rosa|urso|presente/i.test(
      term,
    );
  }

  private extractSearchTerm(rawTerm: string, contextMessage: string): string {
    const source = `${rawTerm} ${contextMessage}`.toLowerCase();
    const mappings = [
      { pattern: /cest[ao]/, term: "cesto" },
      { pattern: /buqu[eê]|flores|rosas?/, term: "buquê" },
      { pattern: /caneca/, term: "caneca" },
      { pattern: /pelu[cç]ia|urso/, term: "pelúcia" },
      { pattern: /quebra[-\s]?cabe[cç]a/, term: "quebra-cabeça" },
      { pattern: /quadro|polaroid|foto/, term: "quadro" },
      { pattern: /bar|bebida/, term: "bar" },
      { pattern: /chocolate/, term: "chocolate" },
      { pattern: /cafe|caf[eé]/, term: "café" },
      { pattern: /anivers[aá]rio/, term: "aniversário" },
      { pattern: /namorad[oa]s?/, term: "namorados" },
      { pattern: /rom[aâ]ntic[ao]/, term: "romântica" },
      { pattern: /esposa/, term: "esposa" },
    ];

    for (const mapping of mappings) {
      if (mapping.pattern.test(source)) {
        return mapping.term;
      }
    }

    const stopwords = new Set([
      "o",
      "a",
      "de",
      "da",
      "do",
      "em",
      "um",
      "uma",
      "e",
      "ou",
      "para",
      "por",
      "com",
      "pra",
      "pro",
      "minha",
      "meu",
      "minhas",
      "meus",
      "quero",
      "queria",
      "gostaria",
      "preciso",
    ]);

    const words = rawTerm
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1 && !stopwords.has(w));

    return words[0] || rawTerm.trim();
  }

  private shouldExcludeProducts(userMessage: string): boolean {
    return /mais opç|mais opc|mais opcoes|mais opções|outra|outro|diferente|parecido|similar|mostra mais|ver mais/i.test(
      userMessage,
    );
  }

  private async curateProducts(
    catalogResult: string,
    userMessage: string,
    memorySummary: string | null,
  ): Promise<string> {
    try {
      let parsed = typeof catalogResult === "string" ? JSON.parse(catalogResult) : catalogResult;
      if (!parsed || parsed.status === "error" || parsed.status === "not_found") return catalogResult;

      const allProducts = [...(parsed.exatos || []), ...(parsed.fallback || [])];
      if (allProducts.length <= 2) return catalogResult;

      const isExplicitCaneca = /caneca/i.test(userMessage);
      const wantsFullCatalog = /catálogo|catalogo|todas|todos|lista|menu|cardápio|cardapio/i.test(userMessage);

      if (wantsFullCatalog) return catalogResult;

      const productList = allProducts.map((p: any, i: number) =>
        `${i + 1}. ${p.nome} - R$${p.preco} | Tipo: ${p.tipo_produto || "CESTA"} | Produção: ${p.production_time}h`
      ).join("\n");

      const curationResponse = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: `Você é um curador de produtos para uma loja de cestas e flores.
Sua tarefa: dado o pedido do cliente e a lista de produtos, selecione os 2 MELHORES produtos.

REGRAS DE CURADORIA:
- Priorize cestas, quadros e flores sobre canecas (salvo se cliente pediu caneca explicitamente)
- Prefira produtos com preço intermediário (nem o mais barato nem o mais caro)
- Considere a ocasião/contexto do cliente
- Variedade: escolha 2 opções DIFERENTES em tipo ou faixa de preço
- ${isExplicitCaneca ? "Cliente PEDIU caneca, priorize canecas" : "EVITE canecas como primeira opção"}

Responda APENAS com os números das 2 melhores opções, separados por vírgula. Ex: "1,4"`,
          },
          {
            role: "user",
            content: `Cliente disse: "${userMessage}"${memorySummary ? `\nContexto: ${memorySummary}` : ""}\n\nProdutos disponíveis:\n${productList}`,
          },
        ],
        max_tokens: 20,
      });

      const picks = (curationResponse.choices[0]?.message?.content || "")
        .replace(/\s/g, "")
        .split(",")
        .map((n: string) => parseInt(n, 10) - 1)
        .filter((n: number) => !isNaN(n) && n >= 0 && n < allProducts.length);

      if (picks.length < 2) return catalogResult;

      const curated = picks.map((idx: number) => allProducts[idx]);
      const rest = allProducts.filter((_: any, i: number) => !picks.includes(i));

      parsed.exatos = curated.map((p: any, i: number) => ({
        ...p,
        ranking: i + 1,
        tipo_resultado: "EXATO",
        curated: true,
      }));
      parsed.fallback = rest.map((p: any, i: number) => ({
        ...p,
        ranking: curated.length + i + 1,
        tipo_resultado: "FALLBACK",
      }));

      logger.info(`🎯 Curadoria: selecionados [${picks.map((i: number) => allProducts[i]?.nome).join(", ")}]`);
      return JSON.stringify(parsed, null, 0);
    } catch (e) {
      logger.warn("⚠️ Falha na curadoria, retornando resultado original", e);
      return catalogResult;
    }
  }

  private buildCheckoutContext(sourceText: string): {
    context: string;
    hasAll: boolean;
  } {
    const text = sourceText.toLowerCase();
    const productMatch = text.match(
      /cesta|cesto|buqu[eê]|produto|caneca|bar|quadro|pelu[cç]ia|rosa|flores/, 
    );
    const dateMatch = text.match(
      /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b|amanh[aã]|hoje|dia\s+\d{1,2}/,
    );
    const addressMatch = text.match(
      /endere[cç]o\s+[^,\n]+|rua\s+[^,\n]+|avenida\s+[^,\n]+|bairro\s+[^,\n]+|cidade\s+[^,\n]+/,
    );
    const paymentMatch = text.match(/\bpix\b|cart[aã]o|cr[eé]dito|d[eé]bito/);

    const contextParts = [];
    if (productMatch) contextParts.push(`cesta: ${productMatch[0]}`);
    if (dateMatch) contextParts.push(`entrega: ${dateMatch[0]}`);
    if (addressMatch) contextParts.push(`endereco: ${addressMatch[0]}`);
    if (paymentMatch) contextParts.push(`pagamento: ${paymentMatch[0]}`);

    return {
      context: contextParts.join(" | "),
      hasAll: Boolean(productMatch && dateMatch && addressMatch && paymentMatch),
    };
  }

  

  private getCheckoutIterativePrompt(checkoutState: CheckoutState, checkoutData: Partial<CheckoutData>): string {
    switch (checkoutState) {
      case CheckoutState.PRODUCT_SELECTED:
        return `ETAPA: Produto confirmado ✅
Próxima etapa: COLETE A DATA E HORÁRIO DE ENTREGA

O cliente:
- Produto: ${checkoutData.productName} (R$ ${checkoutData.productPrice})

Agora você DEVE:
1. Pergunte: "Para qual data você gostaria da entrega?"
2. Após o cliente responder, valide a disponibilidade com validate_delivery_availability (com tool_call silencioso)
3. Apresente os horários disponíveis
4. Aguarde a confirmação do horário

⚠️ REGRA: NÃO avance para a próxima etapa até coletar data E horário.`;

      case CheckoutState.WAITING_DATE:
        return `ETAPA: Data e horário coletados ✅
${checkoutData.deliveryDate} às ${checkoutData.deliveryTime}

Próxima etapa: COLETE O ENDEREÇO COMPLETO

Agora você DEVE:
1. Pergunte: "Qual o endereço completo para a entrega? (Rua, número, bairro, cidade, complemento)"
2. Valide que o cliente forneceu TODOS os dados
3. Confirme o endereço antes de prosseguir

⚠️ REGRA: Endereço COMPLETO com rua, número, bairro, cidade e complemento.`;

      case CheckoutState.WAITING_ADDRESS:
        return `ETAPA: Endereço coletado ✅
${checkoutData.address}

Próxima etapa: COLETE A FORMA DE PAGAMENTO

Agora você DEVE:
1. Pergunte: "Você prefere pagar por PIX ou Cartão?"
2. Aguarde resposta clara
3. ❌ NÃO mencione chave PIX ou dados bancários
4. ❌ NÃO calcule frete - diga que o atendente confirmará

⚠️ REGRA: Coleta apenas "PIX" ou "Cartão".`;

      case CheckoutState.WAITING_PAYMENT:
        return `ETAPA: Forma de pagamento coletada ✅
Método: ${checkoutData.paymentMethod}

Próxima etapa: APRESENTE O RESUMO FINAL

Agora você DEVE:
1. Apresente o resumo completo com:
   - Produto: ${checkoutData.productName} - R$ ${checkoutData.productPrice}
   - Entrega: ${checkoutData.deliveryDate} às ${checkoutData.deliveryTime}
   - Endereço: ${checkoutData.address}
   - Pagamento: ${checkoutData.paymentMethod}
   - Frete: Será confirmado pelo atendente
   - TOTAL: R$ ${checkoutData.totalValue}

2. Pergunte: "Está tudo certo? Posso finalizar seu pedido?"
3. Aguarde confirmação explícita (tipo "sim", "pode finalizar", "perfeito")

⚠️ REGRA: Não finalize sem confirmação explícita do cliente.`;

      case CheckoutState.READY_TO_FINALIZE:
        return `ETAPA: Cliente confirmou pedido ✅

Agora você DEVE executar EXATAMENTE estas 2 ferramentas em sequência:
1. notify_human_support (com ESTRUTURA COMPLETA)
2. block_session

Estrutura OBRIGATÓRIA para notify_human_support:
{
  reason: "end_of_checkout",
  customer_context: "Pedido: ${checkoutData.productName} - R$ ${checkoutData.productPrice}
Entrega: ${checkoutData.deliveryDate} às ${checkoutData.deliveryTime}
Endereço: ${checkoutData.address}
Pagamento: ${checkoutData.paymentMethod}
Frete: A ser confirmado
TOTAL: R$ ${checkoutData.totalValue}",
  should_block_flow: true
}

Depois diga: "Perfeito! Já passei todos os detalhes para o nosso time. Eles vão cuidar do pagamento e de tudo mais! Logo te respondem. Obrigadaaa ❤️🥰"`;

      default:
        return "";
    }
  }

  

  private async extractCheckoutData(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], sessionId: string): Promise<Partial<CheckoutData>> {
    const data: Partial<CheckoutData> = {};

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "tool") continue;

      const content = typeof msg.content === "string" ? msg.content : "";

      if (content.includes("cesta") || content.includes("produto")) {
        try {
          const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            const firstProduct = parsed.exatos?.[0] || parsed.produtos?.[0];
            if (firstProduct) {
              data.productName = firstProduct.name || firstProduct.nome;
              data.productPrice = Number(firstProduct.price || firstProduct.preco) || 0;
            }
          }
        } catch (e) {
          logger.debug("Erro ao extrair dados de produto", e);
        }
      }

      if (content.includes("disponível") || content.includes("horário")) {
        try {
          const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.suggested_slots && parsed.suggested_slots[0]) {
              data.deliveryDate = parsed.suggested_slots[0].date;
              data.deliveryTime = parsed.suggested_slots[0].slot;
            }
          }
        } catch (e) {
          logger.debug("Erro ao extrair dados de horário", e);
        }
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "user") continue;

      const content = typeof msg.content === "string" ? msg.content : "";
      const contentLower = content.toLowerCase();

      if (!data.address) {
        const addressMatch = content.match(/(?:rua|avenida|av\.|r\.)\s+[^,\n]+,?\s*\d+[^,\n]*,?\s*[^,\n]+,?\s*[^,\n]+/i);
        if (addressMatch) {
          data.address = addressMatch[0];
        }
      }

      if (!data.paymentMethod) {
        if (contentLower.includes("pix")) {
          data.paymentMethod = "PIX";
        } else if (contentLower.includes("cartão") || contentLower.includes("cartao") || contentLower.includes("crédito")) {
          data.paymentMethod = "CARTAO";
        }
      }
    }

    return data;
  }

  

  private determineCheckoutState(checkoutData: Partial<CheckoutData>): CheckoutState {
    if (!checkoutData.productName || checkoutData.productPrice === undefined) {
      return CheckoutState.PRODUCT_SELECTED;
    }
    if (!checkoutData.deliveryDate || !checkoutData.deliveryTime) {
      return CheckoutState.WAITING_DATE;
    }
    if (!checkoutData.address) {
      return CheckoutState.WAITING_ADDRESS;
    }
    if (!checkoutData.paymentMethod) {
      return CheckoutState.WAITING_PAYMENT;
    }
    return CheckoutState.READY_TO_FINALIZE;
  }

  private async buildCartEventContext(sessionId: string, customerName: string): Promise<string> {
    try {
      const messages = await prisma.aIAgentMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: "desc" },
        take: 10,
      });

      const recentMessages = messages.reverse();
      const userMessages = recentMessages
        .filter((m) => m.role === "user")
        .slice(-5)
        .map((m) => m.content);

      if (userMessages.length === 0) {
        return `${customerName} adicionou um produto ao carrinho. Encaminhar para atendimento especializado.`;
      }

      const lastMessage = userMessages[userMessages.length - 1] || "";
      const contextMessages = userMessages.slice(-3).join(" | ");

      const productMatch = lastMessage.match(
        /opção\s+\d+|caneca|cesta|buquê|quadro|chocol|pelú|rosas?|\*\*(.+?)\*\*/i,
      );
      const priceMatch = lastMessage.match(/R\$\s*([\d.,]+)/);

      let summary = `${customerName} está na conversa com contexto: "${contextMessages}"`;

      if (productMatch) {
        summary += `. Parece estar interessado em: ${productMatch[1] || productMatch[0]}`;
      }
      if (priceMatch) {
        summary += ` (R$ ${priceMatch[1]})`;
      }

      summary += ". Adicionou ao carrinho e encaminhar para atendimento.";

      return summary;
    } catch (error: any) {
      logger.warn(
        `⚠️ Erro ao construir contexto do carrinho: ${error.message}`,
      );
      return `${customerName} adicionou um produto ao carrinho. Encaminhar para atendimento especializado.`;
    }
  }

  

  private buildCheckoutSummaryFromAssistantMessage(
    assistantContent: string,
    recentHistory: any[],
    customerName: string,
    customerPhone: string,
  ): string {
    const allText = recentHistory
      .filter((m) => m.role === "assistant" || m.role === "user")
      .map((m) => (m.content || "").toString())
      .join("\n");

    const combined = `${allText}\n${assistantContent}`;

    // Extração com fallback melhorado
    const productMatch = combined.match(/\*\*(.+?)\*\*\s*[-–]\s*R\$\s*([\d.,]+)/);
    const productName = productMatch?.[1] || combined.match(/(?:cesta|buquê|caneca|quadro|pelúcia|flores?|rosa)\s+[^,\n–-]*/i)?.[0] || "[Produto não especificado]";
    const productPrice = productMatch?.[2] || combined.match(/R\$\s*([\d.,]+)/)?.[1] || "[Valor não especificado]";

    const dateMatch = combined.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
    const deliveryDate = dateMatch?.[1] || combined.match(/(hoje|amanh[ãa]|segunda|terça|quarta|quinta|sexta|sábado|domingo)/i)?.[1] || "[Data não especificada]";

    const timeMatch = combined.match(/(?:às|as|horário:?|hora:?)\s*(\d{1,2}:\d{2}(?:\s*(?:às|a)\s*\d{1,2}:\d{2})?)/i);
    const deliveryTime = timeMatch?.[1] || "[Horário não especificado]";

    const addressMatch = combined.match(/(?:rua|avenida|av\.|r\.)\s+[^,\n]+(?:,\s*\d+)?(?:,?\s*[^,\n]+)?(?:,?\s*[^,\n]+)?/i);
    const isRetirada = /retirada/i.test(combined);
    const address = addressMatch?.[0] || (isRetirada ? "RETIRADA NA LOJA - Horário a confirmar" : "[Endereço não especificado]");

    const paymentMatch = combined.match(/\b(pix|cart[ãa]o|crédito|cr[eé]dito)\b/i);
    const payment = paymentMatch?.[1]?.toUpperCase() || "[Pagamento não especificado]";

    const lines = [
      `Produto: ${productName} - R$ ${productPrice}`,
      `Entrega: ${deliveryDate} às ${deliveryTime}`,
      `Endereço: ${address}`,
      `Pagamento: ${payment}`,
      `Frete: A ser confirmado`,
      `Total: R$ [A confirmar]`,
    ];

    return lines.join("\n");
  }

  private buildStructuredCheckoutContext(
    checkoutData: Partial<CheckoutData>,
    customerName: string,
    customerPhone: string
  ): string {
    const lines = [
      "═══════════════════════════════════════════",
      "📋 NOVO PEDIDO - EQUIPE DE ATENDIMENTO",
      "═══════════════════════════════════════════",
      "",
      `👤 Cliente: ${customerName || "Desconhecido"}`,
      `📱 Telefone: ${customerPhone || "Não fornecido"}`,
      "",
      "📦 DETALHES DO PEDIDO:",
      `   Produto: ${checkoutData.productName || "[NÃO ESPECIFICADO]"} - R$ ${checkoutData.productPrice || "0,00"}`,
      "",
      "🚚 ENTREGA:",
      `   Data: ${checkoutData.deliveryDate || "[NÃO ESPECIFICADA]"}`,
      `   Horário: ${checkoutData.deliveryTime || "[NÃO ESPECIFICADO]"}`,
      `   Tipo: ${checkoutData.deliveryType === "retirada" ? "RETIRADA" : "ENTREGA"}`,
      "",
      "📍 ENDEREÇO:",
      `   ${checkoutData.address || "[ENDEREÇO NÃO FORNECIDO]"}`,
      "",
      "💳 PAGAMENTO:",
      `   Método: ${checkoutData.paymentMethod || "[NÃO ESPECIFICADO]"}`,
      `   Frete: A ser confirmado`,
      `   Total: R$ ${checkoutData.totalValue || "0,00"}`,
      "",
      "═══════════════════════════════════════════",
      "⏭️ Próximos passos:",
      "1. Confirmar frete com o cliente",
      "2. Processar pagamento",
      "3. Solicitar fotos/personalizações se aplicável",
      "4. Enviar confirmação do pedido",
      "═══════════════════════════════════════════",
    ];

    return lines.join("\n");
  }

  private async handleCheckoutConfirmation(
    recentHistory: any[],
    userMessage: string,
    sessionId: string,
    customerPhone: string,
    customerName: string,
    remoteJidAlt?: string,
  ): Promise<any | null> {
    // Validação: se mensagem é muito vaga, não processe como confirmação
    const cleanedMsg = userMessage.trim().toLowerCase().replace(/[^\w\s]/g, "");
    if (cleanedMsg.length <= 2) {
      // Mensagem muito vaga como ".", "ok", "sim" isolado
      const engageResponse = await this.engageVagueUser(recentHistory, userMessage);
      if (engageResponse === "transfer") {
        // Só transfer após múltiplas respostas vagas
        // Aqui poderia fazer transfer, mas vamos manter conservador
        return null;
      }
      // Retorna sugestão para engajar
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: engageResponse } }] };
        },
      };
      await prisma.aIAgentMessage.create({
        data: {
          session_id: sessionId,
          role: "assistant",
          content: engageResponse,
        },
      });
      return mockStream;
    }

    const assistantMsgs = recentHistory.filter((m) => m.role === "assistant" && m.content);
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    if (!lastAssistant) return null;

    const assistantContent = (lastAssistant.content || "").toString();
    const hasSummary =
      /resumo.*pedido|está tudo cert|posso confirmar|posso finalizar|tudo certinho/i.test(
        assistantContent,
      ) &&
      /produto|cesta|buqu|caneca|flor|rosa|quadro/i.test(assistantContent) &&
      /entrega|data/i.test(assistantContent) &&
      /pagamento|pix|cart[aã]o/i.test(assistantContent);

    if (!hasSummary) return null;

    const msgLower = userMessage.toLowerCase().trim();
    const isConfirmation =
      /^(sim|pode|perfeito|tudo certo|confirma|t[aá] certo|t[aá] ok|isso|isso mesmo|fechado|fechar|bora|vamos|ok|blz|beleza|pode sim|show|boa|pode finalizar|sim pode|certinho|issoo|simm|isso a[ií]|fechou|s|ss|sss|pode confirmar|t[aá] perfeito|correto|certo)$/i.test(
        msgLower,
      ) ||
      (/\b(sim|pode finalizar|tudo certo|confirma|pode confirmar|t[aá] perfeito|isso mesmo|fechado)\b/i.test(
        msgLower,
      ) &&
        msgLower.length < 80);

    if (!isConfirmation) return null;

    logger.info("🔒 CHECKOUT CONFIRMADO - Executando notify+block garantido");

    const extractedPhone = sessionId.match(/^session-(\d+)$/)?.[1] || "";
    const phoneFromRemote = remoteJidAlt ? remoteJidAlt.replace(/\D/g, "") : "";
    const resolvedPhone = customerPhone || extractedPhone || phoneFromRemote;
    const resolvedName = customerName || "Cliente";

    try {
      const structuredContext = this.buildCheckoutSummaryFromAssistantMessage(
        assistantContent,
        recentHistory,
        resolvedName,
        resolvedPhone,
      );
      logger.info(`📋 Resumo estruturado do pedido: ${structuredContext.substring(0, 200)}...`);

      await mcpClientService.callTool("finalize_checkout", {
        customer_context: structuredContext,
        customer_name: resolvedName,
        customer_phone: resolvedPhone,
        session_id: sessionId,
      });
    } catch (error: any) {
      logger.error(`❌ Falha no checkout confirmation garantido: ${error.message}`);
    }

    await this.blockSession(sessionId);

    const confirmResponse =
      "Perfeito! Já passei todos os detalhes para o nosso time. Eles vão cuidar do pagamento e de tudo mais! Logo te respondem. \n\n📞 *Atendimento:*\n• **Seg-Sex:** 07:30-12:00 | 14:00-17:00\n• **Sábado:** 08:00-11:00\n\nObrigadaaa ❤️🥰";

    await prisma.aIAgentMessage.create({
      data: {
        session_id: sessionId,
        role: "assistant",
        content: confirmResponse,
      },
    });

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: confirmResponse } }] };
      },
    };
    return mockStream;
  }

  private detectCheckoutFlowFromHistory(recentHistory: any[]): boolean {
    const recentAssistantMsgs = recentHistory
      .filter((m) => m.role === "assistant" && m.content)
      .slice(-4);

    for (const msg of recentAssistantMsgs) {
      const content = (msg.content || "").toString().toLowerCase();
      if (
        /qual data|data.*entrega|quando.*entrega|para quando|qual.*hor[aá]rio|endere[cç]o completo|rua.*n[uú]mero.*bairro|pix ou cart|forma de pagamento|resumo.*pedido|posso confirmar|posso finalizar|pode confirmar|vou levar|quero essa|quero esse/.test(
          content,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private filterHistoryForContext(history: any[]): any[] {

    if (history.length <= 15) {
      return history;
    }

    const filtered: any[] = [];
    let userMessageCount = 0;
    const MAX_USER_MESSAGES = 15;

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      filtered.unshift(msg);

      if (msg.role === "user") {
        userMessageCount++;
        if (userMessageCount >= MAX_USER_MESSAGES) {
          break;
        }
      }
    }

    const validated: any[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];

      if (msg.role === "tool") {

        const toolCallId = msg.tool_call_id;
        let foundAssistant = false;

        for (let j = i - 1; j >= 0; j--) {
          if (filtered[j].role === "assistant" && filtered[j].tool_calls) {
            try {
              const toolCalls = JSON.parse(filtered[j].tool_calls);
              if (toolCalls.some((tc: any) => tc.id === toolCallId)) {
                foundAssistant = true;
                break;
              }
            } catch (e) {

            }
          }
        }

        if (foundAssistant) {
          validated.push(msg);
        }
      } else {
        validated.push(msg);
      }
    }

    return validated;
  }

  async getSession(
    sessionId: string,
    customerPhone?: string,
    remoteJidAlt?: string,
  ) {
    let session = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { created_at: "asc" },
        },
      },
    });

    if (session && isPast(session.expires_at)) {
      logger.info(
        `🧹 [AIAgent] Deletando sessão expirada e mensagens: ${sessionId}`,
      );

      await prisma.aIAgentMessage.deleteMany({
        where: { session_id: sessionId },
      });
      await prisma.aISessionProductHistory.deleteMany({
        where: { session_id: sessionId },
      });

      await prisma.aIAgentSession.delete({ where: { id: sessionId } });
      session = null;
    }

    if (!session) {

      const extractedPhoneMatch = sessionId.match(/^session-(\d+)$/);
      const extractedPhone = extractedPhoneMatch
        ? extractedPhoneMatch[1]
        : null;

      let identifyingPhone: string | null =
        customerPhone || extractedPhone || null;
      let identifyingRemoteJid: string | null = remoteJidAlt || null;

      if (extractedPhone) {
        logger.debug(
          `🔍 [AIAgent] Phone extraído do sessionId: ${extractedPhone}`,
        );
        if (customerPhone && customerPhone !== extractedPhone) {
          logger.warn(
            `⚠️ [AIAgent] Desconexão: sessionId tem ${extractedPhone} mas customerPhone é ${customerPhone}`,
          );
        }
      }

      if (!customerPhone && identifyingRemoteJid) {
        logger.info(
          `🔍 [AIAgent] Procurando sessão por remoteJidAlt: ${identifyingRemoteJid}`,
        );
        const existingByRemoteJid = await prisma.aIAgentSession.findFirst({
          where: { remote_jid_alt: identifyingRemoteJid },
          include: {
            messages: {
              orderBy: { created_at: "asc" },
            },
          },
        });

        if (existingByRemoteJid && !isPast(existingByRemoteJid.expires_at)) {
          logger.info(
            `✅ [AIAgent] Encontrada sessão existente por remoteJidAlt: ${existingByRemoteJid.id}`,
          );
          return existingByRemoteJid;
        }
      }

      session = await prisma.aIAgentSession.create({
        data: {
          id: sessionId,
          customer_phone: identifyingPhone,
          remote_jid_alt: identifyingRemoteJid,
          expires_at: addDays(new Date(), 5),
        },
        include: {
          messages: true,
        },
      });

      logger.info(
        `✨ [AIAgent] Nova sessão criada: ${sessionId} (phone: ${identifyingPhone || "null"}, remoteJid: ${identifyingRemoteJid || "null"})`,
      );
    } else if (customerPhone || remoteJidAlt) {

      if (customerPhone && !session.customer_phone) {
        logger.info(
          `📱 [AIAgent] Atualizando sessão com phone real: ${sessionId} (${customerPhone})`,
        );

        session = await prisma.aIAgentSession.update({
          where: { id: sessionId },
          data: {
            customer_phone: customerPhone,
            remote_jid_alt: remoteJidAlt,
          },
          include: {
            messages: true,
          },
        });
      } else if (remoteJidAlt && !session.remote_jid_alt) {
        session = await prisma.aIAgentSession.update({
          where: { id: sessionId },
          data: {
            remote_jid_alt: remoteJidAlt,
          },
          include: {
            messages: true,
          },
        });
      }
    }

    return session;
  }

  async getCustomerMemory(phone: string) {
    const memory = await prisma.customerMemory.findUnique({
      where: { customer_phone: phone },
    });

    if (memory && isPast(memory.expires_at)) {
      logger.info(`🧹 [AIAgent] Deletando memória expirada para: ${phone}`);
      await prisma.customerMemory.delete({ where: { customer_phone: phone } });
      return null;
    }

    return memory;
  }

  async getSentProductsInSession(sessionId: string): Promise<string[]> {
    const sentProducts = await prisma.aISessionProductHistory.findMany({
      where: { session_id: sessionId },
      select: { product_id: true },
    });
    return sentProducts.map((sp) => sp.product_id);
  }

  async listSessions() {
    const sessions = await prisma.aIAgentSession.findMany({
      include: {
        messages: {
          select: { created_at: true },
          orderBy: { created_at: "desc" },
          take: 1,
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    const sessionsWithCustomer = await Promise.all(
      sessions.map(async (session) => {
        if (session.customer_phone) {
          const customer = await prisma.customer.findUnique({
            where: { number: session.customer_phone },
            select: { name: true },
          });
          return {
            ...session,
            customer: customer || undefined,
          };
        }
        return session;
      }),
    );

    return sessionsWithCustomer.sort((a, b) => {
      const dateA =
        a._count.messages > 0
          ? new Date(a.messages[0].created_at).getTime()
          : new Date(a.created_at).getTime();
      const dateB =
        b._count.messages > 0
          ? new Date(b.messages[0].created_at).getTime()
          : new Date(b.created_at).getTime();
      return dateB - dateA;
    });
  }

  async blockSession(sessionId: string) {
    return prisma.aIAgentSession.update({
      where: { id: sessionId },
      data: {
        is_blocked: true,
        expires_at: addDays(new Date(), 4),
      },
    });
  }

  async unblockSession(sessionId: string) {
    return prisma.aIAgentSession.update({
      where: { id: sessionId },
      data: {
        is_blocked: false,
      },
    });
  }

  async clearSessionHistory(sessionId: string) {
    const result = await prisma.aIAgentMessage.deleteMany({
      where: { session_id: sessionId },
    });
    return result.count;
  }

  async recordProductSent(sessionId: string, productId: string) {
    const existing = await prisma.aISessionProductHistory.findUnique({
      where: {
        session_id_product_id: { session_id: sessionId, product_id: productId },
      },
    });

    if (existing) {
      await prisma.aISessionProductHistory.update({
        where: { id: existing.id },
        data: {
          sent_count: { increment: 1 },
          last_sent_at: new Date(),
        },
      });
    } else {
      await prisma.aISessionProductHistory.create({
        data: {
          session_id: sessionId,
          product_id: productId,
          sent_count: 1,
        },
      });
    }
  }

  private isMessageTooVague(message: string, conversationLength: number): boolean {
    const cleaned = message.trim().toLowerCase().replace(/[^\w\s]/g, "");
    const hasContent = cleaned.length > 2;
    const hasWords = cleaned.split(/\s+/).length >= 2;
    
    // Mensagens com apenas ponto, sim, ok, etc no início de conversa
    if (conversationLength < 10 && !hasWords) return true;
    
    return !hasContent || (cleaned.length <= 3 && !hasWords);
  }

  private async engageVagueUser(
    history: any[],
    currentMessage: string,
  ): Promise<string> {
    // Se cliente enviou algo muito vago, tente engajar
    const recentUserMessages = history
      .filter((m) => m.role === "user")
      .map((m) => (m.content || "").toString())
      .slice(-5);

    const vagueCount = recentUserMessages.filter((msg) =>
      this.isMessageTooVague(msg, history.length),
    ).length;

    // Se 2+ mensagens vagas, pode transferir
    if (vagueCount >= 2) {
      return "transfer";
    }

    // Senão, engaje o cliente
    const suggestions = [
      "Gostou dessa opção? 😊",
      "Qual tipo de presente você procura? Flor, cesta ou algo personalizado? 💕",
      "Me conta mais! O que você está procurando? 🥰",
      "Quer que eu mostre algumas opções? 🌹",
    ];

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  async chat(
    sessionId: string,
    userMessage: string,
    customerPhone?: string,
    customerName?: string,
    remoteJidAlt?: string,
  ) {
    const session = await this.getSession(
      sessionId,
      customerPhone,
      remoteJidAlt,
    );

    const msgLower = userMessage.toLowerCase();
    const isCartEvent =
      /\[interno\].*carrinho/i.test(userMessage) ||
      /evento\s*=\s*cart_added/i.test(userMessage) ||
      /cart_added/i.test(userMessage) ||
      /adicionou.*carrinho/i.test(userMessage);
    const sensitiveKeywords = [
      "chave pix",
      "chave do pix",
      "pix da loja",
      "dados do pix",
      "endereço da loja",
      "endereço de vocês",
      "onde fica a loja",
      "mande seu endereço",
      "qual o endereço",
      "enviar chave",
    ];

    if (sensitiveKeywords.some((keyword) => msgLower.includes(keyword))) {
      const safeResponse =
        msgLower.includes("pix") || msgLower.includes("pagamento")
          ? "O pagamento é processado pelo nosso time especializado após a confirmação do pedido. Eles enviam todos os dados necessários de forma segura! 🔒"
          : "Para retirada, nosso atendente especializado passa todos os detalhes certinhos no horário comercial! 🏪";

      await prisma.aIAgentMessage.create({
        data: {
          session_id: sessionId,
          role: "user",
          content: userMessage,
        },
      });

      await prisma.aIAgentMessage.create({
        data: {
          session_id: sessionId,
          role: "assistant",
          content: safeResponse,
        },
      });

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: safeResponse } }] };
        },
      };
      return mockStream;
    }

    if (isCartEvent) {
      if (session.is_blocked) {
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [
                {
                  delta: {
                    content:
                      "Este atendimento foi transferido para um atendente humano. Por favor, aguarde o retorno. ❤️",
                  },
                },
              ],
            };
          },
        };
        return mockStream;
      }

      const extractedPhone = sessionId.match(/^session-(\d+)$/)?.[1] || "";
      const phoneFromRemote = remoteJidAlt ? remoteJidAlt.replace(/\D/g, "") : "";
      const resolvedPhone =
        customerPhone || session.customer_phone || extractedPhone || phoneFromRemote;
      const resolvedName = customerName || "Cliente";

      try {
        const enrichedContext = await this.buildCartEventContext(
          sessionId,
          resolvedName,
        );

        await mcpClientService.callTool("notify_human_support", {
          reason: "cart_added",
          customer_context: enrichedContext,
          customer_name: resolvedName,
          customer_phone: resolvedPhone,
          session_id: sessionId,
        });
      } catch (error: any) {
        logger.error(
          `❌ Falha ao notificar/bloquear para cart event: ${error.message}`,
        );
      }

      await this.blockSession(sessionId);

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  content:
                    "Vi que você adicionou um produto no carrinho. Vou te direcionar para o atendimento especializado.",
                },
              },
            ],
          };
        },
      };
      return mockStream;
    }

    if (customerPhone) {
      await prisma.customer.upsert({
        where: { number: customerPhone },
        update: {
          name: customerName,
          last_message_sent: new Date(),
          follow_up: true,
        },
        create: {
          number: customerPhone,
          name: customerName,
          last_message_sent: new Date(),
          follow_up: true,
        },
      });
    }

    if (session.is_blocked) {

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  content:
                    "Este atendimento foi transferido para um atendente humano. Por favor, aguarde o retorno. ❤️",
                },
              },
            ],
          };
        },
      };
      return mockStream;
    }

    const phone = customerPhone || session.customer_phone;

    let memory = null;
    if (phone) {
      memory = await this.getCustomerMemory(phone);
    }

    const sentProductIds = await this.getSentProductsInSession(sessionId);

    const now = new Date();
    const timeInCampina = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Fortaleza",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);

    const dateInCampina = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Fortaleza",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    const tomorrowInCampina = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Fortaleza",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() + 86400000));

    const dayOfWeek = now
      .toLocaleDateString("en-US", {
        timeZone: "America/Fortaleza",
        weekday: "long",
      })
      .toLowerCase();
    const [h, m] = timeInCampina.split(":").map(Number);
    const curMin = h * 60 + m;
    let isOpen = false;
    if (dayOfWeek === "saturday") {
      isOpen = curMin >= 8 * 60 && curMin <= 11 * 60;
    } else if (dayOfWeek !== "sunday") {
      isOpen =
        (curMin >= 7 * 60 + 30 && curMin <= 12 * 60) ||
        (curMin >= 14 * 60 && curMin <= 17 * 60);
    }
    const storeStatus = isOpen
      ? "ABERTA (Atendendo agora ✅)"
      : "FECHADA (Fora do expediente ⏰)";

    await prisma.aIAgentMessage.create({
      data: {
        session_id: sessionId,
        role: "user",
        content: userMessage,
      },
    });

    const history = await prisma.aIAgentMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: "asc" },
    });

    const recentHistory = this.filterHistoryForContext(history);

    const checkoutConfirmationResult = await this.handleCheckoutConfirmation(
      recentHistory,
      userMessage,
      sessionId,
      customerPhone || session.customer_phone || "",
      customerName || "Cliente",
      remoteJidAlt,
    );
    if (checkoutConfirmationResult) {
      return checkoutConfirmationResult;
    }

    const { prompts: relevantPrompts, wasExplicitMatch } = this.detectContextualPrompts(userMessage);
    logger.info(`📚 RAG: Carregando ${relevantPrompts.length} prompts (match=${wasExplicitMatch}): ${relevantPrompts.join(', ')}`);

    const toolsInMCP = await mcpClientService.listTools();

    let mcpSystemPrompts = "";
    try {
      const promptResponses = await Promise.all(
        relevantPrompts.map((promptName) =>
          mcpClientService.getPrompt(promptName).catch((e) => {
            logger.warn(`⚠️ Prompt "${promptName}" não encontrado`, e);
            return null;
          }),
        ),
      );

      mcpSystemPrompts = promptResponses
        .map((response, index) => {
          if (!response) return "";
          const content = response.messages[0].content;
          if (content.type === "text") {
            const promptName = relevantPrompts[index];
            return index === 0
              ? `--- DIRETRIZ PRINCIPAL: ${promptName} ---\n${content.text}`
              : `\n\n--- DIRETRIZ: ${promptName} ---\n${content.text}`;
          }
          return "";
        })
        .filter((text) => text.length > 0)
        .join("");
    } catch (e) {
      logger.error("❌ Erro ao buscar prompts do MCP", e);
      mcpSystemPrompts = "";
    }

    const finalizationIntent = /quero essa|quero esse|vou levar|pode finalizar|finaliza|finalizar|fechar pedido|concluir pedido|como compro|como pago|pagamento|vou confirmar/i.test(
      userMessage.toLowerCase(),
    );

    const isInCheckoutFlow = this.detectCheckoutFlowFromHistory(recentHistory);

    if (finalizationIntent || isInCheckoutFlow) {
      const closingProtocolPrompt = `

--- 🚀 PROTOCOLO OBRIGATÓRIO: FECHAMENTO DE COMPRA ---

⚠️ CLIENTE QUER FINALIZAR! Você DEVE seguir EXATAMENTE estas 5 etapas:

**ETAPA 1: Confirme o Produto**
- Nome exato da cesta/flor
- Preço EXATO (ex: R$ 150,00)
- Se cliente não mencionou, use consultarCatalogo

**ETAPA 2: Colete Data e Horário (OBRIGATÓRIO)**
- Pergunte: "Para qual data você gostaria da entrega?"
- ⛔ **NUNCA ASSUMA, DEDUZA OU INVENTE UMA DATA/HORÁRIO.** Se o cliente não disse a data, PERGUNTE.
- ⛔ Se a tool retornar suggested_slots, APRESENTE TODOS ao cliente e AGUARDE a escolha. NÃO escolha por ele.
- ⛔ Se a tool retornar estimated_ready_time, isso é uma ESTIMATIVA de produção, NÃO é o horário de entrega escolhido.
- Aguarde o cliente responder com uma data (ex: "hoje", "amanhã", "dia 20").
- Somente após a resposta do cliente, use validate_delivery_availability(date_str, time_str)
- Apresente TODOS os horários disponíveis retornados pela tool.
- Cliente ESCOLHE o horário desejado.
- ✅ CONFIRME ambos (Data e Horário) antes de passar para o endereço.

**ETAPA 3: Colete Endereço Completo (OBRIGATÓRIO)**
- Pergunte: "Qual o endereço completo? (Rua, número, bairro, cidade, complemento)"
- Valide que tem TODOS os dados
- Confirme antes de prosseguir

**ETAPA 4: Colete Forma de Pagamento (OBRIGATÓRIO)**
- Pergunte: "PIX ou Cartão?"
- Resposta clara: PIX ou CARTÃO
- ❌ NÃO mencione chave PIX
- ❌ NÃO calcule frete

**ETAPA 5: Resumo e Confirmação**
Apresente:
\`\`\`
Pedido: [Nome do Produto] - R$ [Valor]
Entrega: [Data] às [Horário]
Endereço: [Endereço completo]
Pagamento: [PIX/Cartão]
Frete: Será confirmado pelo atendente
TOTAL: R$ [Valor]
\`\`\`

Pergunte: "Está tudo certo? Posso finalizar?"
Aguarde: "Sim", "pode finalizar", "perfeito", etc.

**SOMENTE APÓS confirmação explícita:**
- Chame: finalize_checkout(customer_context="[resumo completo com produto, data, endereço, pagamento]", customer_name="[nome]", customer_phone="[telefone]")
- A sessão será bloqueada automaticamente.
- Diga: "Perfeito! Já passei todos os detalhes para o nosso time. Eles vão cuidar do pagamento e de tudo mais! Logo te respondem. Obrigadaaa ❤️🥰"

⚠️ NUNCA mencione nomes de funcionários ao cliente. Use "nosso time" ou "nosso atendente".

---

## 🆘 ESCAPE HATCH: TRANSFERÊNCIA HUMANA

⚠️ **PRIORIDADE MÁXIMA**: Se o cliente pedir para falar com um humano, atendente, ou demonstrar irritação, você DEVE **INTERROMPER** este protocolo IMEDIATAMENTE e transferir.

**QUANDO TRANSFERIR:**
- "Quero falar com um atendente"
- "Me passa para alguém"
- "Não quero falar com robô"
- "Preciso de ajuda com [caso complexo]"

**COMO AGIR:**
1. Informe o horário comercial: Seg-Sex (07:30-12:00 | 14:00-17:00) e Sáb (08:00-11:00).
2. Diga: "Vou te passar para o nosso time agora mesmo! Um momento. 💕"
3. Execute notify_human_support(reason="cliente_quer_atendente", customer_context="[contexto breve]"). A sessão é bloqueada automaticamente.

⚠️ notify_human_support NÃO exige dados de checkout. Transfere direto!

---

⚠️ CRÍTICO:
- ❌ NUNCA pule etapas se o cliente quer comprar
- ❌ NUNCA insista no protocolo se o cliente quer um humano
- ❌ NUNCA finalize sem os 5 dados (produto, data, horário, endereço, pagamento)
- ❌ NÃO use finalize_checkout se faltar dados — continue coletando
- ❌ NÃO use finalize_checkout quando cliente quer apenas falar com humano

Se cliente hesitar ou mudar de ideia: volte ao catálogo naturalmente.
`;
      mcpSystemPrompts += closingProtocolPrompt;
      logger.info("🚀 PROTOCOLO DE FECHAMENTO INJETADO - Coleta iterativa obrigatória");
    }

    const { requiresToolCall, shouldOptimizeModel, model: selectedModel } =
      this.determineToolStrategy(userMessage, wasExplicitMatch, relevantPrompts);

    logger.info(
      `🎯 Estratégia: toolRequired=${requiresToolCall}, optimizeModel=${shouldOptimizeModel}, model=${selectedModel}`,
    );

    const originalModel = this.model;
    this.model = selectedModel;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${mcpSystemPrompts}

---

## 🤝 FILOSOFIA: Tools Como Aliadas, Não Leis

As ferramentas (tools) disponíveis são RECURSOS para garantir precisão, NÃO obrigações.

### QUANDO USAR TOOLS (Use com sabedoria):
✅ **Buscar produtos específicos** - cliente quer ver opções reais
✅ **Validar prazos de entrega** - informação crítica e temporal
✅ **Confirmar preços exatos** - cliente pergunta "quanto custa?"
✅ **Finalizar pedido** - necessário para checkout
✅ **Dados dinâmicos** - algo que pode ter mudado

### QUANDO RESPONDER SEM TOOLS (Mostre humanidade):
💬 **Saudações e pequeno-talk** - "Boa noite!", "E aí, tudo bem?"
💬 **Perguntas gerais** - horários, localização, conceitos
💬 **Conversas humanizadas** - cliente quer conversar, não buscar
💬 **Contexto já fornecido** - cliente já descreveu bem o que quer

### REGRA DE OURO:
**Não sacrifique naturalidade por precisão mecanicista.**
Se o cliente diz "boa noite", responda naturalmente! Você NÃO precisa validar horários.

---

## REGRAS DE EXECUÇÃO

### Execução Silenciosa (Quando Usar Tools)
- **PROIBIDO** anunciar ações: "Vou verificar", "Um momento", "Deixa eu ver"
- Execute tool_calls com content VAZIO
- Cliente vê APENAS a resposta final com dados reais
- Responda APÓS ter os dados

### Certeza Absoluta (Prevenção de Alucinações)
- Dúvida sobre preços/prazos → use ferramenta
- Ferramenta falhar → "Deixa eu confirmar isso com nosso time! 💕"
- NUNCA invente preços, composições, prazos

### Identidade
- Você é **Ana**, assistente virtual da **Cesto D'Amore**
- Carinhosa, empática, prestativa
- Emojis com moderação (💕, 🎁, ✅)
- Conversacional e natural

---

## QUANDO USAR CADA FERRAMENTA

| Situação | Ferramenta | Quando? |
| :--- | :--- | :--- |
| "Quero um cesto" | consultarCatalogo | ✅ Sempre |
| "Quanto é?" | consultarCatalogo | ✅ Sempre (preço real) |
| "Para qual data?" | validate_delivery_availability | ✅ SOMENTE se o cliente mencionar data/horário |
| "Boa noite!" | — | ❌ Responda direto |
| "Qual horário?" | — | ❌ Responda direto |
| "Falar com humano" | notify_human_support | ✅ IMEDIATAMENTE (sem coleta de dados) |
| "Quero comprar!" | finalize_checkout | ✅ Somente com checkout COMPLETO |

### ⚠️ SEPARAÇÃO DE FERRAMENTAS (CRÍTICO):
- **notify_human_support**: Para transferência DIRETA ao humano. NÃO exige dados de checkout. Use quando o cliente pede atendente.
- **finalize_checkout**: Para FINALIZAR compra. EXIGE todos os dados (produto, data, endereço, pagamento). Use no fim do checkout.
- ❌ NUNCA use finalize_checkout quando o cliente só quer falar com humano.
- ❌ NUNCA exija dados de checkout para notify_human_support.

### ⚠️ REGRAS SOBRE ATENDIMENTO HUMANO:
1. **NUNCA tente coletar dados** se o cliente pedir por um atendente.
2. Informe SEMPRE os horários comerciais: Seg-Sex (07:30-12:00 | 14:00-17:00) e Sáb (08:00-11:00).
3. Use notify_human_support (sem checagem de dados). A sessão é bloqueada automaticamente.
4. NUNCA mencione o nome de funcionários específicos. Use "nosso time" ou "nosso atendente".

### ⚠️ REGRAS SOBRE DATAS E HORÁRIOS:
1. **⛔ NUNCA deduza, invente ou assuma uma data/horário** se o cliente não falou EXPLICITAMENTE.
2. Pergunte: "Para qual data você gostaria da entrega?" antes de validar qualquer coisa.
3. Se o cliente disser "para hoje", use a tool com a data atual (${dateInCampina}).
4. Se o cliente disser "para amanhã", use a tool com a data de amanhã (${tomorrowInCampina}).
5. Se a tool retornar suggested_slots → APRESENTE TODOS ao cliente e PERGUNTE qual ele prefere. NÃO escolha por ele.
6. O campo estimated_ready_time na resposta da tool é o tempo de PRODUÇÃO, NÃO é o horário de entrega escolhido pelo cliente.
7. NÃO use validate_delivery_availability antes do cliente informar a data. PERGUNTE PRIMEIRO.

---

## APRESENTAÇÃO DE PRODUTOS

\`\`\`
[URL pura - primeira linha]
_Opção X_ - **Nome** - R$ Valor
Descrição exata (NUNCA inventar itens)
(Produção: X horas)
\`\`\`

Máximo: 2 produtos por vez. Excluir automáticamente se pedir "mais".

---

## CONTEXTO

- 👤 **Cliente:** ${customerName || "?"}
- 📞 **Telefone:** ${phone || "?"}
- 🏪 **Loja:** ${storeStatus}
- 💭 **Memória:** ${memory?.summary || "—"}

- ⏰ **Hora:** ${timeInCampina} (${dateInCampina})
- 📅 **Amanhã:** ${tomorrowInCampina}
- 🛠️ **Tools disponíveis:** ${toolsInMCP.map((t) => t.name).join(", ")}
- 🛒 **Produtos já mostrados:** ${sentProductIds.join(", ") || "Nenhum"}

---

## ANTES DE RESPONDER

1. Cliente quer dados reais ou conversa?
2. Tenho informação confiável?
3. Minha resposta será natural?
4. Preço/prazo = sempre ferramenta?`},
      ...recentHistory.map((msg) => {
        const message: any = {
          role: msg.role,
          content: msg.content,
        };
        if (msg.name) message.name = msg.name;
        if (msg.tool_call_id) message.tool_call_id = msg.tool_call_id;
        if (msg.tool_calls) {
          try {
            message.tool_calls = JSON.parse(msg.tool_calls);
          } catch (e) {
            logger.error(`Error parsing tool_calls for message ${msg.id}:`, e);
          }
        }
        return message;
      }),
    ];

    const hasChosenProduct = Boolean(
      memory?.summary &&
        /cliente (escolheu|demonstrou interesse)/i.test(memory.summary),
    );

    try {
      return this.runTwoPhaseProcessing(
        sessionId,
        messages,
        hasChosenProduct,
        isCartEvent,
        requiresToolCall,
        userMessage,
        memory?.summary || null,
        customerName || "Cliente",
        phone || "",
      );
    } finally {

      this.model = originalModel;
    }
  }

  private async runTwoPhaseProcessing(
    sessionId: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    hasChosenProduct: boolean,
    isCartEvent: boolean,
    requiresToolCall: boolean = false,
    currentUserMessage: string = "",
    memorySummary: string | null = null,
    customerName: string = "Cliente",
    customerPhone: string = "",
  ): Promise<any> {
    const MAX_TOOL_ITERATIONS = 10;
    let currentState = ProcessingState.ANALYZING;
    let toolExecutionResults: ToolExecutionResult[] = [];

    const shouldExcludeProducts = this.shouldExcludeProducts(currentUserMessage);

    const tools = await mcpClientService.listTools();
    const formattedTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    logger.info("🔍 FASE 1: Iniciando coleta de informações...");

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      logger.info(
        `🔄 [Iteração ${iteration + 1}/${MAX_TOOL_ITERATIONS}] Estado: ${currentState}`,
      );

      const useRequiredTool = iteration === 0 && requiresToolCall;
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: formattedTools,
        ...(useRequiredTool ? { tool_choice: "required" as const } : {}),
        stream: false,
      });

      const responseMessage = response.choices[0].message;
      const responseText = (responseMessage.content || "").trim();
      const hasToolCalls =
        responseMessage.tool_calls && responseMessage.tool_calls.length > 0;
      const forbiddenInterruption =
        /(vou (buscar|procurar|verificar|consultar|checar|dar uma|pesquisar)|um moment|aguard[ea]|espera|deixa eu|só um|já volto|ja volto|prosseguimento|atendimento|me chamo ana)/i;

      const hasConcreteData =
        /R\$|https?:\/\/|\d{2,}[,\.]\d{2}|cest[ao]|buqu[êe]|caneca|arranjo|flor(es)?/i.test(
          responseText,
        );

      if (isCartEvent && !hasToolCalls) {
        messages.push({
          role: "system",
          content:
            "Evento de carrinho detectado. Responda APENAS com tool calls para notify_human_support e block_session, com content vazio.",
        });
        continue;
      }

      if (
        !hasToolCalls &&
        (responseText === "" || forbiddenInterruption.test(responseText))
      ) {
        logger.warn(
          `⚠️ Resposta intermediária detectada: forbidden pattern. Reforçando uso de ferramentas.`,
        );
        messages.push({
          role: "system",
          content:
            "PROIBIDO responder com frases de espera. Refaça: OU faça tool calls com content vazio, OU responda com a mensagem final completa.",
        });
        continue;
      }

      if (
        !hasToolCalls &&
        requiresToolCall &&
        responseText.length < 200 &&
        !hasConcreteData
      ) {
        logger.warn(
          `⚠️ Contexto exige dados mas resposta sem conteúdo concreto (len=${responseText.length}). Forçando tool call.`,
        );
        messages.push({
          role: "system",
          content:
            "O cliente fez uma pergunta que EXIGE consulta ao catálogo ou às ferramentas. Sua resposta não contém dados reais. Faça o tool call adequado agora.",
        });
        continue;
      }

      if (hasToolCalls && responseMessage.tool_calls) {
        currentState = ProcessingState.GATHERING_DATA;

        logger.info(
          `🛠️ Executando ${responseMessage.tool_calls.length} ferramenta(s)...`,
        );

        messages.push({
          role: "assistant",
          content: "",
          tool_calls: responseMessage.tool_calls as any,
        });

        await prisma.aIAgentMessage.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: "",
            tool_calls: JSON.stringify(responseMessage.tool_calls),
          },
        });

        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== "function") continue;

          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          logger.info(`🔧 Chamando: ${name}(${JSON.stringify(args)})`);

          if (name === "consultarCatalogo" && args.termo) {
            const termoOriginal = args.termo.toString();
            let termoNormalizado = this.normalizarTermoBusca(termoOriginal);

            if (!args.contexto || args.contexto.toString().trim().split(/\s+/).length < 3) {
              const extraContext = (args.contexto || "") + " " + currentUserMessage;
              args.contexto = extraContext.trim();
              logger.info(`🧠 Enriquecendo contexto da busca: "${args.contexto}"`);
            }

            const wordCount = termoNormalizado.split(/\s+/).filter(Boolean).length;
            const needsReduction =
              termoNormalizado.length > 40 ||
              wordCount > 6 ||
              !this.hasCatalogKeyword(termoNormalizado);

            if (needsReduction) {
              const reduced = this.extractSearchTerm(
                termoNormalizado,
                currentUserMessage,
              );
              if (reduced && reduced !== termoNormalizado) {
                logger.info(
                  `🧭 Termo reduzido: "${termoNormalizado}" → "${reduced}"`,
                );
                termoNormalizado = reduced;
              }
            }

            if (termoOriginal !== termoNormalizado) {
              logger.info(
                `📝 Normalizado: "${termoOriginal}" → "${termoNormalizado}"`,
              );
              args.termo = termoNormalizado;
            }
          }

          if (name === "consultarCatalogo") {
            if (!args.termo || !args.termo.toString().trim()) {
              const errorMsg =
                `{"status":"error","error":"missing_params","message":"Parâmetro ausente: termo. Pergunte: 'Qual tipo de produto ou ocasião você procura?'"}`;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: errorMsg,
              });
              await prisma.aIAgentMessage.create({
                data: {
                  session_id: sessionId,
                  role: "tool",
                  content: errorMsg,
                  tool_call_id: toolCall.id,
                  name: name,
                } as any,
              });
              continue;
            }

            if (args.preco_maximo !== undefined && args.precoMaximo === undefined) {

            }
            if (args.precoMaximo !== undefined) {
              args.preco_maximo = args.precoMaximo;
              delete args.precoMaximo;
            }
            if (args.precoMinimo !== undefined) {
              args.preco_minimo = args.precoMinimo;
              delete args.precoMinimo;
            }

            if (shouldExcludeProducts) {
              try {
                const sessionProducts = await this.getSentProductsInSession(
                  sessionId,
                );
                if (sessionProducts.length > 0) {
                  const existing = args.exclude_product_ids || [];
                  const merged = [...new Set([...existing, ...sessionProducts])];
                  args.exclude_product_ids = merged;
                  logger.info(
                    `📦 Auto-excluindo ${merged.length} produtos ja apresentados`,
                  );
                }
              } catch (e) {
                logger.warn(
                  "⚠️ Erro ao buscar produtos da sessao para exclusao",
                  e,
                );
              }
            }

            const ragContext = [memorySummary, currentUserMessage]
              .filter((text) => {
                if (!text) return false;
                const lower = text.toString().toLowerCase();
                if (lower.includes("[interno]")) return false;
                if (lower.includes("carrinho")) return false;
                if (lower.includes("adicionou produto")) return false;
                if (lower.includes("cart_added")) return false;
                return true;
              })
              .join(" ")
              .trim();
            if (ragContext && !args.contexto) {
              args.contexto = ragContext.slice(0, 600);
            }
          }

          if (name === "calculate_freight") {
            const city = args.city || args.cityName || args.city_name;
            if (!city) {
              const errorMsg = `{"status":"error","error":"missing_params","message":"Parâmetro ausente: cidade. Pergunte: 'Qual é a sua cidade?'"}`;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: errorMsg,
              });
              await prisma.aIAgentMessage.create({
                data: {
                  session_id: sessionId,
                  role: "tool",
                  content: errorMsg,
                  tool_call_id: toolCall.id,
                  name: name,
                } as any,
              });
              continue;
            }
          }

          if (name === "validate_delivery_availability") {
            const dateStr = args.date_str || args.dateStr || args.date;
            if (!dateStr) {
              const errorMsg =
                `{"status":"error","error":"missing_params","message":"Parâmetro ausente: data. Pergunte: 'Para qual data você gostaria da entrega?'"}`;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: errorMsg,
              });
              await prisma.aIAgentMessage.create({
                data: {
                  session_id: sessionId,
                  role: "tool",
                  content: errorMsg,
                  tool_call_id: toolCall.id,
                  name: name,
                } as any,
              });
              continue;
            }
          }

          if (name === "get_adicionais" && !hasChosenProduct) {
            const errorMsg =
              `{"status":"error","error":"missing_product","message":"Adicionais nao podem ser vendidos separados. Antes, confirme qual cesta ou flor o cliente escolheu e o preco. Depois, ofereca adicionais vinculados a esse produto."}`;
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: errorMsg,
            });
            await prisma.aIAgentMessage.create({
              data: {
                session_id: sessionId,
                role: "tool",
                content: errorMsg,
                tool_call_id: toolCall.id,
                name: name,
              } as any,
            });
            continue;
          }

          if (name === "notify_human_support" || name === "finalize_checkout") {
            args.session_id = sessionId;

            const aiName = (args.customer_name || "").toString().trim();
            const aiPhone = (args.customer_phone || "").toString().trim();
            const isGenericName = !aiName || aiName === "Cliente" || aiName === "Desconhecido";
            const isEmptyPhone = !aiPhone;

            if (isGenericName || isEmptyPhone) {
              const sessRec = await prisma.aIAgentSession.findUnique({
                where: { id: sessionId },
              });
              const sessionPhone = sessRec?.customer_phone || "";
              const extractedPhone = sessionId.match(/^session-(\d+)$/)?.[1] || "";
              const resolvedPhone = customerPhone || sessionPhone || extractedPhone;

              if (isEmptyPhone && resolvedPhone) {
                args.customer_phone = resolvedPhone;
              }

              if (isGenericName) {
                let resolvedName = customerName;
                if (!resolvedName || resolvedName === "Cliente") {
                  const phoneForLookup = args.customer_phone || resolvedPhone;
                  if (phoneForLookup) {
                    const cliente = await prisma.customer.findUnique({
                      where: { number: phoneForLookup },
                    });
                    if (cliente?.name) resolvedName = cliente.name;
                  }
                }
                if (resolvedName && resolvedName !== "Cliente") {
                  args.customer_name = resolvedName;
                }
              }
            }
          }

          if (name === "finalize_checkout") {
            const context = (
              args.customer_context ||
              args.customerContext ||
              ""
            ).toString();

            const contextLower = context.toLowerCase();
            const isRetirada = contextLower.includes("retirada") || contextLower.includes("retirar");

            const checks: Record<string, RegExp> = {
              "produto (nome e valor R$)": /(?:cesta|produto|buquê|rosa|chocolate|bar|caneca).+?(?:r\$\s*\d+[\.,]\d{2}|\d+[\.,]\d{2})/i,
              "data de entrega": /entrega:|data:|hoje|amanh[aã]|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}/i,
              "horário da entrega": /(?:às|as|horário:|hora:)\s*\d{1,2}:\d{2}|(?:manhã|tarde|noite)/i,
              "endereço completo": isRetirada
                ? /(?:retirada|loja)/i
                : /(?:rua|avenida|av\.|r\.|endereço|endereco).+?(?:bairro|cidade|cep|complemento)/i,
              "forma de pagamento": /(?:pix|cartão|cartao|crédito|credito|débito|debito)/i,
            };

            const missing: string[] = [];
            for (const [fieldName, pattern] of Object.entries(checks)) {
              if (!pattern.test(context)) {
                missing.push(fieldName);
              }
            }

            if (missing.length > 0) {
              const errorMsg = `{"status":"error","error":"incomplete_checkout","message":"❌ CHECKOUT INCOMPLETO! Faltam dados obrigatórios: ${missing.join(", ")}. \\n\\nColeta obrigatória:\\n1. Produto (nome + preço)\\n2. Data E Horário\\n3. Endereço COMPLETO\\n4. Forma de pagamento (PIX ou Cartão)\\n5. RESUMO FINAL e confirmação do cliente\\n\\nSomente APÓS todos os 5 passos você chama finalize_checkout."}`;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: errorMsg,
              });
              await prisma.aIAgentMessage.create({
                data: {
                  session_id: sessionId,
                  role: "tool",
                  content: errorMsg,
                  tool_call_id: toolCall.id,
                  name: name,
                } as any,
              });
              logger.warn(`⚠️ Checkout incompleto rejeitado. Faltam: ${missing.join(", ")}`);
              continue;
            }

            logger.info(`✅ Checkout validado com todos os dados`);
          }

          if (name === "block_session") {
            args.session_id = sessionId;
          }

          let result: any;
          let success = true;
          try {
            result = await mcpClientService.callTool(name, args);
          } catch (error: any) {
            logger.error(`❌ Erro na tool ${name}: ${error.message}`);
            result = `Erro ao executar ${name}: ${error.message}`;
            success = false;
          }

          let toolOutputText: string;
          if (typeof result === "string") {
            toolOutputText = result;
          } else if (
            result &&
            (result.raw || result.humanized || result.data)
          ) {
            toolOutputText =
              result.raw ||
              result.humanized ||
              JSON.stringify(result.data || result);
          } else {
            toolOutputText = JSON.stringify(result);
          }

          logger.info(
            `✅ Resultado: ${toolOutputText.substring(0, 100)}${toolOutputText.length > 100 ? "..." : ""}`,
          );

          toolExecutionResults.push({
            toolName: name,
            input: args,
            output: toolOutputText,
            success,
          });

          if (name === "consultarCatalogo") {
            try {
              let parsedData =
                typeof result === "object" && result.data
                  ? result.data
                  : result;

              if (typeof parsedData === "string") {
                try {
                  parsedData = JSON.parse(parsedData);
                } catch (e) {
                  const jsonMatch = parsedData.match(
                    /```json\n([\s\S]*?)\n```/,
                  );
                  if (jsonMatch) parsedData = JSON.parse(jsonMatch[1]);
                }
              }

              if (parsedData && typeof parsedData === "object") {
                const allProducts = [
                  ...(parsedData.exatos || []),
                  ...(parsedData.fallback || []),
                ];

                for (const product of allProducts) {
                  if (product.id) {
                    await this.recordProductSent(sessionId, product.id);
                    logger.info(`✅ Rastreado produto ${product.id}`);
                  }
                }
              }

              const curatedOutput = await this.curateProducts(
                toolOutputText,
                currentUserMessage,
                memorySummary,
              );
              if (curatedOutput !== toolOutputText) {
                toolOutputText = curatedOutput;
                const lastResult = toolExecutionResults[toolExecutionResults.length - 1];
                if (lastResult) lastResult.output = curatedOutput;
              }
            } catch (e) {
              logger.debug("Não foi possível processar produtos", e);
            }
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutputText,
          });

          await prisma.aIAgentMessage.create({
            data: {
              session_id: sessionId,
              role: "tool",
              content: toolOutputText,
              tool_call_id: toolCall.id,
              name: name,
            } as any,
          });

          if (name === "notify_human_support" || name === "finalize_checkout") {
            try {
              let customerPhone = (
                args.customer_phone ||
                args.customerPhone ||
                ""
              ).toString();
              if (!customerPhone) {
                const sessRec = await prisma.aIAgentSession.findUnique({
                  where: { id: sessionId },
                });
                customerPhone = sessRec?.customer_phone || "";
              }
              if (customerPhone) {
                await mcpClientService.callTool("save_customer_summary", {
                  customer_phone: customerPhone,
                  summary: args.customer_context || toolOutputText,
                });
                logger.info(`💾 Memória salva para ${customerPhone}`);
              }
            } catch (e) {
              logger.error("❌ Falha ao salvar memória", e);
            }
          }
        }

        continue;
      }

      logger.info(
        "✅ FASE 1 Concluída: Todas as informações necessárias foram coletadas",
      );
      currentState = ProcessingState.READY_TO_RESPOND;
      break;
    }

    if (currentState !== ProcessingState.READY_TO_RESPOND) {
      logger.warn("⚠️ Limite de iterações atingido, forçando resposta");
    }

    if (!isCartEvent) {
      const recentUserText = messages
        .filter((msg) => msg.role === "user")
        .map((msg) => (typeof msg.content === "string" ? msg.content : ""))
        .join(" ");
      const finalizationIntent = /quero essa|quero esse|vou levar|pode finalizar|finaliza|finalizar|fechar pedido|concluir pedido|como compro|como pago|pagamento/i.test(
        currentUserMessage.toLowerCase(),
      );
      const sourceText = `${memorySummary || ""} ${recentUserText}`.trim();
      const { context: checkoutContext, hasAll } = this.buildCheckoutContext(
        sourceText,
      );

      if (finalizationIntent && hasAll) {
        const hasFinalize = toolExecutionResults.some(
          (result) => result.toolName === "finalize_checkout",
        );

        if (!hasFinalize) {
          try {
            await mcpClientService.callTool("finalize_checkout", {
              customer_context: checkoutContext,
              customer_name: customerName,
              customer_phone: customerPhone,
              session_id: sessionId,
            });
            toolExecutionResults.push({
              toolName: "finalize_checkout",
              input: { reason: "end_of_checkout" },
              output: "forced_checkout_finalize",
              success: true,
            });
          } catch (error: any) {
            logger.error(
              `❌ Falha ao finalizar checkout: ${error.message || error}`,
            );
          }
        }
      }
    }

    if (isCartEvent) {
      const hasNotify = toolExecutionResults.some(
        (result) => result.toolName === "notify_human_support",
      );

      if (!hasNotify) {
        try {
          const session = await prisma.aIAgentSession.findUnique({
            where: { id: sessionId },
            select: { customer_phone: true },
          });
          const customerName = "Cliente";
          const customerPhone = session?.customer_phone || "";
          const customerContext =
            "Cliente adicionou produto ao carrinho. Encaminhar para atendimento especializado.";

          await mcpClientService.callTool("notify_human_support", {
            reason: "cart_added",
            customer_context: customerContext,
            customer_name: customerName,
            customer_phone: customerPhone,
            session_id: sessionId,
          });
          toolExecutionResults.push({
            toolName: "notify_human_support",
            input: { reason: "cart_added" },
            output: "forced_cart_notify",
            success: true,
          });
        } catch (error: any) {
          logger.error(
            `❌ Falha ao forcar notify para cart event: ${error.message}`,
          );
        }
      }
    }

    logger.info("📝 FASE 2: Gerando resposta organizada para o cliente...");

    if (toolExecutionResults.length > 0) {
      messages.push({
        role: "system",
        content: this.getSynthesisPrompt(toolExecutionResults),
      });
    }

    return this.openai.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
    });
  }

  async saveResponse(sessionId: string, content: string) {

    const session = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
      select: { customer_phone: true, remote_jid_alt: true },
    });

    if (session?.customer_phone) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { number: session.customer_phone },
      });

      if (!existingCustomer) {

        await prisma.customer.create({
          data: {
            number: session.customer_phone,
            remote_jid_alt: session.remote_jid_alt,
          },
        });
        logger.info(
          `✨ [Customer] Novo cliente criado: ${session.customer_phone}`,
        );
      } else if (session.remote_jid_alt && !existingCustomer.remote_jid_alt) {

        await prisma.customer.update({
          where: { number: session.customer_phone },
          data: { remote_jid_alt: session.remote_jid_alt },
        });
      }
    }

    await prisma.aIAgentMessage.create({
      data: {
        session_id: sessionId,
        role: "assistant",
        content,
      },
    });
  }
}

export default new AIAgentService();
