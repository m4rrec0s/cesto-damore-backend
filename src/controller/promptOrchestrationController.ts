import { Router, Request, Response } from "express";
import OpenAI from "openai";
import prisma from "../database/prisma";
import { INTENT_TO_PROMPT, INTENT_KEYWORDS, PROMPTS } from "../config/prompts";

interface OrchestrationRequest {
  customer_phone: string;
  customer_name?: string;
  session_id?: string;
  latest_message: string;
}

interface OrchestrationResponse {
  status: "success" | "error";
  finalPrompt?: string;
  selectedPrompts?: string[];
  intent?: string;
  session_id?: string;
  is_first_message?: boolean;
  should_activate_agente_contexto?: boolean;
  customer_memory?: any;
  error?: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Detectar intenção usando LLM (OpenAI) para análise inteligente
 */
async function detectIntentWithLLM(
  message: string,
  messageHistory: any[] = [],
  customerMemory: any = null
): Promise<string> {
  try {
    const historyContext = messageHistory
      .slice(-5)
      .map((msg: any) => `${msg.role || "user"}: ${msg.content || msg.message}`)
      .join("\n");

    const memoryContext = customerMemory
      ? `Cliente: ${customerMemory.summary || "Sem notas"}`
      : "";

    const systemPrompt = `Você é um analisador de intenção de clientes para uma floricultura.
Baseado na mensagem do cliente e contexto, detecte APENAS UMA intenção.

Intenções possíveis:
- greeting: Saudação ou conversa inicial
- product_search: Busca de produtos, "quero ver cestas", "qual vocês têm"
- delivery_check: Perguntas sobre entrega, frete, data
- customization: Quer personalizar com foto, nome, frase
- checkout: Pronto para comprar, "como faço pedido", dados de pagamento
- human_transfer: Quer falar com atendente/pessoa
- indecision: Não sabe qual escolher, pede recomendação
- mass_order: Pedido em lote para evento/empresa
- location_info: Quer saber onde fica, endereço da loja
- inexistent_product: Pergunta por produto que não temos
- production_faq: Perguntas sobre tempo de produção/prazo

Retorne APENAS o nome da intenção, sem aspas ou explicação.`;

    const userPrompt = `
Contexto de histórico (últimas mensagens):
${historyContext || "Primeira mensagem"}

Contexto de memória:
${memoryContext || "Sem histórico anterior"}

Mensagem atual do cliente:
"${message}"

Qual é a intenção? Responda com UMA PALAVRA apenas (o nome da intenção).`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 20,
    });

    const detected = response.choices[0]?.message?.content?.trim().toLowerCase() || "greeting";

    // Validar se é uma intenção conhecida
    const validIntents = Object.keys(INTENT_TO_PROMPT);
    if (validIntents.includes(detected)) {
      console.log(`[PromptOrchestration] Intent detectada por LLM: ${detected}`);
      return detected;
    }

    // Fallback para keyword matching se LLM retornar intenção desconhecida
    console.log(`[PromptOrchestration] Intent desconhecida: ${detected}, usando fallback`);
    return detectIntentWithKeywords(message, messageHistory);
  } catch (error) {
    console.error(`[PromptOrchestration] Erro ao detectar intent com LLM:`, error);
    // Fallback para keyword matching
    return detectIntentWithKeywords(message, messageHistory);
  }
}
 
/**
 * Fallback: Detectar intenção usando keywords (método rápido)
 */
function detectIntentWithKeywords(message: string, messageHistory: any[] = []): string {
  const messageLower = message.toLowerCase().trim();

  // Priority: human_transfer
  if (INTENT_KEYWORDS.human_transfer.some((kw: string) => messageLower.includes(kw))) {
    return "human_transfer";
  }

  // Detectar outras intenções
  let bestMatch = "greeting";
  let maxMatches = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const matches = (keywords as string[]).filter((kw: string) => messageLower.includes(kw)).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = intent;
    }
  }

  // Contexto do histórico se nenhuma keyword
  if (maxMatches === 0 && messageHistory.length > 0) {
    const recentMessages = messageHistory.slice(-5);
    const hasCheckoutContext = recentMessages.some((msg: any) =>
      (msg.content || msg.message)?.toLowerCase().includes("data") ||
      (msg.content || msg.message)?.toLowerCase().includes("endereco") ||
      (msg.content || msg.message)?.toLowerCase().includes("pagamento")
    );

    if (hasCheckoutContext) {
      return "checkout";
    }
  }

  return bestMatch;
}

