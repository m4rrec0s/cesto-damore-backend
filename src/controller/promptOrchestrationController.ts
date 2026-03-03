import { Router, Request, Response } from "express";
import OpenAI from "openai";
import prisma from "../database/prisma";
import { INTENT_TO_PROMPT, INTENT_KEYWORDS, PROMPTS } from "../config/prompts";
import logger from "../utils/logger";

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

type PromptOverrideMode = "permanent" | "temporary";

interface PromptPriorityInstructionConfig {
  id: number;
  prompt_text: string;
  is_enabled: boolean;
  mode: PromptOverrideMode;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  is_active_now: boolean;
}

interface PromptPriorityInstructionRow {
  id: number;
  prompt_text: string;
  is_enabled: boolean;
  is_permanent: boolean;
  starts_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let promptPriorityInstructionsTableReadyPromise: Promise<void> | null = null;

function toIsoOrNull(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString();
}

function isPromptOverrideActive(
  row: PromptPriorityInstructionRow,
  referenceDate = new Date(),
): boolean {
  if (!row.is_enabled) return false;

  const text = row.prompt_text?.trim();
  if (!text) return false;

  if (row.starts_at && row.starts_at.getTime() > referenceDate.getTime()) {
    return false;
  }

  if (row.is_permanent) {
    return true;
  }

  if (!row.expires_at) {
    return false;
  }

  return row.expires_at.getTime() >= referenceDate.getTime();
}

async function ensurePromptPriorityInstructionsTable(): Promise<void> {
  if (promptPriorityInstructionsTableReadyPromise) {
    return promptPriorityInstructionsTableReadyPromise;
  }

  promptPriorityInstructionsTableReadyPromise = prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS llm_prompt_priority_instructions (
        id SERIAL PRIMARY KEY,
        prompt_text TEXT NOT NULL DEFAULT '',
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        is_permanent BOOLEAN NOT NULL DEFAULT FALSE,
        starts_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
    .then(() => undefined)
    .catch((error) => {
      promptPriorityInstructionsTableReadyPromise = null;
      throw error;
    });

  return promptPriorityInstructionsTableReadyPromise;
}

async function loadPromptPriorityOverrides(): Promise<PromptPriorityInstructionRow[]> {
  await ensurePromptPriorityInstructionsTable();

  return prisma.$queryRaw<PromptPriorityInstructionRow[]>`
    SELECT id, prompt_text, is_enabled, is_permanent, starts_at, expires_at, created_at, updated_at
    FROM llm_prompt_priority_instructions
    ORDER BY created_at ASC, id ASC
  `;
}

async function loadActivePromptPriorityOverrides(): Promise<
  PromptPriorityInstructionRow[]
> {
  await ensurePromptPriorityInstructionsTable();

  return prisma.$queryRaw<PromptPriorityInstructionRow[]>`
    SELECT id, prompt_text, is_enabled, is_permanent, starts_at, expires_at, created_at, updated_at
    FROM llm_prompt_priority_instructions
    WHERE
      is_enabled = TRUE
      AND BTRIM(prompt_text) <> ''
      AND (starts_at IS NULL OR starts_at <= NOW())
      AND (
        is_permanent = TRUE
        OR (expires_at IS NOT NULL AND expires_at >= NOW())
      )
    ORDER BY created_at ASC, id ASC
  `;
}

async function createPromptPriorityOverride(input: {
  prompt_text: string;
  is_enabled: boolean;
  mode: PromptOverrideMode;
  starts_at: Date | null;
  expires_at: Date | null;
}): Promise<PromptPriorityInstructionRow> {
  await ensurePromptPriorityInstructionsTable();

  const isPermanent = input.mode === "permanent";
  const now = new Date();
  const rows = await prisma.$queryRaw<PromptPriorityInstructionRow[]>`
    INSERT INTO llm_prompt_priority_instructions (
      prompt_text, is_enabled, is_permanent, starts_at, expires_at, updated_at
    )
    VALUES (
      ${input.prompt_text}, ${input.is_enabled}, ${isPermanent},
      ${input.starts_at}, ${isPermanent ? null : input.expires_at}, ${now}
    )
    RETURNING id, prompt_text, is_enabled, is_permanent, starts_at, expires_at, created_at, updated_at
  `;

  return rows[0];
}

async function updatePromptPriorityOverrideById(
  id: number,
  input: {
    prompt_text: string;
    is_enabled: boolean;
    mode: PromptOverrideMode;
    starts_at: Date | null;
    expires_at: Date | null;
  },
): Promise<PromptPriorityInstructionRow | null> {
  await ensurePromptPriorityInstructionsTable();

  const isPermanent = input.mode === "permanent";
  const now = new Date();
  const rows = await prisma.$queryRaw<PromptPriorityInstructionRow[]>`
    UPDATE llm_prompt_priority_instructions
    SET
      prompt_text = ${input.prompt_text},
      is_enabled = ${input.is_enabled},
      is_permanent = ${isPermanent},
      starts_at = ${input.starts_at},
      expires_at = ${isPermanent ? null : input.expires_at},
      updated_at = ${now}
    WHERE id = ${id}
    RETURNING id, prompt_text, is_enabled, is_permanent, starts_at, expires_at, created_at, updated_at
  `;

  return rows[0] || null;
}

async function deletePromptPriorityOverrideById(id: number): Promise<boolean> {
  await ensurePromptPriorityInstructionsTable();

  const result = await prisma.$executeRaw`
    DELETE FROM llm_prompt_priority_instructions
    WHERE id = ${id}
  `;

  return result > 0;
}

function serializePromptOverride(
  row: PromptPriorityInstructionRow,
): PromptPriorityInstructionConfig {
  return {
    id: row.id,
    prompt_text: row.prompt_text,
    is_enabled: row.is_enabled,
    mode: row.is_permanent ? "permanent" : "temporary",
    starts_at: toIsoOrNull(row.starts_at),
    expires_at: row.is_permanent ? null : toIsoOrNull(row.expires_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    is_active_now: isPromptOverrideActive(row),
  };
}

/**
 * Detectar intenção usando LLM (OpenAI) para análise inteligente
 */
async function detectIntentWithLLM(
  message: string,
  messageHistory: any[] = [],
  customerMemory: any = null,
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

Regras de desambiguação (CRÍTICO):
- Se cliente pede valores, opções, catálogo, "o que tem", "quais cestas" => product_search
- "Quero" sozinho NÃO significa checkout. Sem confirmação explícita de compra, permaneça em product_search
- checkout só quando houver intenção explícita de fechar pedido ("vou levar", "quero comprar", "como faço pedido", "fecha")
- Se pedir atendente/pessoa humana em qualquer contexto => human_transfer

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

    const detected =
      response.choices[0]?.message?.content?.trim().toLowerCase() || "greeting";

    // Validar se é uma intenção conhecida
    const validIntents = Object.keys(INTENT_TO_PROMPT);
    if (validIntents.includes(detected)) {
      logger.info(
        `[PromptOrchestration] Intent detectada por LLM: ${detected}`,
      );
      return detected;
    }

    // Fallback para keyword matching se LLM retornar intenção desconhecida
    logger.info(
      `[PromptOrchestration] Intent desconhecida: ${detected}, usando fallback`,
    );
    return detectIntentWithKeywords(message, messageHistory);
  } catch (error) {
    console.error(
      `[PromptOrchestration] Erro ao detectar intent com LLM:`,
      error,
    );
    // Fallback para keyword matching
    return detectIntentWithKeywords(message, messageHistory);
  }
}

function hasActiveCustomerMemory(customerMemory: any): boolean {
  if (!customerMemory) {
    return false;
  }

  if (!customerMemory.expires_at) {
    return true;
  }

  const expiresAt = new Date(customerMemory.expires_at).getTime();
  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt > Date.now();
}

function shouldActivateAgenteContexto(
  intent: string,
  isFirstMessage: boolean,
  hasActiveMemory: boolean,
): boolean {
  if (hasActiveMemory) {
    return false;
  }

  if (!isFirstMessage) {
    return false;
  }

  return intent === "greeting";
}

function buildSessionOrchestrationDirective(
  intent: string,
  isFirstMessage: boolean,
  shouldActivateContextAgent: boolean,
  hasActiveMemory: boolean,
): string {
  return `[CONTRATO DE ORQUESTRAÇÃO]
INTENT_DETECTADA=${intent}
IS_FIRST_MESSAGE=${isFirstMessage ? "true" : "false"}
HAS_ACTIVE_MEMORY=${hasActiveMemory ? "true" : "false"}

Matriz de ação:
- greeting => saudação curta + colher interesse
- product_search|indecision|inexistent_product => Agente-Catalogo
- checkout => ANA conduz fechamento direto (get_product_details → validate → calculate_freight → finalize_checkout)
- customization => ANA responde com prazos + can_produce_in_time se tiver dados
- delivery_check|production_faq|location_info => ANA responde direto com tools
- human_transfer|mass_order => notify_human_support + block_session

EXECUÇÃO SILENCIOSA: execute tools diretamente, NUNCA anuncie antes de executar.`;
}

/**
 * Fallback: Detectar intenção usando keywords (método rápido)
 */
function detectIntentWithKeywords(
  message: string,
  messageHistory: any[] = [],
): string {
  const messageLower = message.toLowerCase().trim();

  // Priority: human_transfer
  if (
    INTENT_KEYWORDS.human_transfer.some((kw: string) =>
      messageLower.includes(kw),
    )
  ) {
    return "human_transfer";
  }

  // Detectar outras intenções
  let bestMatch = "greeting";
  let maxMatches = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const matches = (keywords as string[]).filter((kw: string) =>
      messageLower.includes(kw),
    ).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = intent;
    }
  }

