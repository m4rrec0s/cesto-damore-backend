import OpenAI from "openai";
import prisma from "../database/prisma";
import mcpClientService from "./mcpClientService";
import logger from "../utils/logger";
import { addDays, isPast } from "date-fns";

// Fases do atendimento estruturado
enum AttendancePhase {
  CONNECT = "CONNECT",
  UNDERSTAND = "UNDERSTAND",
  RESOLVE = "RESOLVE",
  FOLLOWUP = "FOLLOWUP",
}

// Estados internos do processamento
enum ProcessingState {
  ANALYZING = "ANALYZING", // Analisando a mensagem do usuário
  GATHERING_DATA = "GATHERING_DATA", // Coletando dados via tools
  SYNTHESIZING = "SYNTHESIZING", // Sintetizando informações coletadas
  READY_TO_RESPOND = "READY_TO_RESPOND", // Pronto para responder
}

interface QueuedMessage {
  userMessage: string;
  customerPhone: string;
  customerName?: string;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

interface ToolExecutionResult {
  toolName: string;
  input: any;
  output: string;
  success: boolean;
}

class AIAgentServiceImproved {
  private openai: OpenAI;
  private model: string = "gpt-4o-mini";

  // Sistema de fila por sessão
  private messageQueues: Map<string, QueuedMessage[]> = new Map();
  private processingFlags: Map<string, boolean> = new Map();

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * SISTEMA DE PROMPTS MELHORADO
   * ═══════════════════════════════════════════════════════════════
   */

