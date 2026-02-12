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

interface ToolExecutionResult {
  toolName: string;
  input: any;
  output: string;
  success: boolean;
}

class AIAgentService {
  private openai: OpenAI;
  private model: string = "gpt-4o-mini";

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * RAG Dinâmico: Detecta contexto da mensagem e retorna prompts relevantes
   * Carrega até 5 prompts dinâmicos + core para cobrir cenários compostos
   * Returns { prompts, wasExplicitMatch } — wasExplicitMatch=false means fallback only
   */
  private detectContextualPrompts(userMessage: string): { prompts: string[]; wasExplicitMatch: boolean } {
    const messageLower = userMessage.toLowerCase();

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
    // ──────────────────────────────────────────────────────────────────────────────

    // Determina se a mensagem exige uso obrigatório de tool na primeira iteração
    // SOMENTE quando houve match explícito — fallback NÃO força tool_choice
    const requiresToolCall = wasExplicitMatch && relevantPrompts.some((p) =>
      [
        "product_selection_guideline",
        "indecision_guideline",
        "delivery_rules_guideline",
        "faq_production_guideline",
      ].includes(p),
    );

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${mcpSystemPrompts}

---

## REGRAS DE EXECUÇÃO (OBRIGATÓRIAS)

### Execução Silenciosa
- **PROIBIDO** anunciar ações: "Vou verificar", "Um momento", "Deixa eu ver", "Um momentinho". Execute tool_calls diretamente com content VAZIO.
- O cliente vê APENAS a resposta final com dados reais. NUNCA gere mensagens intermediárias sem informação concreta.
- Se for usar uma ferramenta, sua mensagem DEVE conter APENAS o tool_call (texto vazio). Responda ao cliente somente APÓS ter os dados.

### Certeza Absoluta
- Sem 100% de certeza → use ferramenta obrigatoriamente.
- Sem ferramenta disponível → "Deixa eu confirmar isso com nosso time! 💕"
- NUNCA invente preços, composições, prazos ou horários.

### Identidade
- Você é **Ana**, assistente virtual da **Cesto D'Amore**.
- Tom: carinhoso, empático, prestativo. Emojis com moderação (💕, 🎁, ✅).

---

## MAPEAMENTO DE FERRAMENTAS (Execução Imediata)

| Intenção do Cliente | Ferramenta | Observação |
| :--- | :--- | :--- |
| Buscar produto / cesta | \`consultarCatalogo\` | Use \`preco_minimo\`/\`preco_maximo\` para filtros de valor |
| Catálogo / todas opções | \`get_full_catalog\` | Só se pedir explicitamente |
| Disponibilidade de entrega | \`validate_delivery_availability\` | Passe \`production_time_hours\` se souber o produto |
| Endereço → frete | \`calculate_freight\` | Apenas após confirmar método de pagamento |
| Composição / detalhes | \`get_product_details\` | Obrigatório antes de descrever componentes |
| Salvar progresso | \`save_customer_summary\` | Após cada informação importante do cliente |

---

## FORMATO DE APRESENTAÇÃO DE PRODUTOS (OBRIGATÓRIO)

\`\`\`
URL_DA_IMAGEM (sem markdown, URL pura na primeira linha)
_Opção X_ - **Nome do Produto** - R$ Valor_Exato
[Descrição EXATA da ferramenta — NÃO invente itens]
(Produção: X horas comerciais)
\`\`\`

- Apresente **2 produtos por vez** (menor ranking = melhor).
- Se cliente pedir "mais opções", os produtos anteriores já são automaticamente excluídos da próxima busca.
- NUNCA use \`![img](url)\` — URL pura apenas.
- NUNCA invente composição. Só descreva o que a ferramenta retornou.

---

## VALIDAÇÃO DE ENTREGA

- **NUNCA calcule prazos mentalmente.** Sempre use \`validate_delivery_availability\` passando \`production_time_hours\` do produto.
- Se o cliente não informou a data, pergunte: "Para qual data você gostaria da entrega?"
- Apresente TODOS os \`suggested_slots\` retornados pela ferramenta.

---

## ADICIONAIS
- ❌ NUNCA venda adicionais separadamente.
- ✅ Só ofereça adicionais APÓS o cliente ESCOLHER uma cesta/flor.
- ✅ Use \`get_adicionais\` apenas com produto confirmado.

---

## CONTEXTO DA SESSÃO

- 👤 **Cliente:** ${customerName || "Não identificado"}
- 📞 **Telefone:** ${phone || "Não informado"}
- ⏰ **Agora (Campina Grande):** ${timeInCampina}
- 📅 **Data atual:** ${dateInCampina}
- 📆 **Amanhã:** ${tomorrowInCampina}
- 🏪 **Status da loja:** ${storeStatus}
- 💭 **Memória do cliente:** ${memory?.summary || "Sem histórico"}
- 📦 **Produtos já apresentados (IDs):** ${sentProductIds.length > 0 ? sentProductIds.join(", ") : "Nenhum"}

---

## CHECKLIST ANTES DE RESPONDER

1. Tenho certeza da informação? Se não → ferramenta.
2. Preço exato da ferramenta? Nunca inventar.
3. Descrição fiel ao JSON? Nunca adicionar itens.
4. Prazo via \`validate_delivery_availability\` com \`production_time_hours\`?
5. Formato de apresentação correto?`},
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

    return this.runTwoPhaseProcessing(
      sessionId,
      messages,
      hasChosenProduct,
      isCartEvent,
      requiresToolCall,
      userMessage,
    );
  }

  private async runTwoPhaseProcessing(
    sessionId: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    hasChosenProduct: boolean,
    isCartEvent: boolean,
    requiresToolCall: boolean = false,
    currentUserMessage: string = "",
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

          // Valida notify_human_support
          if (name === "notify_human_support") {
            const reason = (args.reason || "").toString();
            const isFinalization =
              /finaliza|finaliza[cç][aã]o|pedido|finalizar|end_of_checkout|carrinho/i.test(
                reason,
              );
            const context = (
              args.customer_context ||
              args.customerContext ||
              ""
            )
              .toString()
              .toLowerCase();

            if (isFinalization) {
              const isRetirada =
                context.includes("retirada") || context.includes("retirar");
              const checks = {
                produto: [
                  "cesta",
                  "produto",
                  "r$",
                  "rosa",
                  "buquê",
                  "bar",
                  "chocolate",
                ],
                data: [
                  "entrega",
                  "data",
                  "horário",
                  "hora",
                  "retirada",
                  "retirar",
                ],
                endereco: isRetirada
                  ? ["retirada", "retirar", "loja"]
                  : ["endereço", "rua", "bairro", "cidade"],
                pagamento: ["pix", "cartão", "pagamento", "crédito", "débito"],
              };

              const missing = [];
              for (const [category, keywords] of Object.entries(checks)) {
                if (!keywords.some((kw) => context.includes(kw)))
                  missing.push(category);
              }

              if (missing.length > 0) {
                const errorMsg = `{"status":"error","error":"incomplete_context","message":"⚠️ Faltam: ${missing.join(", ")}. Colete tudo ANTES de finalizar."}`;
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
