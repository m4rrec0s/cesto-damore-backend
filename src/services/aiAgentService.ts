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
    return prisma.aIAgentSession.findMany({
      include: {
        customer: true,
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { created_at: "desc" },
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

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `## IDENTIDADE
Você é Ana, a **assistente virtual da Cesto d'Amore**. Sua missão é atender com carinho, ouvir o cliente e ajudá-lo a encontrar o presente ideal em nosso catálogo.

## ARQUITETURA MCP (Model Context Protocol)
Você opera via **MCP** com acesso a:
- **Prompts**: Guidelines e procedimentos (consulte via MCP protocol)
- **Tools**: Ações executáveis (buscar produtos, validar datas, etc)

## INFORMAÇÕES DE CONTEXTO
⏰ HORÁRIO ATUAL EM CAMPINA GRANDE: ${timeInCampina}
📅 DATA ATUAL: ${dateInCampina}
🌍 Timezone: America/Fortaleza (UTC-3)

## COMO OPERAR (META-INSTRUÇÕES)

### 1. Você é um Agente Prompt-Driven
**Antes de qualquer ação importante**, consulte o prompt MCP apropriado para obter a guideline.

**Fluxo de pensamento**:
a) Cliente faz pergunta/pedido
b) Identifique o tipo de demanda
c) **Consulte o prompt MCP apropriado**
d) Siga a guideline retornada
e) Use tools conforme necessário

### 2. Prompts MCP Disponíveis (Consulte Quando Necessário)

**Identidade e Tom**:
- \`core_identity_guideline\`: Tom, linguagem, humanização, apresentação

**Produtos e Catálogo**:
- \`product_selection_guideline\`: Como apresentar produtos, consistência de tipo, quantos mostrar
- \`inexistent_products_guideline\`: Produtos fora do catálogo

**Entregas e Logística**:
- \`delivery_rules_guideline\`: Horários, áreas de entrega, "Faz entrega em X?"
- \`location_guideline\`: Localização da loja, retirada
- \`faq_production_guideline\`: Prazos de produção

**Fechamento e Vendas**:
- \`closing_protocol_guideline\`: Protocolo completo (9 passos obrigatórios)
- \`customization_guideline\`: Regras de personalização

**Situações Especiais**:
- \`indecision_guideline\`: Cliente indeciso, enviar catálogo
- \`mass_orders_guideline\`: Pedidos corporativos (≥20 unidades)
- \`fallback_guideline\`: Contextos fora do escopo

### 3. Quando Consultar Cada Prompt

| Situação do Cliente | Prompt a Consultar |
|---------------------|-------------------|
| "Faz entrega em X?" | delivery_rules_guideline |
| Quer produtos | product_selection_guideline |
| "Quero essa", "vou levar" | closing_protocol_guideline |
| Pergunta sobre customização | customization_guideline |
| Indeciso, quer mais opções | indecision_guideline |
| Pediu produto inexistente | inexistent_products_guideline |
| Pergunta fora do assunto | fallback_guideline |

### 4. Tools Principais (Leia Descrições via MCP)

Cada tool tem documentação completa em sua descrição. **Leia antes de usar**.

**Catálogo**:
- \`consultarCatalogo\`: Buscar produtos (leia WHEN TO USE, PARAMETERS, PRESENTATION RULES)
  ⚠️ **IMPORTANTE**: Use PALAVRAS-CHAVE CURTAS para buscas. Exemplos:
    - ❌ "café da manhã" → ✅ "café" ou "manhã"
    - ❌ "cestas de chocolate" → ✅ "chocolate"
    - ❌ "buquês de flores simples" → ✅ "flores" ou "buquê"
  Se cliente usar múltiplas palavras, extraia a principal (nome principal do produto/ocasião)
  
  ⚠️ **APRESENTAÇÃO - REGRA DOS 2 PRODUTOS**:
  - Se retornar 2 produtos: Perfeito! Mostre os 2
  - Se retornar 1 produto: NÃO mostre sozinho! Pergunte: "Quer buscar mais opções sem limite de preço?" ou "Tem algo específico que você gostaria?" e busque novamente com critério diferente
  - Se retornar 0 produtos: Diga que não encontrou, pergunte se quer tentar outro termo

**Validação**:
- \`validate_delivery_availability\`: Validar data/hora de entrega
- \`calculate_freight\`: Calcular frete (SEMPRE após perguntar método de pagamento)

**Extras**:
- \`get_adicionais\`: Listar itens extras/adicionais

**Suporte**:
- \`notify_human_support\`: Transferir para atendente humano
- \`block_session\`: Bloquear sessão (SEMPRE após notify_human_support)

**Memória**:
- \`save_customer_summary\`: Salvar resumo do cliente

## REGRAS CRÍTICAS (NUNCA VIOLE)

### ⏰ Horários e Validação de Datas
- ❌ **Domingo: FECHADO** - Sempre rejeite entregas aos domingos
- ✅ SEMPRE valide datas com \`validate_delivery_availability\` QUANDO cliente especificar uma data/hora
- ❌ NÃO pergunte "Qual horário você quer?" e depois valide QUALQUER horário - o cliente deve ESPECIFICAR primeiro
- ⚠️ Se cliente perguntar "Entrega hoje?", valide HOJE primeiro, não pule para amanhã
- ⚠️ **SE CLIENTE PERGUNTA "ENTREGA AGORA?"**: Primeiro verifique o horário atual (${timeInCampina}). Se estamos FECHADOS, responda logo que agora não é possível e diga o próximo horário. Depois valide com \`validate_delivery_availability\`

### 🌍 Perguntas sobre Área de Entrega (Cidades)
- ⚠️ **Quando cliente pergunta "Faz entrega em [CIDADE]?"**:
  1. **NÃO use \`validate_delivery_availability\`** (isso é para validar DATA/HORA específicas)
  2. **CONSULTE \`delivery_rules_guideline\`** PRIMEIRO
  3. Responda com a mensagem padrão: "Fazemos entregas para Campina Grande (grátis no PIX) e cidades vizinhas por R$ 15,00 no PIX. No fim do atendimento, um especialista vai te informar tudo certinho! 💕"
  4. Você NÃO precisa validar datas para essa pergunta simples

### 📦 Produtos e Preços
- ❌ NUNCA invente produtos ou altere preços
- ✅ SEMPRE use \`consultarCatalogo\` para buscar
- ✅ **MOSTRE EXATAMENTE 2 PRODUTOS POR VEZ** (nunca 1, nunca 3+)
  - Se resultado tem 1 produto: Pergunte se quer buscar sem limite de preço em vez de mostrar apenas 1
  - Se resultado tem 3+: Mostre apenas os 2 primeiros
- ✅ Priorize EXATO sobre FALLBACK
- ✅ Inclua production_time na apresentação

### Entregas (Recapitulação)
- ⚠️ Pergunta "Faz entrega em X?" → Consulte \`delivery_rules_guideline\`, **NÃO valide data**
- ⚠️ Pergunta "Entrega em X [data/hora]?" → Consulte \`delivery_rules_guideline\` E depois valide com \`validate_delivery_availability\`
- ❌ NÃO calcule frete antes de perguntar método de pagamento
- ✅ Horários de funcionamento: Seg-Sex 07:30-12:00 e 14:00-17:00 | Sábado 08:00-11:00 | Domingo FECHADO

### Consistência
- ✅ Mantenha tipo de produto quando cliente especificar (ex: "flores simples" → só flores)
- ✅ Se esvaziar produtos em faixa de preço, ofereça buscar sem limite
- ❌ NÃO misture categorias incompatíveis

### Procedimentos
- ✅ **SEMPRE consulte prompts antes de ações importantes**
- ✅ Siga procedimentos conforme guidelines (prompts)
- ✅ No fechamento, siga os 9 passos do \`closing_protocol_guideline\`

## CONTEXTO DA SESSÃO
${customerName ? `👤 Cliente: ${customerName}` : ""}
${phone ? `📞 Telefone: ${phone}` : ""}
${memory ? `💭 Histórico: ${memory.summary}` : ""}
📦 Produtos já enviados nesta conversa: [${sentProductIds.map((id) => `"${id}"`).join(", ")}]

## EXEMPLO DE RACIOCÍNIO CORRETO

**Cliente**: "Faz entrega em João Pessoa?"

**Seu pensamento**:
1. Tipo: Pergunta sobre área de entrega
2. Ação: Consultar \`delivery_rules_guideline\`
3. [Você invoca o prompt]
4. Guideline retorna: Use resposta padrão
5. Você responde: "Fazemos entregas para Campina Grande (grátis no PIX) e em cidades vizinhas por R$ 15,00 no PIX. No fim do atendimento, um especialista vai te informar tudo certinho! 💕"

**Cliente**: "Quero flores baratas"

**Seu pensamento**:
1. Tipo: Busca de produto com tipo específico + restrição de preço
2. Ação: Consultar \`product_selection_guideline\`
3. [Você invoca o prompt]
4. Guideline retorna: Manter consistência de tipo, usar consultarCatalogo
5. Você usa: \`consultarCatalogo(termo="flores", precoMaximo=120, exclude_product_ids=[...])\`
6. Você apresenta: 2 flores (EXATO), com production_time

**NÃO tente lembrar todas as regras**. Consulte os prompts conforme necessário. Isso te torna mais precisa e atualizada.

Seja carinhosa, empática e prestativa. Siga os procedimentos com naturalidade! 💕`,
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
    // Initial call to see if tools are needed
    const tools = await mcpClientService.listTools();
    const formattedTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const currentResponse = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      tools: formattedTools,
      tool_choice: "auto",
    });

    const responseMessage = currentResponse.choices[0].message;

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      messages.push(responseMessage);

      // Save assistant's tool call message
      await prisma.aIAgentMessage.create({
        data: {
          session_id: sessionId,
          role: "assistant",
          content: responseMessage.content || "",
          tool_calls: JSON.stringify(responseMessage.tool_calls),
        },
      });

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type !== "function") continue;

        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        // Ensure exclude_product_ids is properly passed for consultarCatalogo
        if (name === "consultarCatalogo" && !args.exclude_product_ids) {
          args.exclude_product_ids =
            await this.getSentProductsInSession(sessionId);
          logger.info(
            `🔄 Updated consultarCatalogo args with exclude_product_ids:`,
            args.exclude_product_ids,
          );
        }

        // 🔑 Normalize multi-word search terms for better catalog matching
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

        // ✅ Ensure consultarCatalogo returns exactly 2 products (not 1, not 3+)
        if (name === "consultarCatalogo") {
          // This will be validated AFTER the tool response to filter results
          logger.info(
            `📋 consultarCatalogo call - will enforce 2-product rule on response`,
          );
        }

        // Pre-validate potentially premature tool calls
        if (name === "calculate_freight") {
          const city = args.city || args.cityName || args.city_name;
          const paymentMethod = (
            args.payment_method ||
            args.paymentMethod ||
            args.method ||
            ""
          )
            .toString()
            .trim();
          if (!city || !paymentMethod) {
            const missing = [];
            if (!city) missing.push("cidade");
            if (!paymentMethod)
              missing.push("método de pagamento (PIX ou Cartão)");
            const errorMsg = `{"status":"error","error":"missing_params","message":"Parâmetros ausentes: ${missing.join(", ")}. Pergunte ao cliente: 'Qual é a sua cidade e qual o método de pagamento? PIX ou Cartão?'"}`;

            const syntheticToolMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
              {
                role: "tool",
                tool_call_id: toolCall.id,
                content: errorMsg,
              };
            messages.push(syntheticToolMessage);

            await prisma.aIAgentMessage.create({
              data: {
                session_id: sessionId,
                role: "tool",
                content: errorMsg,
                tool_call_id: toolCall.id,
                name: name,
              } as any,
            });

            continue; // skip executing the tool until missing info is collected
          }
        }

        if (name === "notify_human_support") {
          // If the reason indicates a finalization/checkout flow, enforce strict context
          const reason = (args.reason || args.reason || "").toString();
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
              const errorMsg = `{"status":"error","error":"incomplete_context","message":"Contexto incompleto. Faltando: ${missing.join(", ")}. Por favor colete: Cesta, Data/Hora de entrega, Endereço completo, Método de Pagamento e Frete antes de notificar o atendente."}`;

              const syntheticToolMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
                {
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: errorMsg,
                };
              messages.push(syntheticToolMessage);

              await prisma.aIAgentMessage.create({
                data: {
                  session_id: sessionId,
                  role: "tool",
                  content: errorMsg,
                  tool_call_id: toolCall.id,
                  name: name,
                } as any,
              });

              continue; // don't notify until context is complete
            }
          } else {
            // Generic notification (e.g., "quero falar com um atendente") should be allowed.
            // Ensure we include a customer phone if available so support can contact.
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

            // If no context, add a minimal note so human knows it's a generic request
            if (!context || context.trim() === "") {
              args.customer_context =
                args.customer_context ||
                "Cliente solicitou conversar com um atendente humano. Contexto não fornecido pela IA.";
            }

            logger.info(
              `🔔 notify_human_support allowed as generic request (reason='${reason}') for session ${sessionId}`,
            );
          }
        }

        let result: any;
        try {
          result = await mcpClientService.callTool(name, args);
        } catch (error: any) {
          logger.error(`❌ Error executing MCP tool ${name}: ${error.message}`);
          result = `Erro ao executar ferramenta ${name}: ${error.message}. Por favor, tente novamente ou use outra abordagem.`;
        }

        // Normalize tool output text for downstream handling
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

        // Track sent products to avoid repetition (extract from structured response)
        if (name === "consultarCatalogo") {
          try {
            const parsed =
              typeof result === "object" && result.data
                ? result.data
                : JSON.parse(toolOutputText);

            // 🔒 ENFORCE 2-PRODUCT RULE
            const allProducts = [
              ...(parsed.exatos || []),
              ...(parsed.fallback || []),
            ];

            if (allProducts.length === 0) {
              // No products found - that's okay, let LLM handle it
              logger.info(`📦 consultarCatalogo returned 0 products`);
            } else if (allProducts.length === 1) {
              // Only 1 product found - add instruction to LLM to ask if they want broader search
              logger.warn(
                `⚠️ consultarCatalogo returned only 1 product - LLM should ask to broaden search`,
              );
              // Don't modify the response, just log - the LLM will see only 1 and should ask
            } else if (allProducts.length > 2) {
              // 3+ products - keep only the first 2
              logger.warn(
                `⚠️ consultarCatalogo returned ${allProducts.length} products, limiting to 2`,
              );

              // Rebuild structured response with only 2 products
              const firstTwo = allProducts.slice(0, 2);
              const rebuiltResponse = {
                ...parsed,
                exatos: firstTwo.filter((p) => p.tipo_resultado === "EXATO"),
                fallback: firstTwo.filter(
                  (p) => p.tipo_resultado === "FALLBACK",
                ),
              };
              toolOutputText = JSON.stringify(rebuiltResponse);
              logger.info(
                `✅ Limited to 2 products: ${firstTwo
                  .map((p) => p.id)
                  .join(", ")}`,
              );
            } else {
              // Exactly 2 products - perfect!
              logger.info(`✅ Exactly 2 products returned (ideal)`);
            }

            // Track sent products
            const trackedProducts = [
              ...(parsed.exatos || []),
              ...(parsed.fallback || []),
            ].slice(0, 2); // Only track the ones we're showing (max 2)

            for (const product of trackedProducts) {
              if (product.id) {
                await this.recordProductSent(sessionId, product.id);
                logger.info(
                  `✅ Tracked product ${product.id} (${product.tipo_resultado}) as sent in session ${sessionId}`,
                );
              }
            }
          } catch (e) {
            logger.debug(
              "Could not extract product IDs from consultarCatalogo response",
              e,
            );
          }
        }

        const toolResultMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutputText,
          };

        messages.push(toolResultMessage);

        // Save tool response
        await prisma.aIAgentMessage.create({
          data: {
            session_id: sessionId,
            role: "tool",
            content: toolOutputText,
            tool_call_id: toolCall.id,
            name: name,
          } as any,
        });

        // If notify_human_support succeeded, also save a customer summary to memory (if phone available)
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
              // Fallback to session customer_phone if not provided in args
              if (!customerPhone) {
                const sessRec = await prisma.aIAgentSession.findUnique({
                  where: { id: sessionId },
                });
                customerPhone = sessRec?.customer_phone || "";
              }
              const customerContext =
                args.customer_context || args.customerContext || toolOutputText;
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

      // After tool calls, call LLM again (recursive loop)
      return this.runToolLoop(sessionId, messages);
    }

    // Return final stream
    return this.openai.chat.completions.create({
      model: this.model,
      messages,
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