  /**
   * RAG Dinâmico: Detecta contexto da mensagem e retorna prompts relevantes
   */
  private detectContextualPrompts(userMessage: string): string[] {
    const messageLower = userMessage.toLowerCase();

    const contextMap = [
      {
        patterns: [
          /entrega|João pessoa|Queimadas|Galante|Puxinanã|São José|cobertura|cidad|faz entrega/i,
        ],
        prompt: "delivery_rules_guideline",
        priority: 1,
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

    const matched = contextMap
      .filter((ctx) =>
        ctx.patterns.some((pattern) => pattern.test(messageLower)),
      )
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 2)
      .map((ctx) => ctx.prompt);

    const uniquePrompts = [...new Set(matched)];
    return ["core_identity_guideline", ...uniquePrompts];
  }

  /**
   * Busca as principais guidelines do MCP usando RAG dinâmico
   */
  private async getGuidelinesFromMCP(userMessage: string): Promise<string> {
    try {
      const relevantPrompts = this.detectContextualPrompts(userMessage);

      const promptResponses = await Promise.all(
        relevantPrompts.map((promptName) =>
          mcpClientService.getPrompt(promptName).catch((e) => {
            logger.warn(`⚠️ Prompt "${promptName}" não encontrado`, e);
            return null;
          }),
        ),
      );

      const mcpSystemPrompts = promptResponses
        .filter(
          (response): response is NonNullable<typeof response> =>
            response !== null,
        )
        .map((response) => {
          const content = response.messages[0].content;
          if (content.type === "text") {
            return content.text;
          }
          return "";
        })
        .join("\n\n");

      return mcpSystemPrompts;
    } catch (error) {
      logger.warn("⚠️ Erro ao buscar guidelines do MCP:", error);
      return "";
    }
  }

  private async getSystemPrompt(
    userMessage: string,
    sessionId: string,
    customerPhone?: string,
    customerName?: string,
  ): Promise<string> {
    const mcpGuidelines = await this.getGuidelinesFromMCP(userMessage);

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

    // Calcula "amanhã" corretamente
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowInCampina = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Fortaleza",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(tomorrow);

    const [h] = timeInCampina.split(":").map(Number);
    let greeting = "Bom dia";
    if (h >= 12 && h < 18) {
      greeting = "Boa tarde";
    } else if (h >= 18) {
      greeting = "Boa noite";
    }

    const dayOfWeek = now
      .toLocaleDateString("en-US", {
        timeZone: "America/Fortaleza",
        weekday: "long",
      })
      .toLowerCase();
    const [hour, m] = timeInCampina.split(":").map(Number);
    const curMin = hour * 60 + m;
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
      : "FECHADA (Fora do expeditário ⏰)";

    const sentProducts = await prisma.aISessionProductHistory.findMany({
      where: { session_id: sessionId },
      select: { product_id: true },
    });
    const sentProductIds = sentProducts.map((sp) => sp.product_id);

    return `${mcpGuidelines}

## ⚠️ REGRA CRÍTICA DE SILÊNCIO E USO DE FERRAMENTAS
**NUNCA** envie mensagens de "Um momento", "Vou procurar", "Deixa eu ver" ou "Aguarde".
**SILÊNCIO TOTAL DURANTE TOOL CALLS**: Se você decidir chamar uma Tool, mantenha o campo \`content\` da sua mensagem **COMPLETAMENTE VAZIO**.

**USO OBRIGATÓRIO DE FERRAMENTAS**:
- Se o cliente menciona QUALQUER produto/cesta: USE \`consultarCatalogo\` IMEDIATAMENTE
- Se o cliente pergunta sobre entrega/horário: USE \`validate_delivery_availability\`
- Se o cliente fornece endereço: USE \`calculate_freight\`

## ⛔ PROIBIÇÕES ABSOLUTAS - INFORMAÇÕES SENSÍVEIS
**NUNCA mencione:**
- ❌ Chave PIX, endereço da loja, dados bancários
**SE PERGUNTAREM:** "O pagamento é processado pelo nosso time especializado após a confirmação! 🔒"

## INFORMAÇÕES DE CONTEXTO TEMPORAL
📅 **DATA HOJE**: ${dateInCampina}
📅 **DATA AMANHÃ**: ${tomorrowInCampina}
⏰ **HORÁRIO ATUAL**: ${timeInCampina}
🏪 **STATUS DA LOJA**: ${storeStatus}
👋 **SAUDAÇÃO**: ${greeting}

⚠️ **ATENÇÃO**: Use EXATAMENTE estas datas ao falar com cliente. "Hoje" = ${dateInCampina}, "Amanhã" = ${tomorrowInCampina}

## ⛔ CIDADES DE ENTREGA (NÃO INVENTE!)
✅ Campina Grande, Queimadas, Galante, Puxinanã, São José da Mata
❌ NUNCA mencione outras cidades ou "até 20km"

## REGRAS CRÍTICAS

✅ **CANECAS** (REGRA OBRIGATÓRIA):
   - Se o produto contiver "caneca" no nome: SEMPRE adicione esta mensagem:
   "🎁 Essa cesta tem canecas! Temos de pronta entrega (1h) e customizáveis com fotos/nomes (18h). Qual você prefere?"
   - Personalizadas = 18h comerciais | Prontas = 1h
   - Pergunte ANTES de validar horário de entrega

✅ **SEMPRE 2 PRODUTOS** por vez (nunca 1, 3 ou 4)
✅ **FORMATO OBRIGATÓRIO**:
https://api.cestodamore.com.br/images/produto.webp
_Opção 1_ - Nome - R$ 100
(Produção: 1h ✅)

⚠️ **VALIDAÇÃO DE PRODUÇÃO**: Se production_time > 18h e cliente quer hoje → NÃO ofereça hoje
⚠️ **ÁREAS DE ENTREGA**: "Fazemos entregas para Campina Grande e cidades vizinhas! Especialista confirma no final 💕"
✅ **PAGAMENTO**: Pergunte "PIX ou Cartão?" mas NUNCA mencione chave PIX
🧠 **MEMÓRIA**: USE \`save_customer_summary\` após cliente escolher produto, data, endereço ou pagamento

## CONTEXTO DA SESSÃO
${customerName ? `👤 ${customerName}` : ""}
${customerPhone ? `📞 ${customerPhone}` : ""}
📦 Produtos enviados: [${sentProductIds.join(", ")}]

# REGRAS CRÍTICAS DE COMPORTAMENTO

## MODO DE OPERAÇÃO EM DUAS FASES

Você opera em DUAS FASES DISTINTAS:

### FASE 1: COLETA DE INFORMAÇÕES (INTERNA)
Nesta fase você:
- APENAS usa tools para coletar dados
- NÃO gera mensagens para o cliente
- NÃO tenta responder ainda
- Foca em reunir TODAS as informações necessárias

**Como indicar que está nesta fase:**
- Use tools normalmente (tool_calls)
- A LLM vai receber os resultados e continuar coletando
- Continue até ter TODAS as informações necessárias

### FASE 2: RESPOSTA AO CLIENTE (FINAL)
Nesta fase você:
- JÁ TEM todas as informações necessárias
- ORGANIZA os dados coletados de forma clara
- GERA UMA ÚNICA mensagem completa e bem estruturada
- NUNCA menciona detalhes técnicos (tools, processamento, etc)

**Como indicar que está nesta fase:**
- Retorne a mensagem final SEM tool_calls
- A mensagem deve ser natural, amigável e direta
- Organize as informações de forma visual (use emojis)

## EXEMPLO DE FLUXO CORRETO

**Mensagem do cliente:** "Quero uma cesta para aniversário de 150 reais"

**FASE 1 - Coleta (INTERNO, cliente não vê):**
1. [Usa tool: consultarCatalogo com termo="aniversário", precoMaximo=150]
2. [Recebe resultados: 3 produtos encontrados]
3. [Usa tool: get_adicionais para ver complementos]
4. [Recebe resultados: chocolates e ursos disponíveis]
5. **AGORA tem todas as informações → Passa para FASE 2**

**FASE 2 - Resposta (VISÍVEL ao cliente):**
"Que ótimo! Encontrei algumas opções perfeitas para aniversário até R$ 150! 🎉

🎁 **Opção 1: Cesta Celebration** - R$ 137,90
Perfeita para celebrar! Inclui vinho, chocolates nobres e itens gourmet.
⏱️ Pronta para entrega no mesmo dia!

🎂 **Opção 2: Kit Aniversário Premium** - R$ 149,90  
Completíssima! Espumante, chocolates, taças e decoração especial.
⏱️ Precisamos de 4 horas para preparar com carinho.

💝 Posso incrementar com:
- Ursinho de pelúcia (+R$ 25)
- Chocolates extras (+R$ 15)

Qual dessas opções te agradou mais?"

## REGRAS ABSOLUTAS

1. **NUNCA misture tool calls com mensagem ao cliente**
   ❌ ERRADO: Retornar texto + tool_calls juntos
   ✅ CERTO: OU tool_calls (fase 1) OU texto final (fase 2)

2. **NUNCA exponha detalhes técnicos ao cliente**
   ❌ ERRADO: "Vou consultar o catálogo...", "Verificando disponibilidade..."
   ✅ CERTO: Apenas use as tools silenciosamente

3. **ORGANIZE informações antes de responder**
   ❌ ERRADO: Responder incrementalmente conforme coleta
   ✅ CERTO: Coletar TUDO, depois montar UMA resposta organizada

4. **Use linguagem natural e amigável**
   ❌ ERRADO: "Produto ID 123: R$ 100,00 - 2h produção"
   ✅ CERTO: "Cesta Amor Perfeito - R$ 100 (preparamos em 2h) 💕"

## FERRAMENTAS DISPONÍVEIS

Você tem acesso às seguintes ferramentas MCP (use livremente na FASE 1):

- **consultarCatalogo**: Busca produtos por termo/preço
- **get_adicionais**: Lista itens extras (balões, chocolates, etc)
- **validate_delivery_availability**: Valida data/hora de entrega
- **get_active_holidays**: Lista feriados/fechamentos
- **calculate_freight**: Calcula frete por cidade
- **get_current_business_hours**: Verifica horário de funcionamento
- **save_customer_summary**: Salva resumo do pedido
- **notify_human_support**: Transfere para humano
- **block_session**: Bloqueia sessão após transferir

## FLUXO DE ATENDIMENTO

1. **Saudação** (CONNECT)
   - Seja calorosa e acolhedora
   - Pergunte como pode ajudar

2. **Entendimento** (UNDERSTAND)
   - Identifique: ocasião, orçamento, preferências
   - Use tools para buscar opções relevantes
   - NÃO responda ainda, apenas colete

3. **Solução** (RESOLVE)
   - Organize TODAS as informações coletadas
   - Monte UMA resposta completa e estruturada
   - Apresente opções de forma visual e clara
   - Sempre mencione tempo de produção

4. **Fechamento**
   - Facilite a decisão do cliente
   - Ofereça próximos passos claros

## TRATAMENTO DE CASOS ESPECIAIS

**Cliente pede "mais opções":**
- Use exclude_product_ids com IDs já enviados
- Busque novos produtos
- Apresente de forma organizada novamente

**Cliente quer personalização:**
- Explique que canecas/quadros customizados levam 18h
- Itens prontos podem sair no mesmo dia
- Sempre seja clara sobre prazos

**Problema ou dúvida complexa:**
- Use notify_human_support com contexto completo
- IMEDIATAMENTE após, use block_session
- Informe o cliente de forma tranquilizadora

Lembre-se: Seja eficiente, organizada e sempre coloque a experiência do cliente em primeiro lugar! 💕`;
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

Gere APENAS a mensagem final para o cliente.`;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * VALIDAÇÃO E LIMPEZA DE MENSAGENS
   * ═══════════════════════════════════════════════════════════════
   */

  private validateAndCleanMessage(message: string): string | null {
    if (!message || message.trim().length === 0) return null;

    let cleaned = message.trim();

    // Remove marcadores que não devem aparecer
    cleaned = cleaned.replace(/\[INTERNO\].*?(?=\n[^\[]|$)/gs, "");
    cleaned = cleaned.replace(/\[THINK\]/gi, "");
    cleaned = cleaned.replace(/\[DEBUG\].*?$/gm, "");
    cleaned = cleaned.replace(/\[SEND\]/gi, "");
    cleaned = cleaned.replace(/\[DONE\]/gi, "");

    // Remove múltiplas quebras de linha
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    cleaned = cleaned.replace(/ {2,}/g, " ");

    // Validações
    if (cleaned.length < 3) return null;
    if (cleaned.length > 2000) {
      cleaned = cleaned.substring(0, 1997) + "...";
    }

    return cleaned.trim();
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * SISTEMA DE FILA DE MENSAGENS
   * ═══════════════════════════════════════════════════════════════
   */

  async chatIncremental(
    sessionId: string,
    userMessage: string,
    customerPhone: string,
    customerName?: string,
  ): Promise<{ output: string }> {
    return new Promise((resolve, reject) => {
      const queuedMessage: QueuedMessage = {
        userMessage,
        customerPhone,
        customerName,
        resolve,
        reject,
      };

      if (!this.messageQueues.has(sessionId)) {
        this.messageQueues.set(sessionId, []);
      }

      this.messageQueues.get(sessionId)!.push(queuedMessage);

      const queueLength = this.messageQueues.get(sessionId)!.length;
      logger.info(
        `📥 Message queued for session ${sessionId} (queue length: ${queueLength})`,
      );

      this.processQueue(sessionId).catch((error) => {
        logger.error(`❌ Error processing queue for ${sessionId}:`, error);
      });
    });
  }

  private async processQueue(sessionId: string): Promise<void> {
    if (this.processingFlags.get(sessionId)) {
      logger.info(`⏳ Session ${sessionId} already processing, waiting...`);
      return;
    }

    const queue = this.messageQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      logger.info(`📭 No messages in queue for session ${sessionId}`);
      return;
    }

    this.processingFlags.set(sessionId, true);
    logger.info(`🔒 Locked processing for session ${sessionId}`);

    try {
      while (queue.length > 0) {
        const message = queue.shift()!;

        logger.info(
          `🔄 Processing message for session ${sessionId} (${queue.length} remaining)`,
        );

        try {
          const result = await this.processMessage(
            sessionId,
            message.userMessage,
            message.customerPhone,
            message.customerName,
          );
          logger.info(`✅ Message processed successfully`);
          message.resolve(result);
        } catch (error) {
          logger.error(`❌ Error processing message: ${error}`);
          message.reject(error);
        }
      }
    } finally {
      this.processingFlags.set(sessionId, false);
      logger.info(`🔓 Unlocked processing for session ${sessionId}`);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * PROCESSAMENTO PRINCIPAL DA MENSAGEM
   * ═══════════════════════════════════════════════════════════════
   */

  private async processMessage(
    sessionId: string,
    userMessage: string,
    customerPhone: string,
    customerName?: string,
  ): Promise<{ output: string }> {
    const session = await this.getSession(sessionId, customerPhone);

    if (!session) {
      throw new Error("Session not found");
    }

    // Verifica se sessão está bloqueada
    if (session.is_blocked) {
      const blockedMessage =
        "Sua solicitação foi encaminhada para nossa equipe especializada! Em breve você será atendido por um humano. 💕";
      logger.info(`📤 Mensagem (sessão bloqueada): ${blockedMessage}`);
      return { output: blockedMessage };
    }

    // Salva mensagem do usuário
    await prisma.aIAgentMessage.create({
      data: {
        session_id: session.id,
        role: "user",
        content: userMessage,
      },
    });

    // Obtém histórico limpo
    const history = await this.getCleanedHistory(session.id);

    // Obtém ferramentas MCP
    const tools = await mcpClientService.listTools();

    // Obtém o system prompt com guidelines do MCP e RAG dinâmico
    const systemPrompt = await this.getSystemPrompt(
      userMessage,
      sessionId,
      customerPhone,
      customerName,
    );

    // Monta mensagens para OpenAI
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...history,
      {
        role: "user",
        content: userMessage,
      },
    ];

    // EXECUTA O LOOP DE PROCESSAMENTO EM DUAS FASES
    const aiMessage = await this.runTwoPhaseProcessing(
      sessionId,
      messages,
      customerPhone,
      tools,
    );

    return { output: aiMessage };
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * PROCESSAMENTO EM DUAS FASES (核心改进)
   * ═══════════════════════════════════════════════════════════════
   */

  private async runTwoPhaseProcessing(
    sessionId: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    customerPhone: string,
    tools: any[],
  ): Promise<string> {
    const MAX_TOOL_ITERATIONS = 10; // Limite de iterações para coleta
    let currentState = ProcessingState.ANALYZING;
    let toolExecutionResults: ToolExecutionResult[] = [];

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

        // Adiciona mensagem assistant ao contexto
        messages.push({
          role: "assistant",
          content: responseMessage.content || "",
          tool_calls: responseMessage.tool_calls as any,
        });

        // Salva no banco
        await prisma.aIAgentMessage.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: responseMessage.content || "",
            tool_calls: JSON.stringify(responseMessage.tool_calls),
          },
        });

        // Executa cada tool
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== "function") continue;

          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          logger.info(`🔧 Chamando: ${toolName}(${JSON.stringify(toolArgs)})`);

          let result: any;
          let success = true;

          try {
            result = await mcpClientService.callTool(toolName, toolArgs);
          } catch (error: any) {
            logger.error(`❌ Erro na tool ${toolName}: ${error.message}`);
            result = `Erro ao executar ${toolName}: ${error.message}`;
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
            toolName,
            input: toolArgs,
            output: toolOutputText,
            success,
          });

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
              name: toolName,
            } as any,
          });
        }

        // Continua o loop para processar os resultados
        continue;
      }

      // Se NÃO há tool_calls, significa que a LLM decidiu que tem informações suficientes
      // Passamos para FASE 2
      logger.info(
        "✅ FASE 1 Concluída: Todas as informações necessárias foram coletadas",
      );
      currentState = ProcessingState.READY_TO_RESPOND;
      break;
    }

    // ═══════════════════════════════════════════════════════════════
    // FASE 2: SÍNTESE E RESPOSTA AO CLIENTE
    // ═══════════════════════════════════════════════════════════════

    if (currentState !== ProcessingState.READY_TO_RESPOND) {
      logger.warn(
        "⚠️ Limite de iterações atingido, forçando resposta ao cliente",
      );
    }

    logger.info("📝 FASE 2: Gerando resposta organizada para o cliente...");

    // Remove tools da próxima chamada para forçar apenas texto
    // Adiciona prompt de síntese se houveram tools executadas
    if (toolExecutionResults.length > 0) {
      messages.push({
        role: "system",
        content: this.getSynthesisPrompt(toolExecutionResults),
      });
    }

    const finalResponse = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      // NÃO envia tools nesta chamada - força apenas resposta textual
      stream: false,
    });

    const finalMessage = finalResponse.choices[0].message.content;

    if (!finalMessage || finalMessage.trim().length === 0) {
      logger.error("❌ LLM não gerou resposta final!");
      const errorMessage =
        "Desculpe, tive um problema ao processar sua mensagem. Pode tentar novamente? 🙏";

      await prisma.aIAgentMessage.create({
        data: {
          session_id: sessionId,
          role: "assistant",
          content: errorMessage,
          sent_to_client: true,
        },
      });

      return errorMessage;
    }

    // Valida e limpa a mensagem
    const cleanedMessage = this.validateAndCleanMessage(finalMessage);

    if (!cleanedMessage) {
      logger.error("❌ Mensagem final inválida após limpeza!");
      const errorMessage =
        "Desculpe, não consegui processar sua mensagem adequadamente. 😔";

      await prisma.aIAgentMessage.create({
        data: {
          session_id: sessionId,
          role: "assistant",
          content: errorMessage,
          sent_to_client: true,
        },
      });

      return errorMessage;
    }

    logger.info(
      `✅ Resposta final gerada: ${cleanedMessage.substring(0, 150)}...`,
    );

    // Salva no banco
    await prisma.aIAgentMessage.create({
      data: {
        session_id: sessionId,
        role: "assistant",
        content: cleanedMessage,
        sent_to_client: true,
      },
    });

    // Adiciona ao contexto para futuras interações
    messages.push({
      role: "assistant",
      content: cleanedMessage,
    });

    logger.info(`📤 Mensagem gerada: ${cleanedMessage.substring(0, 100)}...`);
    logger.info("🎉 Processamento completo! Mensagem retornada.");

    return cleanedMessage;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * GERENCIAMENTO DE SESSÃO E HISTÓRICO
   * ═══════════════════════════════════════════════════════════════
   */

  private async getSession(sessionId: string, customerPhone: string) {
    let session = await prisma.aIAgentSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      session = await prisma.aIAgentSession.create({
        data: {
          id: sessionId,
          customer_phone: customerPhone,
          expires_at: addDays(new Date(), 1), // Expira em 24 horas
        },
      });
    }

    return session;
  }

  private async getCleanedHistory(
    sessionId: string,
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    const dbHistory = await prisma.aIAgentMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: "asc" },
    });

    // Identifica tool_calls órfãos
    const assistantToolCallIds = new Set<string>();
    const toolResponseIds = new Set<string>();

    for (const msg of dbHistory) {
      if (msg.role === "assistant" && msg.tool_calls) {
        try {
          const toolCalls = JSON.parse(msg.tool_calls);
          toolCalls.forEach((tc: any) => assistantToolCallIds.add(tc.id));
        } catch (e) {
          // Ignora tool_calls inválidos
        }
      }

      if (msg.role === "tool" && msg.tool_call_id) {
        toolResponseIds.add(msg.tool_call_id);
      }
    }

    const orphanedToolCallIds = new Set(
      [...assistantToolCallIds].filter((id) => !toolResponseIds.has(id)),
    );

    // Remove mensagens órfãs
    const cleanHistory: any[] = [];

    for (const msg of dbHistory) {
      // Remove assistant com tool_calls órfãos
      if (msg.role === "assistant" && msg.tool_calls) {
        try {
          const toolCalls = JSON.parse(msg.tool_calls);
          const hasOrphanedCall = toolCalls.some((tc: any) =>
            orphanedToolCallIds.has(tc.id),
          );

          if (hasOrphanedCall) {
            logger.warn(`⚠️ Removendo assistant órfã: ${msg.id}`);
            continue;
          }
        } catch (e) {
          logger.warn(`⚠️ Removendo assistant com tool_calls inválido`);
          continue;
        }
      }

      // Remove tool órfão
      if (
        msg.role === "tool" &&
        msg.tool_call_id &&
        orphanedToolCallIds.has(msg.tool_call_id)
      ) {
        logger.warn(`⚠️ Removendo tool órfã: ${msg.id}`);
        continue;
      }

      cleanHistory.push(msg);
    }

    // Limita a 10 mensagens de usuário
    if (cleanHistory.length <= 10) {
      return this.convertToOpenAIFormat(cleanHistory);
    }

    const filtered: any[] = [];
    let userMessageCount = 0;
    const MAX_USER_MESSAGES = 10;

    for (let i = cleanHistory.length - 1; i >= 0; i--) {
      const msg = cleanHistory[i];

      if (msg.role === "user") {
        userMessageCount++;
        if (userMessageCount > MAX_USER_MESSAGES) break;
      }

      filtered.unshift(msg);
    }

    return this.convertToOpenAIFormat(filtered);
  }

  private convertToOpenAIFormat(
    dbMessages: any[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return dbMessages.map((msg) => {
      if (msg.role === "assistant" && msg.tool_calls) {
        return {
          role: "assistant" as const,
          content: msg.content || "",
          tool_calls: JSON.parse(msg.tool_calls),
        };
      }

      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        };
      }

      return {
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      };
    });
  }
}

export default new AIAgentServiceImproved();