/**
 * Carregar histórico de chat da tabela n8n_chat_histories
 */
async function loadChatHistory(sessionId: string): Promise<any[]> {
  try {
    // Usar raw query porque o modelo pode não estar totalmente gerado
    const messages = await prisma.$queryRaw<any[]>`
      SELECT * FROM n8n_chat_histories 
      WHERE session_id = ${sessionId} 
      ORDER BY id ASC 
      LIMIT 20
    `;
    return messages || [];
  } catch (error) {
    console.error(`[PromptOrchestration] Erro ao carregar histórico: ${error}`);
    return [];
  }
}

/**
 * Carregar memória longa do cliente
 */
async function loadCustomerMemory(customerPhone: string): Promise<any> {
  try {
    const memory = await prisma.customerMemory.findUnique({
      where: { customer_phone: customerPhone },
    });
    return memory || null;
  } catch (error) {
    console.error(`[PromptOrchestration] Erro ao carregar memória: ${error}`);
    return null;
  }
}

/**
 * Criar ou verificar AIAgentSession (camada de segurança)
 */
async function ensureAIAgentSession(
  customerPhone: string,
  sessionId?: string,
  customerName: string = "Cliente"
): Promise<string> {
  try {
    // Se session_id não for fornecido, gerar um novo
    const finalSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Verificar se session já existe
    let session = await prisma.aIAgentSession.findUnique({
      where: { id: finalSessionId },
    });

    // Se não existe, criar nova
    if (!session) {
    session = await prisma.aIAgentSession.create({
      data: {
        id: finalSessionId,
        customer_phone: customerPhone,
        expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days expiry
        is_blocked: false,
      },
    });

      console.log(`[PromptOrchestration] Novo AIAgentSession criado: ${finalSessionId}`);
    }

    return finalSessionId;
  } catch (error) {
    console.error(`[PromptOrchestration] Erro ao criar/verificar session: ${error}`);
    throw error;
  }
}

/**
 * Selecionar prompts finais em ordem obrigatória
 * ORDEM CORRETA:
 * 1. core_ana_identity (sempre primeiro)
 * 2. Prompts específicos da intenção (máximo 3 adicionais)
 * 3. core_critical_rules (sempre último)
 * 
 * Retorna: { finalPrompt: string, selectedPrompts: string[] }
 */
function buildFinalPrompts(
  intent: string,
  customerMemory: any,
  messageHistory: any[]
): { finalPrompt: string; selectedPrompts: string[] } {
  const prompts: string[] = [];
  const selectedPrompts: string[] = [];
  let additionalPromptCount = 0;
  const MAX_ADDITIONAL_PROMPTS = 3;

  // 1. SEMPRE PRIMEIRO - core_ana_identity (obrigatório)
  prompts.push(PROMPTS.core_ana_identity);
  prompts.push("\n---\n");
  selectedPrompts.push("core_ana_identity");

  // 2. Prompt específico da intenção (conta como 1 adicional)
  const intentPrompt = INTENT_TO_PROMPT[intent] || PROMPTS.greeting;
  prompts.push(intentPrompt);
  selectedPrompts.push(intent || "greeting");
  additionalPromptCount++;

  // 2.1 Adicionar contexto de memória se disponível (conta como 1 adicional)
  if (customerMemory && customerMemory.summary && additionalPromptCount < MAX_ADDITIONAL_PROMPTS) {
    prompts.push("\n---\n");
    prompts.push(`[CONTEXTO DO CLIENTE]\n${customerMemory.summary}`);
    selectedPrompts.push("customer_memory_context");
    additionalPromptCount++;
  }

  // 3. SEMPRE ÚLTIMO - core_critical_rules (obrigatório, não conta como adicional)
  prompts.push("\n---\n");
  prompts.push(PROMPTS.core_critical_rules);
  selectedPrompts.push("core_critical_rules");

  return {
    finalPrompt: prompts.join("\n"),
    selectedPrompts,
  };
}

/**
 * Handler da rota de orquestração de prompts
 */
