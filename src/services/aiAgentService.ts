import OpenAI from "openai";
import prisma from "../database/prisma";
import mcpClientService from "./mcpClientService";
import logger from "../utils/logger";
import { addDays, isPast, format } from "date-fns";
import { ptBR } from "date-fns/locale";

class AIAgentService {
  private openai: OpenAI;
  private model: string = "gpt-4o-mini"; // User requested gpt-4.1-mini or gpt-o4-mini (which meant 4o-mini)

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
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
   * Filters history to keep the last 5 user/assistant messages while ensuring
   * that tool messages are always preceded by their corresponding assistant message with tool_calls.
   * This prevents OpenAI API errors about orphaned tool messages.
   */
  private filterHistoryForContext(history: any[]): any[] {
    if (history.length <= 5) {
      return history;
    }

    // Start from the end and work backwards
    const filtered: any[] = [];
    let userMessageCount = 0;
    const MAX_USER_MESSAGES = 5;

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

  async getSession(sessionId: string, customerPhone?: string) {
    let session = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { created_at: "asc" },
        },
      },
    });

    if (!session || isPast(session.expires_at)) {
      if (session) {
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
      }

      session = await prisma.aIAgentSession.create({
        data: {
          id: sessionId,
          customer_phone: customerPhone,
          expires_at: addDays(new Date(), 5), // Default 5 days expiration
        },
        include: {
          messages: true,
        },
      });
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
        customer: true,
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

    // Ordenar pela última mensagem (ou created_at se não houver mensagens)
    return sessions.sort((a, b) => {
      const dateA =
        a.messages.length > 0
          ? new Date(a.messages[0].created_at).getTime()
          : new Date(a.created_at).getTime();
      const dateB =
        b.messages.length > 0
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
  ) {
    const session = await this.getSession(sessionId, customerPhone);

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

      // Reset follow-up history when customer sends a new message
      await prisma.followUpSent.deleteMany({
        where: { cliente_number: customerPhone },
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
    }).format(new Date(Date.now() + 86400000));

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

    // ── FLUXO IDEAL MCP ──────────────────────────────────────────────────────────
    // 1. Busca lista de tools e prompts frescos do servidor MCP
    const toolsInMCP = await mcpClientService.listTools();
    const promptsInMCP = await mcpClientService.listPrompts();

    // 2. Busca o Prompt System (Core Identity) do MCP
    let mcpCorePrompt = "";
    try {
      const corePromptResponse = await mcpClientService.getPrompt(
        "core_identity_guideline",
      );
      const content = corePromptResponse.messages[0].content;
      if (content.type === "text") {
        mcpCorePrompt = content.text;
      }
    } catch (e) {
      logger.error("❌ Erro ao buscar core_identity_guideline do MCP", e);
    }
    // ──────────────────────────────────────────────────────────────────────────────

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${mcpCorePrompt}

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

## ARQUITETURA MCP (Model Context Protocol)
Você opera via **MCP** com acesso a:
- **Prompts**: Guidelines e procedimentos (consulte via mcp/list_prompts e mcp/get_prompt)
- **Tools**: Ações executáveis (buscar produtos, validar datas, etc)

## INFORMAÇÕES DE CONTEXTO ADICIONAIS
📅 DATA ATUAL: ${dateInCampina}
⏰ HORÁRIO ATUAL: ${timeInCampina}
🏪 STATUS DA LOJA: ${storeStatus}
🌍 LOCALIDADE: Campina Grande - PB (UTC-3)

## COMO OPERAR (META-INSTRUÇÕES)

### 1. Você é um Agente Prompt-Driven
Sempre consulte os prompts do MCP para obter as regras mais atualizadas.

### 2. Prompts MCP Disponíveis
${promptsInMCP.map((p: any) => `- \`${p.name}\`: ${p.description}`).join("\n")}

### 3. Procedimentos e Recapitulação

#### � Regras Gerais e Horário
- ✅ Se o cliente perguntar "Que horas são?", você DEVE informar o horário exato (${timeInCampina}) e confirmar o STATUS DA LOJA fornecido acima.
- ❌ **JAMAIS** envie mensagens de "Um momento", "Vou procurar", "Deixa eu ver" ou "Aguarde". 
- ⚠️ **SILÊNCIO NAS TOOL CALLS**: Se você decidir chamar uma Tool, o campo \`content\` da sua mensagem DEVE ser mantido **TOTALMENTE VAZIO**. Não anuncie o que vai fazer. O cliente só deve ver a resposta final após o processamento da tool.
- ❌ NUNCA invente produtos ou altere preços.
- ✅ **REGRA DA CANECA**: Canecas Personalizadas (fotos/nomes) levam **18 horas comerciais** de produção. Temos canecas brancas de pronta entrega (1h). No final o atendente confirma a escolha do cliente.
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

#### 🚚 Entregas e Pagamento
  - ⚠️ **VALIDAÇÃO CRÍTICA DE PRODUÇÃO**: Antes de oferecer "entrega hoje", SEMPRE considere o tempo de produção do produto:
  - Se o produto tem production_time > 18 horas e cliente quer para hoje: ❌ NÃO ofereça hoje. Responda: "Esse produto precisa de [X] horas de produção. Seria para amanhã ou depois?"
  - Se o produto tem production_time ≤ 1 hora (pronta entrega): ✅ Pode oferecer hoje se houver tempo útil restante no expediente (pelo menos 1h + 1h de produção).
  - Canecas: SEMPRE perguntar se é "pronta entrega (1h)" ou "personalizada (18h)" ANTES de validar data/hora.
  - ⚠️ Pergunta "Entrega hoje?" ou "Qual horário?" sem o cliente especificar:
  1. Use \`validate_delivery_availability\` para a data requerida.
  2. Apresente **TODOS** os horários sugeridos (\`suggested_slots\`) retornados pela ferramenta.
  3. ❌ **JAMAIS** oculte horários ou invente horários fora da lista da ferramenta.
  4. ❌ **NUNCA** escolha um horário por conta própria se o cliente não especificou. Mostre as opções.
- ✅ **PAGAMENTO**: Pergunte "PIX ou Cartão?". Se for Cartão, não mencione parcelamento agora.
- ✅ **FRETE**: Só informe o frete após conferir endereço e método de pagamento.

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

#### 🧠 Memória
- ✅ **USE OBRIGATORIAMENTE** \`save_customer_summary\` após qualquer avanço (escolheu presente, deu endereço, marcou data).

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

    return this.runToolLoop(sessionId, messages);
  }

  private async runToolLoop(
    sessionId: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Promise<any> {
    const MAX_ITERATIONS = 10; // Prevent infinite loops
    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

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

      // 🔍 Detect if user is asking about products (force tool usage)
      const lastUserMessage = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      const userText =
        lastUserMessage && typeof lastUserMessage.content === "string"
          ? lastUserMessage.content.toLowerCase()
          : "";

      const isProductQuery =
        /\b(cesta|produto|caneca|chocolate|café|buqu[êe]|flor|vinho|whisky|rosa|presente|gift|tem|quero|gostaria|mostrar|ver|opç[õo]|catálogo)\b/i.test(
          userText,
        );
      const isFirstIteration = iteration === 1;

      // Force tool usage on first iteration if it's clearly a product query
      const toolChoice =
        isFirstIteration && isProductQuery ? "required" : "auto";

      if (toolChoice === "required") {
        logger.info(
          `🎯 Forcing tool usage for product query: "${userText.substring(0, 50)}..."`,
        );
      }

      // ✅ CRITICAL: Use stream: false to get complete response before checking tool_calls
      const currentResponse = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: formattedTools,
        tool_choice: toolChoice,
        stream: false, // ✅ Must be false to check tool_calls synchronously
      });

      const responseMessage = currentResponse.choices[0].message;

      // ✅ Check if LLM wants to call tools
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        logger.info(
          `🔄 [Iteration ${iteration}] LLM requested ${responseMessage.tool_calls.length} tool call(s)`,
        );

        // ⚠️ PROGRAMMATIC SILENCE: Discard any text content when tools are called
        const silencedMessage = {
          ...responseMessage,
          content: "", // ✅ Force empty to prevent "Um momento" messages
        };
        messages.push(silencedMessage as any);

        // Save silenced assistant message
        await prisma.aIAgentMessage.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: "", // ✅ Save as empty
            tool_calls: JSON.stringify(responseMessage.tool_calls),
          },
        });

        // ✅ Execute all tool calls
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== "function") continue;

          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          logger.info(`🔧 Executing tool: ${name}`, args);

          // 🔑 Normalize search terms
          if (name === "consultarCatalogo" && args.termo) {
            const termoOriginal = args.termo;
            const termoNormalizado = this.normalizarTermoBusca(termoOriginal);
            if (termoOriginal !== termoNormalizado) {
              logger.info(
                `📝 Search term normalized: "${termoOriginal}" → "${termoNormalizado}"`,
              );
              args.termo = termoNormalizado;
            }
          }

          // ✅ Validate calculate_freight parameters
          if (name === "calculate_freight") {
            const city = args.city || args.cityName || args.city_name;
            if (!city) {
              const errorMsg = `{"status":"error","error":"missing_params","message":"Parâmetro ausente: cidade. Pergunte ao cliente: 'Qual é a sua cidade?'"}`;

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

          // ✅ Validate notify_human_support context
          if (name === "notify_human_support") {
            const reason = (args.reason || "").toString();
            const isFinalization =
              /finaliza|finaliza[cç][aã]o|pedido|finalizar|finalizado|end_of_checkout/i.test(
                reason,
              );
            const context = (
              args.customer_context ||
              args.customerContext ||
              ""
            ).toString();

            if (isFinalization) {
              const requiredKeywords = [
                "cesta",
                "entrega",
                "endereço",
                "pagamento",
              ];
              const found = requiredKeywords.filter((k) =>
                context.toLowerCase().includes(k),
              );

              if (found.length < 3) {
                const missing = requiredKeywords.filter(
                  (k) => !context.toLowerCase().includes(k),
                );
                const errorMsg = `{"status":"error","error":"incomplete_context","message":"Contexto incompleto. Faltando: ${missing.join(", ")}. Colete todas as informações antes de notificar."}`;

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
            } else {
              // Generic notification logic
              if (!args.customer_phone && !args.customerPhone) {
                try {
                  const sessRec = await prisma.aIAgentSession.findUnique({
                    where: { id: sessionId },
                  });
                  if (sessRec?.customer_phone) {
                    args.customer_phone = sessRec.customer_phone;
                  }
                } catch (e) {
                  logger.debug(
                    "Could not fetch session phone to include in notify_human_support",
                    e,
                  );
                }
              }

              if (!context || context.trim() === "") {
                args.customer_context =
                  args.customer_context ||
                  "Cliente solicitou conversar com um atendente humano. Contexto não fornecido pela IA.";
              }
            }
          }

          // ✅ Execute the tool
          let result: any;
          try {
            result = await mcpClientService.callTool(name, args);
          } catch (error: any) {
            logger.error(`❌ Error executing tool ${name}:`, error);
            result = `Erro ao executar ${name}: ${error.message}`;
          }

          // ✅ Normalize tool output
          let toolOutputText: string;
          try {
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
          } catch (e) {
            toolOutputText =
              typeof result === "string" ? result : JSON.stringify(result);
          }

          // ✅ Track sent products (consultarCatalogo only)
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

              if (allProducts.length > 2) {
                logger.warn(
                  `⚠️ consultarCatalogo returned ${allProducts.length} products, limiting to 2`,
                );
                const firstTwo = allProducts.slice(0, 2);
                const rebuiltResponse = {
                  ...parsed,
                  exatos: firstTwo.filter((p) => p.tipo_resultado === "EXATO"),
                  fallback: firstTwo.filter(
                    (p) => p.tipo_resultado === "FALLBACK",
                  ),
                };
                toolOutputText = JSON.stringify(rebuiltResponse);
              }

              const trackedProducts = allProducts.slice(0, 2);
              for (const product of trackedProducts) {
                if (product.id) {
                  await this.recordProductSent(sessionId, product.id);
                  logger.info(
                    `✅ Tracked product ${product.id} as sent in session ${sessionId}`,
                  );
                }
              }
            } catch (e) {
              logger.debug("Could not extract product IDs", e);
            }
          }

          // ✅ Add tool result to messages
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutputText,
          });

          // ✅ Save tool result to DB
          await prisma.aIAgentMessage.create({
            data: {
              session_id: sessionId,
              role: "tool",
              content: toolOutputText,
              tool_call_id: toolCall.id,
              name: name,
            } as any,
          });

          // ✅ Memory save logic for notify_human_support
          if (name === "notify_human_support") {
            const success =
              toolOutputText.toLowerCase().includes("notifica") ||
              toolOutputText.toLowerCase().includes("sucesso");
            if (success) {
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
                const customerContext =
                  args.customer_context ||
                  args.customerContext ||
                  toolOutputText;
                if (customerPhone) {
                  await mcpClientService.callTool("save_customer_summary", {
                    customer_phone: customerPhone,
                    summary: customerContext,
                  });
                  logger.info(`💾 Saved customer summary for ${customerPhone}`);
                }
              } catch (e) {
                logger.error(
                  "❌ Failed to save customer summary after notify_human_support",
                  e,
                );
              }
            }
          }
        }

        // ✅✅✅ CRITICAL: Continue the loop to let LLM process tool results
        logger.info(`🔄 Continuing loop to process tool results...`);
        continue; // ← This is the key! Loop back to call OpenAI again
      } else {
        // ✅ No more tool calls - return final streaming response
        logger.info(
          `✅ [Iteration ${iteration}] No tool calls, returning final response`,
        );

        // ✅ IMPORTANT: Now we can stream the final response to the user
        return this.openai.chat.completions.create({
          model: this.model,
          messages,
          stream: true, // ✅ Stream the final user-facing response
        });
      }
    }

    // ✅ Safety: If we hit max iterations, return a helpful error
    logger.error(`❌ Max iterations (${MAX_ITERATIONS}) reached in tool loop`);
    return this.openai.chat.completions.create({
      model: this.model,
      messages: [
        ...messages,
        {
          role: "system",
          content:
            "Você atingiu o limite de operações. Por favor, resuma o que conseguiu até agora e pergunte ao cliente se ele precisa de mais alguma coisa.",
        },
      ],
      stream: true,
    });
  }

  // Helper to collect final response and save it to DB
  async saveResponse(sessionId: string, content: string) {
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