  // Contexto do histórico se nenhuma keyword
  if (maxMatches === 0 && messageHistory.length > 0) {
    const recentMessages = messageHistory.slice(-5);
    const hasCheckoutContext = recentMessages.some(
      (msg: any) =>
        (msg.content || msg.message)?.toLowerCase().includes("data") ||
        (msg.content || msg.message)?.toLowerCase().includes("endereco") ||
        (msg.content || msg.message)?.toLowerCase().includes("pagamento"),
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

function normalizeCustomerName(customerName?: string | null): string | null {
  const normalized = customerName?.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.toLowerCase() === "cliente") {
    return null;
  }

  return normalized;
}

async function ensureCustomerRecord(
  customerPhone: string,
  customerName?: string,
): Promise<void> {
  const phone = customerPhone?.trim();
  if (!phone) {
    return;
  }

  const normalizedName = normalizeCustomerName(customerName);
  const now = new Date();

  await prisma.customer.upsert({
    where: { number: phone },
    update: {
      ...(normalizedName ? { name: normalizedName } : {}),
      last_message_sent: now,
      follow_up: true,
    },
    create: {
      number: phone,
      name: normalizedName,
      last_message_sent: now,
      follow_up: true,
    },
  });
}

/**
 * Criar ou verificar AIAgentSession + Customer (camada de segurança)
 */
async function ensureAIAgentSession(
  customerPhone: string,
  sessionId?: string,
  customerName: string = "Cliente",
): Promise<string> {
  try {
    await ensureCustomerRecord(customerPhone, customerName);

    // Se session_id não for fornecido, gerar um novo
    const finalSessionId =
      sessionId ||
      `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

      logger.info(
        `[PromptOrchestration] Novo AIAgentSession criado: ${finalSessionId}`,
      );
    }

    return finalSessionId;
  } catch (error) {
    console.error(
      `[PromptOrchestration] Erro ao criar/verificar session: ${error}`,
    );
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
  messageHistory: any[],
  orchestrationDirective: string,
  highPriorityInstructions: string[] = [],
): { finalPrompt: string; selectedPrompts: string[] } {
  const prompts: string[] = [];
  const selectedPrompts: string[] = [];

  if (highPriorityInstructions.length > 0) {
    const normalized = highPriorityInstructions
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (normalized.length > 0) {
      const list = normalized.map((text, index) => `${index + 1}. ${text}`).join("\n");
      prompts.push(`[LISTA DE DIRETRIZES PRIORITÁRIAS DO MANAGER]\n${list}`);
      selectedPrompts.push("manager_high_priority_overrides_list");
      prompts.push("\n---\n");
    }
  }

  prompts.push(PROMPTS.core_identity);
  selectedPrompts.push("core_identity");

  prompts.push("\n---\n");
  prompts.push(PROMPTS.tools_usage);
  selectedPrompts.push("tools_usage");

  prompts.push("\n---\n");
  prompts.push(PROMPTS.formatting_rules);
  selectedPrompts.push("formatting_rules");

  prompts.push("\n---\n");
  prompts.push(PROMPTS.execution_rules);
  selectedPrompts.push("execution_rules");

  prompts.push("\n---\n");
  prompts.push(PROMPTS.product_rules);
  selectedPrompts.push("product_rules");

  const intentPrompt = INTENT_TO_PROMPT[intent] || PROMPTS.greeting;
  prompts.push("\n---\n");
  prompts.push(intentPrompt);
  selectedPrompts.push(intent || "greeting");

  prompts.push("\n---\n");
  prompts.push(orchestrationDirective);
  selectedPrompts.push("orchestration_directive");

  if (customerMemory?.summary) {
    prompts.push("\n---\n");
    prompts.push(`[CONTEXTO DO CLIENTE]\n${customerMemory.summary}`);
    selectedPrompts.push("customer_memory_context");
  }

  prompts.push("\n---\n");
  prompts.push(PROMPTS.security_rules);
  selectedPrompts.push("security_rules");

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
  res: Response<OrchestrationResponse>,
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

    logger.info(
      `[PromptOrchestration] Processando: ${customer_phone} | ${latest_message.substring(0, 50)}...`,
    );

    // 1. SEGURANÇA: Criar/verificar AIAgentSession
    const finalSessionId = await ensureAIAgentSession(
      customer_phone,
      session_id,
      customer_name,
    );

    // 2. Carregar histórico de chat
    const chatHistory = await loadChatHistory(finalSessionId);

    // 3. Carregar memória longa do cliente
    const customerMemory = await loadCustomerMemory(customer_phone);

    // 4. Detectar intenção com LLM (análise inteligente)
    const intent = await detectIntentWithLLM(
      latest_message,
      chatHistory,
      customerMemory,
    );

    logger.info(`[PromptOrchestration] Intenção detectada por LLM: ${intent}`);

    const hasMemory = hasActiveCustomerMemory(customerMemory);
    const activePromptOverrides = await loadActivePromptPriorityOverrides();
    const highPriorityInstructions = activePromptOverrides
      .map((row) => row.prompt_text?.trim() || "")
      .filter(Boolean);
    const isFirstMessage = chatHistory.length <= 1;
    const shouldActivateContextAgent = shouldActivateAgenteContexto(
      intent,
      isFirstMessage,
      hasMemory,
    );
    const orchestrationDirective = buildSessionOrchestrationDirective(
      intent,
      isFirstMessage,
      shouldActivateContextAgent,
      hasMemory,
    );

    // 5. Construir prompts na ordem obrigatória (máximo 3 adicionais)
    const { finalPrompt, selectedPrompts } = buildFinalPrompts(
      intent,
      customerMemory,
      chatHistory,
      orchestrationDirective,
      highPriorityInstructions,
    );

    // 7. Retornar resposta estruturada
    return res.status(200).json({
      status: "success",
      finalPrompt,
      selectedPrompts,
      intent,
      session_id: finalSessionId,
      is_first_message: isFirstMessage,
      should_activate_agente_contexto: shouldActivateContextAgent,
      customer_memory: customerMemory
        ? {
            occasion: customerMemory.occasion,
            preferences: customerMemory.preferences,
            conversation_stage: customerMemory.conversation_stage,
          }
        : null,
    });
  } catch (error) {
    console.error(`[PromptOrchestration] Erro fatal:`, error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao processar orquestração: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

function parsePromptOverridePayload(body: {
  prompt_text?: string;
  is_enabled?: boolean;
  mode?: PromptOverrideMode;
  starts_at?: string | null;
  expires_at?: string | null;
}): {
  data?: {
    prompt_text: string;
    is_enabled: boolean;
    mode: PromptOverrideMode;
    starts_at: Date | null;
    expires_at: Date | null;
  };
  error?: string;
} {
  const {
    prompt_text = "",
    is_enabled = false,
    mode = "temporary",
    starts_at = null,
    expires_at = null,
  } = body || {};

  if (mode !== "temporary" && mode !== "permanent") {
    return { error: "mode deve ser 'temporary' ou 'permanent'" };
  }

  const normalizedPromptText = String(prompt_text || "").trim();
  if (!normalizedPromptText) {
    return { error: "prompt_text é obrigatório" };
  }

  const parsedStartsAt = starts_at ? new Date(starts_at) : null;
  if (starts_at && Number.isNaN(parsedStartsAt?.getTime())) {
    return { error: "starts_at inválido (use formato ISO-8601)" };
  }

  const parsedExpiresAt = expires_at ? new Date(expires_at) : null;
  if (mode === "temporary") {
    if (!expires_at) {
      return { error: "expires_at é obrigatório para mode=temporary" };
    }

    if (Number.isNaN(parsedExpiresAt?.getTime())) {
      return { error: "expires_at inválido (use formato ISO-8601)" };
    }

    if (parsedStartsAt && parsedExpiresAt && parsedStartsAt >= parsedExpiresAt) {
      return { error: "expires_at deve ser maior que starts_at" };
    }
  }

  return {
    data: {
      prompt_text: normalizedPromptText,
      is_enabled: Boolean(is_enabled),
      mode,
      starts_at: parsedStartsAt,
      expires_at: mode === "temporary" ? parsedExpiresAt : null,
    },
  };
}

async function listPromptPriorityOverrides(
  req: Request,
  res: Response<any>,
): Promise<Response<any> | undefined> {
  try {
    const rows = await loadPromptPriorityOverrides();
    return res.status(200).json({
      status: "success",
      prompts: rows.map(serializePromptOverride),
    });
  } catch (error) {
    logger.error("[PromptOrchestration] Erro ao listar prompt overrides", error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao listar prompts: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

async function createPromptPriorityOverrideHandler(
  req: Request<
    {},
    {},
    {
      prompt_text?: string;
      is_enabled?: boolean;
      mode?: PromptOverrideMode;
      starts_at?: string | null;
      expires_at?: string | null;
    }
  >,
  res: Response<any>,
): Promise<Response<any> | undefined> {
  try {
    const parsed = parsePromptOverridePayload(req.body || {});
    if (!parsed.data) {
      return res.status(400).json({ status: "error", error: parsed.error });
    }

    const saved = await createPromptPriorityOverride(parsed.data);
    return res.status(201).json({
      status: "success",
      prompt: serializePromptOverride(saved),
    });
  } catch (error) {
    logger.error("[PromptOrchestration] Erro ao criar prompt override", error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao criar prompt: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

async function updatePromptPriorityOverrideHandler(
  req: Request<
    { id: string },
    {},
    {
      prompt_text?: string;
      is_enabled?: boolean;
      mode?: PromptOverrideMode;
      starts_at?: string | null;
      expires_at?: string | null;
    }
  >,
  res: Response<any>,
): Promise<Response<any> | undefined> {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: "error", error: "id inválido" });
    }

    const parsed = parsePromptOverridePayload(req.body || {});
    if (!parsed.data) {
      return res.status(400).json({ status: "error", error: parsed.error });
    }

    const updated = await updatePromptPriorityOverrideById(id, parsed.data);
    if (!updated) {
      return res.status(404).json({
        status: "error",
        error: "Prompt prioritário não encontrado",
      });
    }

    return res.status(200).json({
      status: "success",
      prompt: serializePromptOverride(updated),
    });
  } catch (error) {
    logger.error("[PromptOrchestration] Erro ao atualizar prompt override", error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao atualizar prompt: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

async function deletePromptPriorityOverrideHandler(
  req: Request<{ id: string }>,
  res: Response<any>,
): Promise<Response<any> | undefined> {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: "error", error: "id inválido" });
    }

    const removed = await deletePromptPriorityOverrideById(id);
    if (!removed) {
      return res.status(404).json({
        status: "error",
        error: "Prompt prioritário não encontrado",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Prompt prioritário removido",
    });
  } catch (error) {
    logger.error("[PromptOrchestration] Erro ao remover prompt override", error);
    return res.status(500).json({
      status: "error",
      error: `Erro ao remover prompt: ${error instanceof Error ? error.message : "Desconhecido"}`,
    });
  }
}

/**
 * Handler para obter um prompt específico pelo nome
 */
export async function getPromptByName(
  req: Request<{ promptName: string }, any, any>,
  res: Response<any>,
): Promise<Response<any> | undefined> {
  try {
    const { promptName } = req.params;

    const prompt =
      INTENT_TO_PROMPT[promptName as string] ||
      PROMPTS[promptName as keyof typeof PROMPTS];

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
  req: Request<
    {},
    {},
    {
      customer_phone: string;
      occasion?: string;
      preferences?: any;
      conversation_stage?: string;
      notes?: string;
    }
  >,
  res: Response<any>,
): Promise<Response<any> | undefined> {
  try {
    const { customer_phone, occasion, preferences, conversation_stage, notes } =
      req.body;

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
  hasActiveCustomerMemory,
  shouldActivateAgenteContexto,
  buildSessionOrchestrationDirective,
  loadChatHistory,
  loadCustomerMemory,
  ensureCustomerRecord,
  ensureAIAgentSession,
  buildFinalPrompts,
  listPromptPriorityOverrides,
  createPromptPriorityOverrideHandler,
  updatePromptPriorityOverrideHandler,
  deletePromptPriorityOverrideHandler,
};
