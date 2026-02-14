import OpenAI from "openai";
import prisma from "../database/prisma";
import mcpClientService from "./mcpClientService";
import logger from "../utils/logger";
import { addDays, isPast, format } from "date-fns";

// Estados internos do processamento em duas fases
enum ProcessingState {
  ANALYZING = "ANALYZING",
  GATHERING_DATA = "GATHERING_DATA",
  SYNTHESIZING = "SYNTHESIZING",
  READY_TO_RESPOND = "READY_TO_RESPOND",
}

// Estados do fluxo de fechamento de compra
enum CheckoutState {
  PRODUCT_SELECTED = "PRODUCT_SELECTED", // Produto confirmado com preço
  WAITING_DATE = "WAITING_DATE", // Aguardando data/horário
  WAITING_ADDRESS = "WAITING_ADDRESS", // Aguardando endereço
  WAITING_PAYMENT = "WAITING_PAYMENT", // Aguardando forma de pagamento
  READY_TO_FINALIZE = "READY_TO_FINALIZE", // Todos os dados coletados, aguardando confirmação final
}

interface CheckoutData {
  productName: string;
  productPrice: number;
  deliveryDate: string;
  deliveryTime: string;
  deliveryType: "delivery" | "retirada"; // tipo de entrega
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
  private advancedModel: string = "gpt-4-turbo"; // Para raciocínio aprimorado

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Determina a estratégia de uso de tools e modelo adaptativo
   * Retorna: { requiresToolCall, shouldOptimizeModel, model }
   */
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

    // ═══════════════════════════════════════════════════════════════
    // HARD REQUIREMENTS: Forçar tool_choice em casos críticos
    // ═══════════════════════════════════════════════════════════════
    const hardRequirements = {
      cartEvent: /\[interno\].*carrinho|evento\s*=\s*cart_added|cart_added|adicionou.*carrinho/i.test(
        userMessage,
      ),
      finalCheckout: /finaliza|confirma|fecha pedido|vou levar|como compro|como pago/i.test(
        messageLower,
      ),
    };