export async function orchestratePrompt(
  req: Request<{}, {}, OrchestrationRequest>,
  res: Response<OrchestrationResponse>
): Promise<Response<OrchestrationResponse> | undefined> {
  try {
    const {
      customer_phone,
      customer_name = "Cliente",
      session_id,
      latest_message,
    } = req.body;

    // Validações obrigatórias
    if (!customer_phone) {
      return res.status(400).json({
        status: "error",
        error: "customer_phone é obrigatório",
      });
    }

    if (!latest_message) {
      return res.status(400).json({
        status: "error",
        error: "latest_message é obrigatório",
      });
    }

    console.log(`[PromptOrchestration] Processando: ${customer_phone} | ${latest_message.substring(0, 50)}...`);

    // 1. SEGURANÇA: Criar/verificar AIAgentSession
    const finalSessionId = await ensureAIAgentSession(
      customer_phone,
      session_id,
      customer_name
    );

    // 2. Carregar histórico de chat
    const chatHistory = await loadChatHistory(finalSessionId);

    // 3. Carregar memória longa do cliente
    const customerMemory = await loadCustomerMemory(customer_phone);

    // 4. Detectar intenção com LLM (análise inteligente)
    const intent = await detectIntentWithLLM(latest_message, chatHistory, customerMemory);

    console.log(`[PromptOrchestration] Intenção detectada por LLM: ${intent}`);

    // 5. Construir prompts na ordem obrigatória (máximo 3 adicionais)
    const { finalPrompt, selectedPrompts } = buildFinalPrompts(intent, customerMemory, chatHistory);

    // 6. Determinar se é primeira mensagem
    const isFirstMessage = !customerMemory || chatHistory.length <= 1;
    const shouldActivateAgenteContexto = isFirstMessage;

    // 7. Retornar resposta estruturada
    return res.status(200).json({
      status: "success",
      finalPrompt,
      selectedPrompts,
      intent,
      session_id: finalSessionId,
      is_first_message: isFirstMessage,
      should_activate_agente_contexto: shouldActivateAgenteContexto,
      customer_memory: customerMemory ? {
        occasion: customerMemory.occasion,
        preferences: customerMemory.preferences,
        conversation_stage: customerMemory.conversation_stage,
      } : null,
    });

  } catch (error) {
    console.error(`[PromptOrchestration] Erro fatal:`, error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao processar orquestração: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

/**
 * Handler para obter um prompt específico pelo nome
 */
export async function getPromptByName(
  req: Request<{ promptName: string }, any, any>,
  res: Response<any>
): Promise<Response<any> | undefined> {
  try {
    const { promptName } = req.params;

    const prompt = INTENT_TO_PROMPT[promptName as string] || PROMPTS[promptName as keyof typeof PROMPTS];

    if (!prompt) {
      return res.status(404).json({
        status: "error",
        error: `Prompt '${promptName}' não encontrado`,
      });
    }

    return res.status(200).json({
      status: "success",
      promptName,
      content: prompt,
    });

  } catch (error) {
    console.error(`[GetPrompt] Erro:`, error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao obter prompt: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

/**
 * Handler para atualizar memória do cliente
 */
export async function updateCustomerMemory(
  req: Request<{}, {}, { customer_phone: string; occasion?: string; preferences?: any; conversation_stage?: string; notes?: string }>,
  res: Response<any>
): Promise<Response<any> | undefined> {
  try {
    const {
      customer_phone,
      occasion,
      preferences,
      conversation_stage,
      notes,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({
        status: "error",
        error: "customer_phone é obrigatório",
      });
    }

    // Atualizar ou criar memória
    const memory = await prisma.customerMemory.upsert({
      where: { customer_phone },
      create: {
        customer_phone,
        summary: notes || "",
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
      },
      update: {
        ...(notes && { summary: notes }),
        updated_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return res.status(200).json({
      status: "success",
      message: "Memória do cliente atualizada",
      customer_memory: memory,
    });

  } catch (error) {
    console.error(`[UpdateMemory] Erro:`, error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao atualizar memória: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

/**
 * Exportar helpers
 */
export {
  detectIntentWithLLM,
  detectIntentWithKeywords,
  loadChatHistory,
  loadCustomerMemory,
  ensureAIAgentSession,
  buildFinalPrompts,
};

