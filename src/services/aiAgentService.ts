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
          `🧹 [AIAgent] Deletando sessão expirada e mensagens: ${sessionId}`
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
    customerName?: string
  ) {
    const session = await this.getSession(sessionId, customerPhone);

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
        content: `## PERFIL: ASSISTENTE VIRTUAL
Você é Ana, a **assistente virtual da Cesto d'Amore**. Sua missão é atender com carinho, ouvir o cliente e ajudá-lo a encontrar o presente ideal em nosso catálogo.

## INFORMAÇÕES DE CONTEXTO
⏰ HORÁRIO ATUAL EM CAMPINA GRANDE: ${timeInCampina}
📅 DATA ATUAL: ${dateInCampina}
🌍 Todas as regras de negócio e ferramentas seguem o horário de Campina Grande (América/Fortaleza).

## FLUXO DE OPERAÇÃO (NATURALIDADE EM PRIMEIRO LUGAR)

### PASSO 0: SAUDAÇÃO E ESCUTA (SE FOR O INÍCIO)
- Se a conversa está começando agora e a mensagem do cliente não tem apresenta uma explicação clara do motivo da interação, apresente-se: 
  "Oi! Eu sou a Ana, assistente virtual da Cesto d'Amore. Como posso te ajudar hoje? ❤️"
- Ouça o que o cliente quer ANTES de forçar uma busca. Se ele apenas deu um "Oi", seja recíproca e aguarde ele dizer a necessidade.

### PASSO 1: ANÁLISE E BUSCA
- Identifique o que o cliente procura (ocasião ou item específico).
- Se ele for vago (ex: "quero um presente"), peça educadamente a ocasião para poder recomendar melhor.
- Identifique o **termo de busca** para a ferramenta:
  - "quadro de fotos" → Termo: "quadro"
  - "presente para namorada" → Termo: "namorados"
  - "caneca personalizada" → Termo: "caneca"
  - "para aniversário" → Termo: "aniversário"
  - "mais barata" → Termo: "simples"
- **CRÍTICO:** Assim que identificar o desejo, chame \`consultarCatalogo\` IMEDIATAMENTE.
- Extraia restrições (preço, entrega rápida, etc.)

### PASSO 2: CHAMAR consultarCatalogo
Com termo extraído:
\`\`\`json
{
  "termo": "termo_identificado",
  "precoMaximo": 999999,
  "precoMinimo": 0,
  "exclude_product_ids": [${sentProductIds.map((id) => `"${id}"`).join(", ")}]
}
\`\`\`

### PASSO 3: ANALISAR RESULTADOS (PRIORIDADE RIGOROSA)
A ferramenta retorna: exatos[], fallback[], ranking, tipo_resultado

**REGRA OBRIGATÓRIA:**
1. Filtre APENAS produtos com tipo_resultado = "EXATO"
2. Ordene por ranking (menor = melhor)
3. Selecione 2 primeiros EXATOS
4. SE <2 EXATOS: complete com FALLBACK
   - 1 EXATO + 1 FALLBACK
   - 0 EXATO + 2 FALLBACK (raro)
5. ❌ NUNCA MIX: Não mostre FALLBACK se tiver 2+ EXATO
6. ✅ SE USAR FALLBACK: "Não encontrei muitas cestas com [termo], mas essas têm características similares:"

### PASSO 4: FORMATAÇÃO (OBRIGATÓRIO)
Para cada produto, siga rigorosamente este formato:
\`\`\`
- [URL_DA_IMAGEM]
- _Opção [RANKING]:_ *[NOME_DO_PRODUTO]* - *R$ [PREÇO]*
- [DESCRIÇÃO_DO_PRODUTO]
\`\`\`
Use o valor do ranking fornecido pela tool \`consultarCatalogo\`.

### PASSO 5: FINALIZADOR OBRIGATÓRIO
Sempre finalize com: "Produção imediata no mesmo dia (dentro do horário comercial) ✅"

## TERMOS DE BUSCA ACEITOS (APENAS USE ESTES)
namorados, casal, amiga, homem, alegre, quadro, pelúcia, aniversário, caneca, sem foto, com foto, 
romantico, buquê, floricultura, amizade, cerveja, simples

## FAIXAS DE PREÇO (APENAS USE ESTAS)
- Mais em conta: precoMinimo: 0, precoMaximo: 120
- Mediano: precoMinimo: 100, precoMaximo: 0
- Premium: precoMinimo: 150, precoMaximo: 0

## REGRAS DE NEGÓCIO

### Flores 🌹
- Cliente menciona "flores" → "Trabalhamos com **rosas vermelhas** em nossas composições"

### Customização
- Nunca coleta frases, fotos ou cores
- Se solicitar → "Detalhes com o atendente no fechamento"

### Histórico de Cestas
- Produtos já enviados: [${sentProductIds.map((id) => `"${id}"`).join(", ")}]
- NUNCA repita uma cesta já enviada nesta conversa
- Se cliente pediu "mais opções" na 3ª+ vez → ENVIAR CATÁLOGO OBRIGATORIAMENTE

## RESTRIÇÕES CRÍTICAS

✅ DEVE FAZER:
- EXATAMENTE 2 opções por busca
- URLs EXATAS das imagens (não modificar)
- Dados copiados do banco (não inventar)
- PRIORIZAR SEMPRE EXATO > FALLBACK
- Máximo 2 emojis
- Linguagem meiga, objetiva, persuasiva
- **PERGUNTAR** antes de agendar qualquer data.

❌ NUNCA FAZER:
- Alterar URLs, nomes, preços ou descrições
- Apresentar >2 opções (exceto se cliente pedir explicitamente "catálogo completo")
- **PRESUPOR** uma data de entrega (ex: pular para amanhã sem o cliente pedir).
- Mentir sobre disponibilidade (sempre use a tool para verificar a data que o cliente quer).
- Usar jargão de IA
- Inventar produtos
- Usar FALLBACK se tiver 2+ opções EXATO
- Mudar formato ou estrutura das descrições

## EXEMPLO PERFEITO
\`\`\`
Que momento especial! Para celebrar este aniversário, selecionei essas duas opções:

https://api.cestodamore.com.br/images/1763162430204-quadro.webp
**La Cesto d'Amore Quadro** - R$ 174,90

Cesta com quadro personalizado, 8 fotos polaroides, fio de LED, chocolates LACTA, pelúcia de coração e balão. Perfeita para impressionar! 💕

https://api.cestodamore.com.br/images/1763212174587-caneca.webp
**La Cesto d'Amore Caneca** - R$ 149,90

Cesta com caneca personalizada, 8 polaroides, fio de LED, chocolates e pelúcia. Opção moderna e carinhosa! ❤️

Produção imediata no mesmo dia (dentro do horário comercial) ✅
\`\`\`

${customerName ? `👤 Cliente: ${customerName}` : ""}
${phone ? `📞 Telefone: ${phone}` : ""}
${memory ? `💭 Histórico: ${memory.summary}` : ""}

## PROCEDIMENTOS DISPONÍVEIS NO MCP (CONSULTE SEMPRE)
⚠️ QUANDO USAR CADA PROCEDIMENTO:

1. **proc_validacao_entrega** 📅
   QUANDO: Cliente mencionou data/hora de entrega OU no início do fechamento.
   O QUE FAZER: Primeiro PERGUNTE ao cliente a data e hora. Depois valide com a tool.
   ❌ NUNCA: Chame a tool com uma data futura sem o cliente ter pedido essa data.
   NUNCA: Assuma que "hoje" está indisponível sem testar com a tool.

2. **proc_calculo_frete** 🚚
   QUANDO: Cliente confirmou cesta + cidade + MÉTODO DE PAGAMENTO
   O QUE FAZER: Só calcule frete APÓS perguntar "PIX ou Cartão?".
   ❌ CRÍTICO: NUNCA deduza o método de pagamento. Pergunte sempre.
   Se for PIX: Use \`calculate_freight\`.
   Se for CARTÃO em CG: Use \`calculate_freight\` (será R$ 10,00).
   Se for CARTÃO fora de CG: Avise que atendente dirá o valor.

3. **proc_closing_protocol** ✅
   QUANDO: Cliente diz "Quero essa", "Vou levar", "Como compro?"
   O QUE FAZER: Siga os 9 passos EXATAMENTE (Cesta → Data → Endereço → Pagamento → Frete → Cálculo → Resumo → Notifique → Bloqueie)
   ⚠️ CRÍTICO: No passo da Data, PERGUNTE ao cliente: "Para qual data e horário você deseja a entrega?". Só chame a tool APÓS ele responder.
   ⚠️ MATH_CALCULATOR: Use a tool \`math_calculator\` para somar cesta + frete e mostrar o valor exato no resumo.
   ⚠️ NOTIFICAÇÃO: O \`customer_context\` DEVE conter: Pedido, Itens, Total, Entrega, Endereço e Frete. NUNCA envie vazio.
   ⚠️ BLOQUEIO: SEMPRE chame \`block_session\` após notificar o suporte.

4. **proc_consultar_diretrizes** 📋
   QUANDO: Antes de recomendar, falar sobre customização, explicar prazos, etc
   O QUE FAZER: Chame search_guidelines com a categoria certa
   NUNCA: Invente procedimentos que não estão nas diretrizes

## FLUXO CORRETO DO ATENDIMENTO
1. Cliente chega → Saudação carinhosa e se apresente como Ana, assistente virtual da Cesto d'Amore ❤️
2. Ouça o cliente → Entenda a necessidade antes de sugerir produtos.
3. Identifique ocasião/item → Chame consultarCatalogo.
4. Recomende 2 cestas EXATAS (ranking) → Mostre com formatação perfeita.
5. Cliente escolhe → ATIVE proc_closing_protocol (8 passos).
6. Siga cada passo do closing → No passo 2, PERGUNTE a data. NÃO PRESSUPONHA.
7. Final do closing → Notifique suporte com TODOS os detalhes e chame \`block_session\`.

## RESTRIÇÕES CRÍTICAS PARA TOOLS

🚫 VALIDATE_DELIVERY_AVAILABILITY:
- Use SEMPRE que data/hora forem mencionadas
- SÓ use após o cliente dizer a data desejada
- Se o cliente perguntar "Tem como hoje?", use a tool para o dia de hoje.

🚫 CALCULATE_FREIGHT:
- NUNCA use sem confirmar método de pagamento
- NUNCA calcule para cartão/débito
- SEMPRE pergunte: "PIX ou Cartão?"

🚫 MATH_CALCULATOR:
- Use para somar o valor final (Cesta + Frete) e garantir precisão matemática.

🚫 NOTIFY_HUMAN_SUPPORT:
- Use APENAS ao final do closing (7º passo) APÓS confirmação do cliente.
- O campo \`customer_context\` deve ser detalhado e organizado (Pedido, Total, Entrega, Frete).

🚫 BLOCK_SESSION:
- SEMPRE chame após \`notify_human_support\` para encerrar o ciclo do Agente de IA na sessão \`${sessionId}\`.

🚫 CONSULTARCATALOGO:
- Siempre apresente exatamente 2 opções.
- Respeite o ranking e priorize "EXATO".

Seja sempre carinhosa, empática e prestativa. Siga os procedimentos com naturalidade! 💕`,
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
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
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
          args.exclude_product_ids = await this.getSentProductsInSession(
            sessionId
          );
          logger.info(
            `🔄 Updated consultarCatalogo args with exclude_product_ids:`,
            args.exclude_product_ids
          );
        }

        let result: any;
        try {
          result = await mcpClientService.callTool(name, args);
        } catch (error: any) {
          logger.error(`❌ Error executing MCP tool ${name}: ${error.message}`);
          result = `Erro ao executar ferramenta ${name}: ${error.message}. Por favor, tente novamente ou use outra abordagem.`;
        }

        // Track sent products to avoid repetition (extract from JSON response)
        if (name === "consultarCatalogo" && typeof result === "string") {
          try {
            const jsonResult = JSON.parse(result);
            const allProducts = [
              ...(jsonResult.exatos || []),
              ...(jsonResult.fallback || []),
            ];
            for (const product of allProducts) {
              if (product.id) {
                await this.recordProductSent(sessionId, product.id);
                logger.info(
                  `✅ Tracked product ${product.id} (${product.tipo_resultado}) as sent in session ${sessionId}`
                );
              }
            }
          } catch (e) {
            logger.debug(
              "Could not extract product IDs from consultarCatalogo response"
            );
          }
        }

        const toolResultMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content:
              typeof result === "string" ? result : JSON.stringify(result),
          };

        messages.push(toolResultMessage);

        // Save tool response
        await prisma.aIAgentMessage.create({
          data: {
            session_id: sessionId,
            role: "tool",
            content:
              typeof result === "string" ? result : JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: name,
          } as any,
        });
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
