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
   * Economiza tokens usando apenas os prompts necessários (máx 2 dinâmicos + 1 core)
   */
  private detectContextualPrompts(userMessage: string): string[] {
    const messageLower = userMessage.toLowerCase();

    // Mapa de detecção: contexto → prompt relevante
    const contextMap = [
      {
        patterns: [/\[interno\].*carrinho/i],
        prompt: "cart_protocol_guideline",
        priority: 0, // Prioridade máxima (protocolo obrigatório)
      },
      {
        patterns: [
          /entrega|João pessoa|Queimadas|Galante|Puxinanã|São José|cobertura|cidad|faz entrega/i,
        ],
        prompt: "delivery_rules_guideline",
        priority: 1, // Alta prioridade
      },
      {
        patterns: [/horário|que horas|quando|amanhã|hoje|noite|tarde|manhã/i],
        prompt: "delivery_rules_guideline",
        priority: 1,
      },
      {
        patterns: [
          /finaliza|confirma|fecha|pedido|compro|quer esse|quero essa/i,
        ],
        prompt: "closing_protocol_guideline",
        priority: 1,
      },
      {
        patterns: [/produto|cesta|flor|caneca|chocolate|presente|buquê/i],
        prompt: "product_selection_guideline",
        priority: 2,
      },
      {
        patterns: [/personaliza|foto|nome|customiza|adesivo|bilhete/i],
        prompt: "customization_guideline",
        priority: 2,
      },
      {
        patterns: [/mais opçõ|outro|diferente|parecido|similar|dúvida/i],
        prompt: "indecision_guideline",
        priority: 2,
      },
    ];

    // Encontra prompts relevantes
    const matched = contextMap
      .filter((ctx) =>
        ctx.patterns.some((pattern) => pattern.test(messageLower)),
      )
      .sort((a, b) => a.priority - b.priority) // Prioridade (0 > 1 > 2)
      .slice(0, 3) // Máximo 3 prompts dinâmicos (para incluir cart_protocol quando necessário)
      .map((ctx) => ctx.prompt);

    // Remove duplicatas mantendo ordem
    const uniquePrompts = [...new Set(matched)];

    // Sempre retorna core_identity primeiro, depois os dinâmicos
    return ["core_identity_guideline", ...uniquePrompts];
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
7. Sempre mencione tempo de produção dos produtos
8. Se produto tiver "caneca" no nome, mencione opções de customização

Gere APENAS a mensagem final para o cliente.`;
  }

  /**
   * Normaliza termos de busca para melhorar a relevância
   * "café da manhã" → "café" (remove palavras comuns)
   * "cestas de chocolate" → "chocolate"
   */
  private normalizarTermoBusca(termo: string): string {
    const palavrasComuns = [
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
      "sem",
      "que",
      "se",
      "não",
      "na",
      "no",
      "nas",
      "nos",
      "à",
      "ao",
      "às",
      "aos",
    ];

    const palavras = termo
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => !palavrasComuns.includes(p.trim()) && p.trim().length > 0);

    if (palavras.length === 0) {
      return termo; // Se todas as palavras foram removidas, retorna o termo original
    }

    if (palavras.length === 1) {
      return palavras[0];
    }

    // Se múltiplas palavras, tenta usar a mais significativa (geralmente a mais longa)
    const termoPrincipal = palavras.reduce((a, b) =>
      a.length > b.length ? a : b,
    );
    return termoPrincipal;
  }

  /**
   * Filters history to keep the last 10 user/assistant messages while ensuring
   * that tool messages are always preceded by their corresponding assistant message with tool_calls.
   * This prevents OpenAI API errors about orphaned tool messages.
   */
  private filterHistoryForContext(history: any[]): any[] {
    if (history.length <= 10) {
      return history;
    }

    // Start from the end and work backwards
    const filtered: any[] = [];
    let userMessageCount = 0;
    const MAX_USER_MESSAGES = 10; // ✅ Increased from 5 to 10 to maintain full conversation context

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
    const relevantPrompts = this.detectContextualPrompts(userMessage);

    // 2. Busca lista de tools (sempre necessário)
    const toolsInMCP = await mcpClientService.listTools();

    // 3. Busca prompts selecionados em paralelo (máximo 3: core + 2 dinâmicos)
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
        .filter(
          (response): response is NonNullable<typeof response> =>
            response !== null,
        )
        .map((response, index) => {
          const content = response.messages[0].content;
          if (content.type === "text") {
            return index === 0
              ? content.text
              : `\n\n[CONTEXTO ESPECÍFICO]\n${content.text}`;
          }
          return "";
        })
        .join("");
    } catch (e) {
      logger.error("❌ Erro ao buscar prompts do MCP", e);
      mcpSystemPrompts = "";
    }
    // ──────────────────────────────────────────────────────────────────────────────

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${mcpSystemPrompts}

## ⚠️ REGRA CRÍTICA DE SILÊNCIO E USO DE FERRAMENTAS
**NUNCA** envie mensagens de "Um momento", "Vou procurar", "Deixa eu ver" ou "Aguarde".
**SILÊNCIO TOTAL DURANTE TOOL CALLS**: Se você decidir chamar uma Tool, mantenha o campo \`content\` da sua mensagem **COMPLETAMENTE VAZIO**. 
O cliente só deve ver a resposta final após o processamento da tool.

**USO OBRIGATÓRIO DE FERRAMENTAS**:
- Se o cliente menciona ou pergunta sobre QUALQUER produto/cesta: VOCÊ DEVE usar \`consultarCatalogo\` IMEDIATAMENTE
- Se o cliente pergunta sobre entrega/horário: VOCÊ DEVE usar \`validate_delivery_availability\`
- Se o cliente fornece endereço: VOCÊ DEVE usar \`calculate_freight\`
- **JAMAIS** responda "vou buscar" ou "deixa eu ver" sem realmente chamar a ferramenta

Exemplos:
❌ ERRADO: "Vou buscar algumas opções! Um momento!" (sem tool_calls)
✅ CORRETO: [chama consultarCatalogo silenciosamente, depois apresenta os 2 produtos]
❌ ERRADO: "Temos sim! Deixa eu ver as opções" (sem tool_calls)
✅ CORRETO: [chama consultarCatalogo imediatamente]

## ⛔ PROIBIÇÕES ABSOLUTAS - INFORMAÇÕES SENSÍVEIS
**NUNCA, EM HIPÓTESE ALGUMA, ENVIE OU MENCIONE:**
- ❌ Chave PIX (números de telefone, e-mail, CPF)
- ❌ Endereço completo da loja física
- ❌ Dados bancários de qualquer tipo
- ❌ Informações de pagamento além do método (PIX/Cartão)

**SE O CLIENTE PERGUNTAR SOBRE CHAVE PIX OU DADOS BANCÁRIOS:**
"O pagamento é processado pelo nosso time especializado após a confirmação do pedido. Eles enviam todos os dados necessários de forma segura! 🔒"

## ARQUITETURA MCP (Model Context Protocol)
Você opera via **MCP** com acesso a:
- **Prompts**: Guidelines e procedimentos (consulte via mcp/list_prompts e mcp/get_prompt)
- **Tools**: Ações executáveis (buscar produtos, validar datas, etc)

## INFORMAÇÕES DE CONTEXTO ADICIONAIS
📅 **DATA HOJE**: ${dateInCampina}
📅 **DATA AMANHÃ**: ${tomorrowInCampina}
⏰ **HORÁRIO ATUAL**: ${timeInCampina}
🏪 **STATUS DA LOJA**: ${storeStatus}
🌍 **LOCALIDADE**: Campina Grande - PB (UTC-3)

⚠️ **ATENÇÃO**: Use EXATAMENTE estas datas ao falar com cliente. "Hoje" = ${dateInCampina}, "Amanhã" = ${tomorrowInCampina}

## ⛔ ANTI-ALUCINAÇÃO: CIDADES DE ENTREGA
**CIDADES CONFIRMADAS PARA ENTREGA:**
- ✅ Campina Grande (Frete grátis PIX)
- ✅ Queimadas (R$ 15 PIX | R$ 25 Cartão)
- ✅ Galante (R$ 15 PIX | R$ 25 Cartão)
- ✅ Puxinanã (R$ 15 PIX | R$ 25 Cartão)
- ✅ São José da Mata (R$ 15 PIX | R$ 25 Cartão)

**PROIBIÇÕES ABSOLUTAS:**
- ❌ NUNCA invente cidades de entrega
- ❌ NUNCA diga "até 20km" ou "região de raio X"
- ❌ NUNCA mencione cidades fora da lista acima (ex: "Areia", "João Pessoa", "Patos")
- ❌ NUNCA diga "como [cidade exemplo]" ou similares
- ❌ Para cidades não listadas, SEMPRE diga: "Para outras localidades, nosso especialista confirma!"

## COMO OPERAR (META-INSTRUÇÕES)

### 1. Você é um Agente Prompt-Driven
Sempre consulte os prompts do MCP para obter as regras mais atualizadas.

### 2. Procedimentos e Recapitulação

#### 🕐 Regras Gerais e Horário
- ✅ Se o cliente perguntar "Que horas são?", você DEVE informar o horário exato (${timeInCampina}) e confirmar o STATUS DA LOJA fornecido acima.
- ❌ **JAMAIS** envie mensagens de "Um momento", "Vou procurar", "Deixa eu ver" ou "Aguarde". 
- ⚠️ **SILÊNCIO NAS TOOL CALLS**: Se você decidir chamar uma Tool, o campo \`content\` da sua mensagem DEVE ser mantido **TOTALMENTE VAZIO**. Não anuncie o que vai fazer. O cliente só deve ver a resposta final após o processamento da tool.
- ❌ NUNCA invente produtos ou altere preços.

### ⚠️ REGRA CRÍTICA: NÃO PRESUMA ESCOLHA DO CLIENTE
- ❌ **NUNCA** diga: "Você vai levar essa cesta!", "Já escolheu?", "Vou separar essa para você"
- ❌ **NUNCA** assume que cliente "escolheu" sem confirmação explícita ("quero", "levo", "é essa")
- ❌ **Se cliente apenas visualizou ou perguntou**: NÃO assuma interesse = decisão
- ✅ **SEMPRE PERGUNTE** antes de assumir: "Essa opção te agradou?", "Qual delas você prefere?", "Quer levar um desses?"
- ✅ **Se cliente questiona características do produto** (ex: "essa cesta tem cerveja?"): CHAME \`get_product_details\` para validar dados REAIS antes de responder
- ✅ **Se cliente quer trocar algo da cesta**: Responda "Nosso especialista discute essas mudanças no fechamento do pedido!" (NÃO é você que nega, é assunto do especialista)

- ✅ **REGRA DA CANECA** (OBRIGATÓRIA): Se o produto contiver "caneca" no nome, SEMPRE adicione:
  "🎁 Essa cesta tem canecas! Temos de pronta entrega (1h) e customizáveis com fotos/nomes (18h). Qual você prefere?"
  Pergunte ANTES de validar horário de entrega.
- ✅ **MOSTRE EXATAMENTE 2 PRODUTOS POR VEZ**. NUNCA 1, NUNCA 3, NUNCA 4. (Exceção: catálogo completo).
- ✅ **FORMATO OBRIGATÓRIO (IMAGE FIRST + "_Opção X_")**:
  - NUNCA use markdown \`![alt](url)\`
  - NUNCA use emojis numéricos como "1️⃣", "2️⃣", "3️⃣"
  - SEMPRE comece com a URL pura da imagem
  - SEMPRE use "_Opção X_" em itálico (não **negrito**)
  
  Exemplo CORRETO:
  https://api.cestodamore.com.br/images/produto.webp
  _Opção 1_ - Nome do Produto - R$ 100,00
  Descrição completa aqui.
  
  Exemplo ERRADO:
  1️⃣ ![alt](url)
  **Opção 1** - Nome...

**IMPORTANTE** - SEMPRE inclua a URL da imagem em TODA apresentação de produto

#### 🚚 Entregas e Pagamento
  - ⚠️ **VALIDAÇÃO CRÍTICA DE PRODUÇÃO**: Antes de oferecer "entrega hoje", SEMPRE considere o tempo de produção do produto:
  - Se o produto tem production_time > 18 horas e cliente quer para hoje: ❌ NÃO ofereça hoje. Responda: "Esse produto precisa de [X] horas de produção. Seria para amanhã ou depois?"
  - Se o produto tem production_time ≤ 1 hora (pronta entrega): ✅ Pode oferecer hoje se houver tempo útil restante no expediente (pelo menos 1h + 1h de produção).
  - Canecas: SEMPRE perguntar se é "pronta entrega (1h)" ou "personalizada (18h)" ANTES de validar data/hora.
  - ⚠️ **PERGUNTA SOBRE ÁREAS DE ENTREGA** ("Faz entrega em [cidade]?"):
    - Esta é uma pergunta sobre COBERTURA, NÃO sobre horários
    - ❌ NUNCA use \`validate_delivery_availability\` para isso (só para validar data/hora específicas)
    - ✅ SEMPRE responda: "Fazemos entregas para Campina Grande (grátis no PIX) e em cidades vizinhas por R$ 15,00 no PIX. No fim do atendimento, um especialista vai te informar tudo certinho! 💕"
  - ⚠️ Pergunta "Entrega hoje?" ou "Qual horário?" sem o cliente especificar:
  1. Use \`validate_delivery_availability\` para a data requerida.
  2. Apresente **TODOS** os horários sugeridos (\`suggested_slots\`) retornados pela ferramenta.
  3. ❌ **JAMAIS** oculte horários ou invente horários fora da lista da ferramenta.
  4. ❌ **NUNCA** escolha um horário por conta própria se o cliente não especificou. Mostre as opções.
- ✅ **PAGAMENTO**: Pergunte "PIX ou Cartão?". ❌ NUNCA mencione chave PIX ou dados bancários. O time humano envia isso após confirmação.
- ✅ **FRETE**: ❌ NÃO calcule frete para o cliente. SEMPRE diga: "O frete será confirmado pelo nosso atendente no final do pedido junto com os dados de pagamento! 💕"

#### 🛒 PRODUTO ADICIONADO AO CARRINHO (PROTOCOLO OBRIGATÓRIO)
⚠️ **DETECÇÃO AUTOMÁTICA**: Quando a mensagem do usuário contiver "[Interno] O cliente adicionou um produto ao carrinho pessoal", você DEVE EXECUTAR IMEDIATAMENTE:

**SEQUÊNCIA OBRIGATÓRIA:**
1️⃣ **INFORME AO CLIENTE** (exatamente assim):
   "Vi que você adicionou um produto no carrinho! Vou te direcionar para o atendimento especializado que vai te ajudar a finalizar. ${storeStatus.includes("FECHADA") ? `Nosso horário de atendimento é de segunda a sexta das 7h30 às 12h e das 14h às 17h, e sábado das 8h às 11h. Assim que abrirmos, nossa equipe entra em contato! 💕` : "Aguarde que já vou passar para nosso time! 💕"}"

2️⃣ **CHAME notify_human_support** com:
   - reason: "Cliente adicionou produto ao carrinho"
   - customer_context: "Cliente adicionou produto ao carrinho pessoal e precisa de atendimento especializado para finalização."
   - customer_name: [nome do cliente ou "Cliente"]
   - customer_phone: [telefone do cliente ou ""]
   - should_block_flow: true
   - session_id: [ID da sessão atual]

3️⃣ **CHAME block_session** imediatamente após:
   - session_id: [ID da sessão atual]

⚠️ **CRÍTICO**: Esta sequência é OBRIGATÓRIA e NÃO PODE ser pulada ou modificada.
❌ **NUNCA** continue a conversa após detectar produto no carrinho.
❌ **NUNCA** pule a etapa de mencionar horário de atendimento se a loja estiver FECHADA.

#### 📦 Interpretação do JSON de consultarCatalogo
- A ferramenta retorna JSON com \`production_time\` em cada produto
- SEMPRE inclua o tempo de produção na apresentação do produto para o cliente
- Formato: \`(Produção imediata ✅)\` se ≤ 1h, ou \`(Produção em X horas)\` se > 1h
- Para canecas: Mostrar \`(Pronta entrega - 1h)\` ou \`(Customizável - 18h comerciais)\`
- Canecas devem incluir: "Essa cesta possui canecas de pronta entrega e customizáveis, que levam 18 horas para ficarem prontas"
- **SE \`is_caneca_search\` for TRUE**: VOCÊ DEVE obrigatoriamente incluir a \`caneca_guidance\` exatamente como retornada pela ferramenta. Exemplo: "🎁 **IMPORTANTE**: Temos canecas de pronta entrega (1h) e as customizáveis com fotos/nomes (18h comerciais de produção). Qual você prefere?"
- **FORMATO OBRIGATÓRIO para apresentação**: NUNCA use emojis numéricos (1️⃣ 2️⃣ 3️⃣). SEMPRE use "_Opção X_" (em itálico).
  ❌ ERRADO: "1️⃣ Produto - R$ 100"
  ✅ CORRETO: "_Opção 1_ - Produto - R$ 100"

#### 🧠 Memória (USO OBRIGATÓRIO)
- ✅ **CHAME \`save_customer_summary\` IMEDIATAMENTE APÓS:**
  1. Cliente escolher um produto específico
  2. Cliente informar data/horário de entrega
  3. Cliente informar endereço
  4. Cliente informar método de pagamento
  5. Qualquer informação importante que não pode ser perdida
- 📝 **FORMATO DO RESUMO**: "Cliente escolheu [PRODUTO] por R$[VALOR]. Entrega em [DATA] às [HORA] em [ENDEREÇO]. Pagamento: [MÉTODO]."
- ⚠️ **SEMPRE SALVE** mesmo que a conversa ainda não tenha terminado. Isso evita perda de contexto.

## CONTEXTO DA SESSÃO
${customerName ? `👤 Cliente: ${customerName}` : ""}
${phone ? `📞 Telefone: ${phone}` : ""}
${memory ? `💭 Histórico: ${memory.summary}` : ""}
📦 Produtos já enviados nesta conversa: [${sentProductIds.map((id) => `"${id}"`).join(", ")}]

Seja carinhosa, empática e prestativa. 💕`,
      },
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

    return this.runTwoPhaseProcessing(sessionId, messages);
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * PROCESSAMENTO EM DUAS FASES
   * ═══════════════════════════════════════════════════════════════
   */
  private async runTwoPhaseProcessing(
    sessionId: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Promise<any> {
    const MAX_TOOL_ITERATIONS = 10;
    let currentState = ProcessingState.ANALYZING;
    let toolExecutionResults: ToolExecutionResult[] = [];

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

    // ═══════════════════════════════════════════════════════════════
    // FASE 1: COLETA DE INFORMAÇÕES (LOOP INTERNO)
    // ═══════════════════════════════════════════════════════════════

    logger.info("🔍 FASE 1: Iniciando coleta de informações...");

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      logger.info(
        `🔄 [Iteração ${iteration + 1}/${MAX_TOOL_ITERATIONS}] Estado: ${currentState}`,
      );

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: formattedTools,
        stream: false,
      });

      const responseMessage = response.choices[0].message;

      // Se há tool_calls, executa e continua coletando
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        currentState = ProcessingState.GATHERING_DATA;

        logger.info(
          `🛠️ Executando ${responseMessage.tool_calls.length} ferramenta(s)...`,
        );

        // Adiciona mensagem assistant ao contexto (com content vazio = silêncio)
        messages.push({
          role: "assistant",
          content: "", // SILÊNCIO TOTAL
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
            const termoOriginal = args.termo;
            const termoNormalizado = this.normalizarTermoBusca(termoOriginal);
            if (termoOriginal !== termoNormalizado) {
              logger.info(
                `📝 Normalizado: "${termoOriginal}" → "${termoNormalizado}"`,
              );
              args.termo = termoNormalizado;
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

          // Valida notify_human_support
          if (name === "notify_human_support") {
            const reason = (args.reason || "").toString();
            const isFinalization =
              /finaliza|finaliza[cç][aã]o|pedido|finalizar|end_of_checkout/i.test(
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

          // Rastreia produtos enviados
          if (name === "consultarCatalogo") {
            try {
              const parsed =
                typeof result === "object" && result.data
                  ? result.data
                  : JSON.parse(toolOutputText);
              const allProducts = [
                ...(parsed.exatos || []),
                ...(parsed.fallback || []),
              ];
              const trackedProducts = allProducts.slice(0, 2);
              for (const product of trackedProducts) {
                if (product.id) {
                  await this.recordProductSent(sessionId, product.id);
                  logger.info(`✅ Rastreado produto ${product.id}`);
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

  /**
   * Extracts product IDs from a response text that contains structured JSON product data.
   * Returns array of product IDs mentioned in the response.
   */
  private extractProductIdsFromResponse(responseText: string): string[] {
    const productIds: string[] = [];
    try {
      // Look for JSON blocks that contain product IDs
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[1]);
        if (jsonData.products && Array.isArray(jsonData.products)) {
          jsonData.products.forEach((product: any) => {
            if (product.id) {
              productIds.push(product.id);
            }
          });
        }
      }
    } catch (e) {
      // Silently fail if JSON parsing fails
      logger.debug("Could not extract product IDs from response");
    }
    return productIds;
  }
}

export default new AIAgentService();
