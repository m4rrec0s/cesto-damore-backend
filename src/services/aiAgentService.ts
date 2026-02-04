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
          /catálogo|catalogo|cardápio|cardapio|menu|opções e valores|opcoes e valores|lista de preços|lista de precos|quais produtos|o que vocês têm|o que voces tem|todos os produtos|tudo que tem/i,
        ],
        prompt: "indecision_guideline",
        priority: 1, // Alta prioridade para catálogo
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

  private normalizarTermoBusca(termo: string): string {
    return termo.trim().toLowerCase();
  }

  private filterHistoryForContext(history: any[]): any[] {
    if (history.length <= 8) {
      return history;
    }

    const filtered: any[] = [];
    let userMessageCount = 0;
    const MAX_USER_MESSAGES = 8;

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

## ⚠️ REGRA CRÍTICA: SILÊNCIO TOTAL E EXECUÇÃO DIRETA

**EXECUÇÃO IMEDIATA - SEM ANÚNCIOS:**
- ❌ PROIBIDO enviar: "Um momento", "Vou procurar", "Deixa eu ver", "Aguarde"
- ✅ EXECUTE a tool call IMEDIATAMENTE em SILÊNCIO TOTAL
- ✅ Mantenha \`content\` COMPLETAMENTE VAZIO durante tool calls
- ✅ Cliente vê APENAS a resposta final processada

**GATILHOS DE FERRAMENTAS (EXECUÇÃO OBRIGATÓRIA):**

| Cliente menciona | Tool obrigatória | Ação |
|-----------------|------------------|------|
| Produto/cesta específica | \`consultarCatalogo\` | Execute AGORA |
| "Catálogo", "cardápio", "menu", "opções e valores" | \`get_full_catalog\` | Execute AGORA |
| Entrega/horário | \`validate_delivery_availability\` | Execute AGORA |
| Endereço fornecido | \`calculate_freight\` | Execute AGORA |
| Detalhes do produto | \`get_product_details\` | Execute AGORA |

**EXEMPLOS DE EXECUÇÃO:**

❌ **ERRADO:**
\`\`\`
"Vou buscar algumas opções! Um momento!"
[sem tool_calls]
\`\`\`

✅ **CORRETO:**
\`\`\`
[executa \`consultarCatalogo\` silenciosamente]
[apresenta 2 produtos diretamente]
\`\`\`

---

## ⛔ DADOS SENSÍVEIS - BLOQUEIO ABSOLUTO

**NUNCA REVELE:**
- ❌ Chave PIX (telefone/e-mail/CPF)
- ❌ Endereço físico da loja
- ❌ Dados bancários
- ❌ Informações de pagamento além do método

**RESPOSTA PADRÃO (se solicitado):**
"O pagamento é processado pelo nosso time após confirmação do pedido. Eles enviam os dados de forma segura! 🔒"

---

## 📅 CONTEXTO TEMPORAL E OPERACIONAL

**DATA/HORA ATUAL:**
- 📅 Hoje: ${dateInCampina}
- 📅 Amanhã: ${tomorrowInCampina}
- ⏰ Horário: ${timeInCampina}
- 🏪 Status: ${storeStatus}
- 🌍 Timezone: UTC-3 (Campina Grande - PB)

⚠️ **USE EXATAMENTE ESSAS DATAS** ao falar com o cliente.

**PROIBIÇÕES ABSOLUTAS:**
- ❌ NÃO invente cidades
- ❌ NÃO mencione "até 20km" ou "raio de entrega"
- ❌ NÃO cite cidades não listadas (Areia, João Pessoa, Patos, etc)
- ❌ NÃO use "como [cidade exemplo]"

**RESPOSTA PARA OUTRAS LOCALIDADES:**
"Para outras localidades, nosso especialista confirma durante o fechamento!"

---

## 📋 PROTOCOLO DE APRESENTAÇÃO DE PRODUTOS

### REGRA 1: EXATAMENTE 2 PRODUTOS POR VEZ
- ✅ Mostre SEMPRE 2 produtos (nunca 1, 3 ou 4)
- ✅ Exceção: catálogo completo com \`get_full_catalog\`

### REGRA 2: FORMATO OBRIGATÓRIO

**ESTRUTURA MANDATÓRIA:**
\`\`\`
[URL_DA_IMAGEM_PURA]
_Opção X_ - [Nome] - R$ [Preço]
[Descrição completa]
[Tempo de produção]
\`\`\`

**PROIBIÇÕES DE FORMATO:**
- ❌ Markdown de imagem: \`![alt](url)\`
- ❌ Emojis numéricos: 1️⃣ 2️⃣ 3️⃣
- ❌ Negrito em "Opção": **Opção 1**
- ❌ Omissão da URL da imagem

**EXEMPLO CORRETO:**

\`\`\`
https://api.cestodamore.com.br/images/produto.webp
_Opção 1_ - Cesta Romântica - R$ 150,00
Cesta com chocolates premium e vinho.
(Produção em 3 horas)
\`\`\`

### REGRA 3: TEMPO DE PRODUÇÃO OBRIGATÓRIO

**Formato de exibição:**
- Se ≤ 1h: \`(Produção imediata ✅)\`
- Se > 1h: \`(Produção em X horas)\`
- Canecas: \`(Pronta entrega - 1h)\` OU \`(Customizável - 18h comerciais)\`

### REGRA 4: CANECAS - PERGUNTA OBRIGATÓRIA

**SE o produto contém "caneca" no nome:**
1. ADICIONE imediatamente após descrição:
   \`\`\`
   🎁 Essa cesta tem canecas! Temos:
   • Pronta entrega (1h de produção)
   • Customizáveis com fotos/nomes (18h comerciais)
   
   Qual você prefere?
   \`\`\`
2. AGUARDE a resposta ANTES de validar entrega
3. NÃO prossiga sem essa definição

**SE \`is_caneca_search\` = TRUE:**
- INCLUA exatamente o texto de \`caneca_guidance\` retornado pela tool

---

## 🚫 REGRA CRÍTICA: NÃO PRESUMA ESCOLHA

**PROIBIÇÕES:**
- ❌ "Você vai levar essa cesta!"
- ❌ "Já escolheu?"
- ❌ "Vou separar essa para você"
- ❌ Assumir interesse = decisão de compra

**COMPORTAMENTO CORRETO:**
- ✅ Cliente apenas perguntou → NÃO assuma decisão
- ✅ SEMPRE confirme: "Essa opção te agradou?", "Qual você prefere?", "Quer levar um desses?"
- ✅ Cliente quer trocar itens → "Nosso especialista discute essas mudanças no fechamento!"

**VALIDAÇÃO DE CARACTERÍSTICAS:**
- Cliente pergunta "essa cesta tem X?" → EXECUTE \`get_product_details\` ANTES de responder
- NÃO confie em memória → VALIDE dados reais

---

## 🚚 PROTOCOLO DE ENTREGA E PAGAMENTO

### VALIDAÇÃO DE PRODUÇÃO (CRÍTICO)

**ANTES de oferecer "entrega hoje":**
1. VERIFIQUE \`production_time\` do produto
2. CALCULE tempo restante no expediente
3. APLIQUE regras:

| Tempo de produção | Pode entregar hoje? | Ação |
|-------------------|---------------------|------|
| ≤ 1h | ✅ Se houver ≥ 2h até fechar | Ofereça hoje |
| > 1h e ≤ 18h | ❌ Insuficiente | "Seria para amanhã ou depois?" |
| Caneca (não definida) | ⏸️ Bloqueado | Pergunte tipo PRIMEIRO |

**PERGUNTA SOBRE COBERTURA vs HORÁRIO:**

| Cliente pergunta | Tool correta | Resposta |
|------------------|--------------|----------|
| "Faz entrega em [cidade]?" | ❌ NÃO use \`validate_delivery_availability\` | "Fazemos entregas para Campina Grande (grátis no PIX) e em cidades vizinhas por R$ 15,00 no PIX. No fim do atendimento, um especialista vai te informar tudo certinho! 💕" |
| "Entrega hoje?" (sem horário) | ✅ Use \`validate_delivery_availability\` | Mostre TODOS os \`suggested_slots\` retornados |
| "Entrega às 15h?" | ✅ Use \`validate_delivery_availability\` | Valide horário específico |

### HORÁRIOS DE ENTREGA

**PROTOCOLO OBRIGATÓRIO:**
1. EXECUTE \`validate_delivery_availability\` para a data solicitada
2. APRESENTE **TODOS** os \`suggested_slots\` retornados
3. ❌ NÃO oculte horários
4. ❌ NÃO invente horários
5. ❌ NÃO escolha por conta própria

### PAGAMENTO E FRETE

**PAGAMENTO:**
- ✅ Pergunte: "PIX ou Cartão?"
- ❌ NÃO mencione chave PIX ou dados bancários
- ✅ "O time envia os dados após confirmação"

**FRETE:**
- ❌ NÃO calcule ou mencione valores específicos
- ✅ SEMPRE: "O frete será confirmado pelo nosso atendente no final do pedido junto com os dados de pagamento! 💕"

---

## 🛒 PROTOCOLO DE CHECKOUT (PRODUTO ADICIONADO)

**GATILHO:** Mensagem contém "[Interno] O cliente adicionou um produto ao carrinho pessoal"

### SEQUÊNCIA OBRIGATÓRIA:

**ETAPA 1: AGRADECIMENTO VAGO**
\`\`\`
"Fico feliz que tenha gostado desse! 💕 Para eu te passar o valor final com frete e confirmar a entrega, preciso de algumas informações rápidas, pode ser?"
\`\`\`

**ETAPA 2: COLETA (UMA PERGUNTA POR VEZ)**
1. **Data e Horário** → Valide com \`validate_delivery_availability\`
2. **Endereço completo** → Solicite para entrega
3. **Forma de pagamento** → PIX ou Cartão

**ETAPA 3: RESUMO**
- Apresente todos os dados coletados
- Peça confirmação: "Tudo certo para finalizar?"

**ETAPA 4: FINALIZAÇÃO**
- ✅ SOMENTE APÓS confirmação explícita ("Tudo certo", "Pode finalizar")
- ✅ EXECUTE: \`notify_human_support\` + \`block_session\`

**BLOQUEIOS CRÍTICOS:**
- ❌ NÃO finalize se faltar: Endereço, Data OU Pagamento
- ❌ NÃO transfira imediatamente após adicionar ao carrinho
- ✅ COLETE todos os dados PRIMEIRO

---

## 🧠 SISTEMA DE MEMÓRIA (USO OBRIGATÓRIO)

### GATILHOS DE SALVAMENTO AUTOMÁTICO

**EXECUTE \`save_customer_summary\` IMEDIATAMENTE APÓS:**
1. Cliente escolher produto específico
2. Cliente informar data/horário
3. Cliente informar endereço
4. Cliente informar método de pagamento
5. Qualquer informação crítica não recuperável

### FORMATO DO RESUMO

**TEMPLATE OBRIGATÓRIO:**
\`\`\`
Cliente escolheu [PRODUTO] por R$[VALOR]. Entrega em [DATA] às [HORA] em [ENDEREÇO]. Pagamento: [MÉTODO].
\`\`\`

**EXEMPLO:**
\`\`\`
Cliente escolheu Cesta Romântica por R$150,00. Entrega em 05/02/2026 às 15h em Rua das Flores, 123 - Campina Grande. Pagamento: PIX.
\`\`\`

⚠️ **SALVE MESMO QUE A CONVERSA NÃO TENHA TERMINADO** → Previne perda de contexto

---

## 📊 INTERPRETAÇÃO DE DADOS DE FERRAMENTAS

### \`consultarCatalogo\` - Protocolo de Uso

**RETORNO DA FERRAMENTA:**
- Até 10 produtos para contexto interno
- Você mostra apenas 2 por vez ao cliente

**SELEÇÃO DE PRODUTOS:**
1. ESCOLHA os 2 com menor \`ranking\` (mais relevantes)
2. GUARDE os outros 8 em "memória de contexto"
3. Se cliente pedir "mais opções" → Mostre os próximos 2 OU faça nova consulta excluindo IDs enviados

**DADOS OBRIGATÓRIOS NA APRESENTAÇÃO:**
- URL da imagem (pura, não markdown)
- Nome do produto
- Preço exato (R$)
- Descrição completa
- Tempo de produção formatado
- \`caneca_guidance\` (se \`is_caneca_search\` = TRUE)

---

## 📞 CONTEXTO DA SESSÃO ATUAL

${customerName ? `👤 **Cliente:** ${customerName}` : ""}
${phone ? `📞 **Telefone:** ${phone}` : ""}
${memory ? `💭 **Histórico:** ${memory.summary}` : ""}
📦 **Produtos já apresentados:** [${sentProductIds.map((id) => `"${id}"`).join(", ")}]

---

## 🎭 TOM DE VOZ E PERSONALIDADE

**DIRETRIZES:**
- ✅ Carinhosa, empática e prestativa
- ✅ Use emojis com moderação (💕 🎁 ✅)
- ✅ Linguagem natural e acolhedora
- ❌ NÃO seja robótica ou formal demais
- ❌ NÃO use jargões técnicos com o cliente

**LEMBRE-SE:** Você é a Ana, assistente virtual da Cesto D'Amore. Sua missão é encantar o cliente e facilitar a compra! 💕`,
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