    // Se é um evento crítico, SEMPRE força tool
    if (hardRequirements.cartEvent || hardRequirements.finalCheckout) {
      return {
        requiresToolCall: true,
        shouldOptimizeModel: false,
        model: this.model,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // SOFT REQUIREMENTS: Apenas sugira tool se necessário
    // ═══════════════════════════════════════════════════════════════

    // Mensagens muito curtas/simples → conversação humanizada
    if (messageLength <= 30 && !wasExplicitMatch) {
      return {
        requiresToolCall: false,
        shouldOptimizeModel: false,
        model: this.model,
      };
    }

    // Se não houve match explícito → deixa LLM decidir
    if (!wasExplicitMatch) {
      return {
        requiresToolCall: false,
        shouldOptimizeModel: false,
        model: this.model,
      };
    }

    // Scoring para determinar necessidade de tool
    let toolNecessityScore = 0;

    // Contextos que realmente exigem busca de dados
    const criticalPrompts = [
      "product_selection_guideline", // Busca de produtos
      "faq_production_guideline", // Prazos de produção
    ];

    const optionalPrompts = [
      "indecision_guideline", // Pode ser respondido sem dados
      "delivery_rules_guideline", // Pode ser respondido com conhecimento geral
      "location_guideline", // Info geral da loja
    ];

    const hasCriticalPrompt = relevantPrompts.some((p) =>
      criticalPrompts.includes(p),
    );
    const hasOptionalPrompt = relevantPrompts.some((p) =>
      optionalPrompts.includes(p),
    );

    if (hasCriticalPrompt) {
      toolNecessityScore += 100; // Crítico
    }
    if (hasOptionalPrompt) {
      toolNecessityScore += 30; // Opcional
    }

    // Padrões que indicam busca real de produto
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

    // Contexto genérico → pode ser respondido sem tool
    const genericPatterns = [
      /mais opçõ|outro|diferente|parecido|similar/i, // "Quero algo parecido"
      /como é|me explica|qual é|o que é/i, // Perguntas gerais
    ];

    const isGenericQuestion = genericPatterns.some((p) =>
      p.test(messageLower),
    );
    if (isGenericQuestion) {
      toolNecessityScore -= 20;
    }

    // Decision logic
    const requiresToolCall = toolNecessityScore > 60;

    // ═══════════════════════════════════════════════════════════════
    // ADAPTIVE MODEL SELECTION
    // ═══════════════════════════════════════════════════════════════

    // Use advanced model se:
    // 1. Mensagem é complexa (composição, lógica, raciocínio)
    // 2. Requer multiple tools em sequência
    // 3. Cliente faz pergunta com condições múltiplas
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
      { pattern: /\?.*\?.*\?/i, weight: 25 }, // Múltiplas perguntas
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

  /**
   * RAG Dinâmico: Detecta contexto da mensagem e retorna prompts relevantes
   * Carrega até 5 prompts dinâmicos + core para cobrir cenários compostos
   * Returns { prompts, wasExplicitMatch } — wasExplicitMatch=false means fallback only
   */
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

    // Mapa de detecção: contexto → prompt relevante
    const contextMap = [
      {
        patterns: [
          /\[interno\].*carrinho/i,
          /evento\s*=\s*cart_added/i,
          /cart_added/i,
          /adicionou.*carrinho/i,
        ],
        prompt: "cart_protocol_guideline",
        priority: 0, // Prioridade máxima (protocolo obrigatório)
      },
      {
        patterns: [
          /catálogo|catalogo|cardápio|cardapio|menu|opções e valores|opcoes e valores|lista de preços|lista de precos|quais produtos|o que vocês têm|o que voces tem|todos os produtos|tudo que tem/i,
        ],
        prompt: "indecision_guideline",
        priority: 1, // Alta prioridade para catálogo
      },
      {
        patterns: [
          /entrega|João pessoa|Queimadas|Galante|Puxinanã|São José|cobertura|cidad|faz entrega|onde fica|localiza/i,
        ],
        prompt: "delivery_rules_guideline",
        priority: 1, // Alta prioridade
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
        priority: 1, // Alta prioridade para perguntas sobre valores
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
    ];

    // Encontra prompts relevantes
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
      .sort((a, b) => a.priority - b.priority) // Prioridade (0 > 1 > 2)
      .slice(0, 5) // Máximo 5 prompts dinâmicos
      .map((ctx) => ctx.prompt);

    // Remove duplicatas mantendo ordem
    const uniquePrompts = [...new Set(matched)];
    const wasExplicitMatch = uniquePrompts.length > 0;

    // Sempre inclui product_selection como fallback padrão (cenário mais comum)
    if (uniquePrompts.length === 0) {
      uniquePrompts.push("product_selection_guideline");
    }

    // Sempre retorna core_identity primeiro, depois os dinâmicos
    return {
      prompts: ["core_identity_guideline", ...uniquePrompts],
      wasExplicitMatch,
    };
  }

  /**
   * Prompt específico para a fase de síntese
   */
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
      { pattern: /quadro/, term: "quadro" },
      { pattern: /bar|bebida/, term: "bar" },
      { pattern: /chocolate/, term: "chocolate" },
      { pattern: /cafe|caf[eé]/, term: "café" },
      { pattern: /anivers[aá]rio/, term: "aniversário" },
      { pattern: /namorad[oa]s?/, term: "namorados" },
      { pattern: /rom[aâ]ntic[ao]/, term: "romântica" },
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

  /**
   * Gera um prompt específico para forçar coleta iterativa de dados do checkout
   */
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

Depois diga: "Perfeito! Já passei todos os detalhes para o nosso time humano. Como agora eles vão cuidar do seu pagamento e personalização, eu vou me retirar para não atrapalhar, tá ok? Logo eles te respondem! Obrigadaaa ❤️🥰"`;

      default:
        return "";
    }
  }

  /**
   * Extrai e valida dados do checkout a partir do histórico de mensagens
   */
  private async extractCheckoutData(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], sessionId: string): Promise<Partial<CheckoutData>> {
    const data: Partial<CheckoutData> = {};

    // Procura por produto confirmado nas últimas messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "tool") continue;

      const content = typeof msg.content === "string" ? msg.content : "";

      // Busca dados de consultarCatalogo (produto + preço)
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

      // Busca dados de validate_delivery_availability (data + horário)
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

    // Busca no histórico de mensagens do usuário
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "user") continue;

      const content = typeof msg.content === "string" ? msg.content : "";
      const contentLower = content.toLowerCase();

      // Busca endereço
      if (!data.address) {
        const addressMatch = content.match(/(?:rua|avenida|av\.|r\.)\s+[^,\n]+,?\s*\d+[^,\n]*,?\s*[^,\n]+,?\s*[^,\n]+/i);
        if (addressMatch) {
          data.address = addressMatch[0];
        }
      }

      // Busca pagamento
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

  /**
   * Determina o próximo estado do checkout baseado nos dados coletados
   */
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

  /**
   * Formata contexto de checkout de forma bem estruturada para a equipe humana
   */
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

      // Count user messages (not tool or system)
      if (msg.role === "user") {
        userMessageCount++;
        if (userMessageCount >= MAX_USER_MESSAGES) {
          break;
        }
      }
    }

    // Now validate that tool messages have their preceding assistant message with tool_calls
    const validated: any[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];

      if (msg.role === "tool") {
        // Look backwards for the assistant message with matching tool_call_id
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
              // Continue if parsing fails
            }
          }
        }

        // Only include tool message if its assistant message is also in the filtered list
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

    // Handle expired sessions
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

    // If session doesn't exist, create or find one
    if (!session) {
      // 🔐 Strategy for phone matching:
      // 1. Extract phone from sessionId format: session-{{ numero_do_cliente }}
      // 2. If customerPhone is provided → validate against extracted phone or use it
      // 3. If remoteJidAlt is provided → try to find a session with this remote_jid_alt
      // 4. Use extracted phone as fallback

      // Extract phone from sessionId (format: session-<phone>)
      const extractedPhoneMatch = sessionId.match(/^session-(\d+)$/);
      const extractedPhone = extractedPhoneMatch
        ? extractedPhoneMatch[1]
        : null;

      let identifyingPhone: string | null =
        customerPhone || extractedPhone || null;
      let identifyingRemoteJid: string | null = remoteJidAlt || null;

      // Log the resolution strategy
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

      // If we have remoteJidAlt but no customerPhone, try to find an existing session
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

      // 🔧 Create new session - use identified phone
      session = await prisma.aIAgentSession.create({
        data: {
          id: sessionId,
          customer_phone: identifyingPhone,
          remote_jid_alt: identifyingRemoteJid,
          expires_at: addDays(new Date(), 5), // Default 5 days expiration
        },
        include: {
          messages: true,
        },
      });

      logger.info(
        `✨ [AIAgent] Nova sessão criada: ${sessionId} (phone: ${identifyingPhone || "null"}, remoteJid: ${identifyingRemoteJid || "null"})`,
      );
    } else if (customerPhone || remoteJidAlt) {
      // Update existing session with new phone/remoteJid info
      // This handles the case where remoteJidAlt unlocks the actual customerPhone
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

    // Buscar dados do customer para cada sessão (query manual sem foreign key)
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

    // Ordenar pela última mensagem (ou created_at se não houver mensagens)
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

    // ⛔ PROTEÇÃO CRÍTICA: Bloquear perguntas sobre informações sensíveis
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

      // Salvar resposta segura
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

      // Retornar stream simulado
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
        await mcpClientService.callTool("notify_human_support", {
          reason: "cart_added",
          customer_context:
            "Cliente adicionou produto ao carrinho. Encaminhar para atendimento especializado.",
          customer_name: resolvedName,
          customer_phone: resolvedPhone,
          should_block_flow: true,
          session_id: sessionId,
        });
        await mcpClientService.callTool("block_session", {
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

    // Update customer's last_message_sent when they send a message via IA
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

    // Check if session is blocked (transfered to human)
    if (session.is_blocked) {
      // If blocked, we return a fake stream that says nothing or a specific message
      // But usually we just want to stop the AI from responding.
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

    // Cálculo auxiliar de status para evitar alucinação da IA
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

    // ── RAG DINÂMICO: SELEÇÃO INTELIGENTE DE PROMPTS ─────────────────────────────
    // 1. Detecta contexto da mensagem do usuário
    const { prompts: relevantPrompts, wasExplicitMatch } = this.detectContextualPrompts(userMessage);
    logger.info(`📚 RAG: Carregando ${relevantPrompts.length} prompts (match=${wasExplicitMatch}): ${relevantPrompts.join(', ')}`);

    // 2. Busca lista de tools (sempre necessário)
    const toolsInMCP = await mcpClientService.listTools();

    // 3. Busca prompts selecionados em paralelo (core + até 5 dinâmicos)
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

    // ⚡ INJETA PROTOCOLO DE FECHAMENTO OBRIGATÓRIO se cliente quer finalizar
    const finalizationIntent = /quero essa|quero esse|vou levar|pode finalizar|finaliza|finalizar|fechar pedido|concluir pedido|como compro|como pago|pagamento|vou confirmar/i.test(
      userMessage.toLowerCase(),
    );

    if (finalizationIntent) {
      const closingProtocolPrompt = `

--- 🚀 PROTOCOLO OBRIGATÓRIO: FECHAMENTO DE COMPRA ---

⚠️ CLIENTE QUER FINALIZAR! Você DEVE seguir EXATAMENTE estas 5 etapas:

**ETAPA 1: Confirme o Produto**
- Nome exato da cesta/flor
- Preço EXATO (ex: R$ 150,00)
- Se cliente não mencionou, use consultarCatalogo

**ETAPA 2: Colete Data e Horário (OBRIGATÓRIO)**
- Pergunte: "Para qual data você gostaria da entrega?"
- Cliente responde
- Use validate_delivery_availability(date_str, time_str)
- Apresente TODOS os horários disponíveis
- Cliente escolhe
- ✅ CONFIRME ambos

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
- Chame: notify_human_support(reason="end_of_checkout", customer_context="[resumo completo]")
- Chame: block_session()
- Diga: "Perfeito! Já passei para o time humano. Logo eles te respondem! Obrigadaaa ❤️🥰"

⚠️ CRÍTICO:
- ❌ NUNCA pule etapas
- ❌ NUNCA finalize sem os 5 dados (produto, data, horário, endereço, pagamento)
- ❌ NÃO notifique equipe se faltar algo
- ✅ Valide TODAS as informações antes de notificar

Se cliente hesitar ou mudar de ideia: volte ao catálogo naturalmente.
`;
      mcpSystemPrompts += closingProtocolPrompt;
      logger.info("🚀 PROTOCOLO DE FECHAMENTO INJETADO - Coleta iterativa obrigatória");
    }
    // ──────────────────────────────────────────────────────────────────────────────

    // 🧠 NOVA LÓGICA: Estratégia adaptativa de tools + modelo
    const { requiresToolCall, shouldOptimizeModel, model: selectedModel } =
      this.determineToolStrategy(userMessage, wasExplicitMatch, relevantPrompts);

    logger.info(
      `🎯 Estratégia: toolRequired=${requiresToolCall}, optimizeModel=${shouldOptimizeModel}, model=${selectedModel}`,
    );

    // Atualiza modelo temporário para esta requisição
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
| "Para qual data?" | validate_delivery_availability | ✅ Se produto definido |
| "Boa noite!" | — | ❌ Responda direto |
| "Qual horário?" | — | ❌ Responda direto |
| "Quero comprar!" | notify_human_support | ✅ Checkout completo |

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
      // Restaura modelo original após processamento
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

    // Fetch fresh tools from MCP
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
      // Heuristic: response has no concrete data (no prices, URLs, product names, numbers)
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

      // Bloqueia respostas vazias ou com frases de espera ("vou buscar", etc.)
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

      // Heurística extra: se o contexto EXIGE dados (requiresToolCall) mas a resposta é curta e sem dados reais
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

      // Se há tool_calls, executa e continua coletando
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

        // Salva no banco
        await prisma.aIAgentMessage.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: "",
            tool_calls: JSON.stringify(responseMessage.tool_calls),
          },
        });

        // Executa cada tool
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== "function") continue;

          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          logger.info(`🔧 Chamando: ${name}(${JSON.stringify(args)})`);

          // Normaliza termos de busca
          if (name === "consultarCatalogo" && args.termo) {
            const termoOriginal = args.termo.toString();
            let termoNormalizado = this.normalizarTermoBusca(termoOriginal);
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
              // Already correct snake_case — keep as-is
            }
            if (args.precoMaximo !== undefined) {
              args.preco_maximo = args.precoMaximo;
              delete args.precoMaximo;
            }
            if (args.precoMinimo !== undefined) {
              args.preco_minimo = args.precoMinimo;
              delete args.precoMinimo;
            }

            // Auto-inject exclude_product_ids apenas quando o cliente pede mais opcoes
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

          // Valida calculate_freight
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

          // Valida get_adicionais (somente apos produto escolhido)
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

          // Valida notify_human_support - VALIDAÇÃO RIGOROSA
          if (name === "notify_human_support") {
            const reason = (args.reason || "").toString().toLowerCase();
            const isFinalization =
              /finaliza|finaliza[cç][aã]o|pedido|finalizar|end_of_checkout|carrinho/i.test(
                reason,
              );
            const context = (
              args.customer_context ||
              args.customerContext ||
              ""
            )
              .toString();

            if (isFinalization) {
              // VALIDAÇÃO OBRIGATÓRIA para checkout - precisa de TODOS os dados estruturados
              const contextLower = context.toLowerCase();
              const isRetirada = contextLower.includes("retirada") || contextLower.includes("retirar");
              
              // Checklist rigoroso: TODOS devem estar presentes
              const checks = {
                "produto (nome e valor R$)": /(?:cesta|produto|buquê|rosa|chocolate|bar|caneca).+?(?:r\$\s*\d+[\.,]\d{2}|\d+[\.,]\d{2})/i,
                "data de entrega": /entrega:|data:|hoje|amanh[aã]|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}/i,
                "horário da entrega": /(?:às|as|horário:|hora:)\s*\d{1,2}:\d{2}|(?:manhã|tarde|noite)/i,
                "endereço completo": isRetirada 
                  ? /(?:retirada|loja)/i 
                  : /(?:rua|avenida|av\.|r\.|endereço|endereco).+?(?:bairro|cidade|cep|complemento)/i,
                "forma de pagamento": /(?:pix|cartão|cartao|crédito|credito|débito|debito)/i,
              };

              const missing = [];
              for (const [fieldName, pattern] of Object.entries(checks)) {
                if (!pattern.test(context)) {
                  missing.push(fieldName);
                }
              }

              // Se faltar algum dado, REJEITA a tentativa
              if (missing.length > 0) {
                const errorMsg = `{"status":"error","error":"incomplete_checkout","message":"❌ CHECKOUT INCOMPLETO! Faltam dados obrigatórios: ${missing.join(", ")}. \\n\\nVocê DEVE coletar na sequência:\\n1. Produto (nome + preço)\\n2. Data E Horário (valide com validate_delivery_availability)\\n3. Endereço COMPLETO (rua, número, bairro, cidade)\\n4. Forma de pagamento (PIX ou Cartão)\\n5. RESUMO FINAL e confirmação do cliente\\n\\nSomente APÓS todos os 5 passos você chama notify_human_support."}`;
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

              // Se passou na validação, estrutura melhor a mensagem
              logger.info(`✅ Checkout validado com todos os dados`);
              
              // Formata a mensagem de contexto com estrutura clara
              const structuredContext = `
=== RESUMO DO PEDIDO ===
${context}
=====================
`.trim();
              args.customer_context = structuredContext;
            }
            args.session_id = sessionId;
          }

          if (name === "block_session") {
            args.session_id = sessionId;
          }

          // Executa a tool
          let result: any;
          let success = true;
          try {
            result = await mcpClientService.callTool(name, args);
          } catch (error: any) {
            logger.error(`❌ Erro na tool ${name}: ${error.message}`);
            result = `Erro ao executar ${name}: ${error.message}`;
            success = false;
          }

          // Normaliza resultado
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

          // Registra execução
          toolExecutionResults.push({
            toolName: name,
            input: args,
            output: toolOutputText,
            success,
          });

          // Rastreia produtos enviados para exclusão em buscas futuras (paginação)
          if (name === "consultarCatalogo") {
            try {
              // Extract the structured data correctly from MCP result
              let parsedData =
                typeof result === "object" && result.data
                  ? result.data
                  : result;

              // If it's still a string (common for non-markdown tool responses), parse it
              if (typeof parsedData === "string") {
                try {
                  parsedData = JSON.parse(parsedData);
                } catch (e) {
                  // Fallback: try to find JSON block in markdown
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

                // ✅ TRACK ALL returned products to enable proper pagination (exclusion flow)
                // The AI is told in system prompt to show only 2, but we track all 10 so the next tool call
                // will return the NEXT batch of products if the user continues asking.
                for (const product of allProducts) {
                  if (product.id) {
                    await this.recordProductSent(sessionId, product.id);
                    logger.info(`✅ Rastreado produto ${product.id}`);
                  }
                }
              }
            } catch (e) {
              logger.debug("Não foi possível extrair IDs de produtos", e);
            }
          }

          // Adiciona resultado ao contexto
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutputText,
          });

          // Salva no banco
          await prisma.aIAgentMessage.create({
            data: {
              session_id: sessionId,
              role: "tool",
              content: toolOutputText,
              tool_call_id: toolCall.id,
              name: name,
            } as any,
          });

          // Salva memória após notify_human_support
          if (name === "notify_human_support") {
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

        // Continua o loop para processar os resultados
        continue;
      }

      // Se NÃO há tool_calls, significa que a LLM decidiu que tem informações suficientes
      logger.info(
        "✅ FASE 1 Concluída: Todas as informações necessárias foram coletadas",
      );
      currentState = ProcessingState.READY_TO_RESPOND;
      break;
    }

    // ═══════════════════════════════════════════════════════════════
    // FASE 2: SÍNTESE E RESPOSTA AO CLIENTE (COM STREAM)
    // ═══════════════════════════════════════════════════════════════

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
        const hasNotify = toolExecutionResults.some(
          (result) => result.toolName === "notify_human_support",
        );
        const hasBlock = toolExecutionResults.some(
          (result) => result.toolName === "block_session",
        );

        if (!hasNotify) {
          try {
            await mcpClientService.callTool("notify_human_support", {
              reason: "end_of_checkout",
              customer_context: checkoutContext,
              customer_name: customerName,
              customer_phone: customerPhone,
              should_block_flow: true,
              session_id: sessionId,
            });
            toolExecutionResults.push({
              toolName: "notify_human_support",
              input: { reason: "end_of_checkout" },
              output: "forced_checkout_notify",
              success: true,
            });
          } catch (error: any) {
            logger.error(
              `❌ Falha ao notificar checkout: ${error.message || error}`,
            );
          }
        }

        if (!hasBlock) {
          try {
            await mcpClientService.callTool("block_session", {
              session_id: sessionId,
            });
            toolExecutionResults.push({
              toolName: "block_session",
              input: { session_id: sessionId },
              output: "forced_checkout_block",
              success: true,
            });
          } catch (error: any) {
            logger.error(
              `❌ Falha ao bloquear checkout: ${error.message || error}`,
            );
          }
        }
      }
    }

    if (isCartEvent) {
      const hasNotify = toolExecutionResults.some(
        (result) => result.toolName === "notify_human_support",
      );
      const hasBlock = toolExecutionResults.some(
        (result) => result.toolName === "block_session",
      );

      if (!hasNotify || !hasBlock) {
        try {
          const session = await prisma.aIAgentSession.findUnique({
            where: { id: sessionId },
            select: { customer_phone: true },
          });
          const customerName = "Cliente";
          const customerPhone = session?.customer_phone || "";
          const customerContext =
            "Cliente adicionou produto ao carrinho. Encaminhar para atendimento especializado.";

          if (!hasNotify) {
            await mcpClientService.callTool("notify_human_support", {
              reason: "cart_added",
              customer_context: customerContext,
              customer_name: customerName,
              customer_phone: customerPhone,
              should_block_flow: true,
              session_id: sessionId,
            });
            toolExecutionResults.push({
              toolName: "notify_human_support",
              input: { reason: "cart_added" },
              output: "forced_cart_notify",
              success: true,
            });
          }

          if (!hasBlock) {
            await mcpClientService.callTool("block_session", {
              session_id: sessionId,
            });
            toolExecutionResults.push({
              toolName: "block_session",
              input: { session_id: sessionId },
              output: "forced_cart_block",
              success: true,
            });
          }
        } catch (error: any) {
          logger.error(
            `❌ Falha ao forcar notify/block para cart event: ${error.message}`,
          );
        }
      }
    }

    logger.info("📝 FASE 2: Gerando resposta organizada para o cliente...");

    // Adiciona prompt de síntese se houveram tools executadas
    if (toolExecutionResults.length > 0) {
      messages.push({
        role: "system",
        content: this.getSynthesisPrompt(toolExecutionResults),
      });
    }

    // Retorna stream da resposta final
    return this.openai.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
    });
  }

  // Helper to collect final response and save it to DB
  async saveResponse(sessionId: string, content: string) {
    // Get session to check if we have phone info to sync
    const session = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
      select: { customer_phone: true, remote_jid_alt: true },
    });

    // 🔄 Auto-sync customer record if phone is now available
    if (session?.customer_phone) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { number: session.customer_phone },
      });

      if (!existingCustomer) {
        // Create new customer record
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
        // Update customer with remote_jid_alt if we have it
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
