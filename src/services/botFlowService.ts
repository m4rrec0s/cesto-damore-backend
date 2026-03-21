import { PrismaClient } from "@prisma/client";
import whatsappService from "./whatsappService";
import aiAgentService from "./aiAgentService";
import type { FlowCatalogNode } from "../types/flowRouter";
const prisma = new PrismaClient();

interface BotMessageRequest {
  phone: string;
  message: string;
  contactName?: string;
}

interface MessageResponse {
  text: string;
  delay?: number;
  type?: string;
  messageType?: string;
  isProduct?: boolean;
  isProdutoMessage?: boolean;
  isInstagramLink?: boolean;
  isPreviewImage?: boolean;
  isGeneralLink?: boolean;
  isTextMessage?: boolean;
  originalMessage?: string;
}

type FlowNodeData = {
  title?: string;
  message?: string;
  summary?: string;
  when_to_use?: string;
  examples?: string[];
  keywords?: string[];
  expected_user_state?: string;
  next_best_nodes?: string[];
  requires_slots?: string[];
  bot_voice_template?: string;
  confidence_rules?: string;
  confidence_threshold?: number;
  [key: string]: unknown;
};

type FlowNode = {
  id: string;
  type: string;
  data?: FlowNodeData;
  [key: string]: unknown;
};

const BASE_URL = process.env.BASE_URL || "https://api.cestodamore.com.br";
const BOT_HANDOFF_GROUP_ID =
  process.env.WHATSAPP_BOT_HANDOFF_GROUP_ID || "120363421291021203@g.us";
const FLOW_NODE_REDIRECT_REGEX = /SUCESSO_REDIRECIONAMENTO_DE_NO:\[([^\]]+)\]/i;
const FLOW_NODE_REDIRECT_TEXT_REGEX =
  /SUCESSO:\s*Fluxo redirecionado para node_id\s+([^\s\n]+)/i;

const stripHtmlTags = (value: string) =>
  value.replace(/<[^>]*>/g, "").replace(/\\[.*?\\]/g, "");

const sanitizeProductDescription = (value: string) => {
  const sanitized = stripHtmlTags(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/\[informac(?:ao|ão)_?interna\]/i.test(line))
    .filter((line) => !/^tags\s*:/i.test(line));

  return sanitized.join("\n").trim();
};

const formatPrice = (price: number) => price.toFixed(2).replace(".", ",");

const resolvePreviewUrl = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (imageUrl.includes("/preview?img=")) return imageUrl;
  try {
    const url = new URL(imageUrl, BASE_URL);
    const filename = url.pathname.split("/").filter(Boolean).pop();
    if (!filename) return imageUrl;
    return `${BASE_URL}/preview?img=${filename}`;
  } catch (error) {
    const filename = imageUrl.split("/").filter(Boolean).pop();
    if (!filename) return imageUrl;
    return `${BASE_URL}/preview?img=${filename}`;
  }
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const normalizeSearchTokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s,]+/gu, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isYesOption = (value: string, option: string) => {
  const normalized = normalizeText(value);
  return normalized.includes(option);
};

const isInternalCartAddedEvent = (value: string) => {
  const text = String(value || "");
  const hasInternalTag = /\[\s*interno\s*\]/i.test(text);
  const hasCartAddedSignal =
    /evento\s*=\s*cart[_-]?added/i.test(text) ||
    /cart[_-]?added/i.test(text) ||
    /adicionou\s+produto\s+ao\s+carrinho/i.test(text);
  return hasInternalTag && hasCartAddedSignal;
};

const isInternalImageEvent = (value: string) => {
  const normalized = normalizeText(String(value || ""));
  return (
    normalized.includes("[informacoes internas]") &&
    normalized.includes("o cliente mandou uma imagem")
  );
};

const MENU_MATCH_STOPWORDS = new Set([
  "a",
  "o",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "e",
  "ou",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "pra",
  "pro",
  "com",
  "sem",
  "um",
  "uma",
  "meu",
  "minha",
  "meus",
  "minhas",
]);

const canonicalizeMenuToken = (token: string) => {
  let normalized = normalizeText(token)
    .replace(/[^a-z0-9]/g, "")
    .trim();

  if (!normalized) return "";

  normalized = normalized
    .replace(/^amig[oa]s?$/, "amig")
    .replace(/^parentes?$/, "parent")
    .replace(/^familia(res)?$/, "famil")
    .replace(/^romanticas?$/, "romant")
    .replace(/^chocolates?$/, "chocol")
    .replace(/^orcamentos?$/, "orcament");

  if (normalized.endsWith("s") && normalized.length > 4) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
};

const tokenizeMenuText = (value: string) =>
  normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => canonicalizeMenuToken(token))
    .filter((token) => token && token.length >= 3)
    .filter((token) => !MENU_MATCH_STOPWORDS.has(token));

const resolveMenuOptionIndex = (inputText: string, options: any[]): number => {
  const normalizedInput = normalizeText(inputText || "");
  if (!normalizedInput) return -1;

  const labels = (options || []).map((opt: any) => {
    const label =
      typeof opt === "string" ? opt : opt?.label || opt?.value || "";
    return String(label).trim();
  });
  const normalizedLabels = labels.map((label) => normalizeText(label));

  const exactIndex = normalizedLabels.findIndex(
    (label) => label === normalizedInput,
  );
  if (exactIndex >= 0) return exactIndex;

  const containsIndex = normalizedLabels.findIndex(
    (label) =>
      normalizedInput.length >= 4 &&
      (label.includes(normalizedInput) || normalizedInput.includes(label)),
  );
  if (containsIndex >= 0) return containsIndex;

  if (
    normalizedInput.includes("voltar") ||
    normalizedInput.includes("menu principal") ||
    normalizedInput.includes("inicio") ||
    normalizedInput.includes("inicial") ||
    normalizedInput.includes("primeiro menu")
  ) {
    const backIndex = normalizedLabels.findIndex(
      (label) =>
        label.includes("voltar") ||
        label.includes("menu principal") ||
        label.includes("inicio") ||
        label.includes("inicial"),
    );
    if (backIndex >= 0) return backIndex;
  }

  const inputTokens = tokenizeMenuText(normalizedInput);
  if (inputTokens.length === 0) return -1;

  let bestIndex = -1;
  let bestScore = 0;

  normalizedLabels.forEach((label, index) => {
    const labelTokens = tokenizeMenuText(label);
    if (labelTokens.length === 0) return;

    let score = 0;
    inputTokens.forEach((inputToken) => {
      if (labelTokens.includes(inputToken)) {
        score += 2;
        return;
      }

      const partial = labelTokens.some(
        (labelToken) =>
          (inputToken.length >= 4 && labelToken.startsWith(inputToken)) ||
          (labelToken.length >= 4 && inputToken.startsWith(labelToken)),
      );
      if (partial) score += 1;
    });

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestScore >= 2) return bestIndex;

  return -1;
};

const getNodeOptions = (nodeData: any): any[] =>
  Array.isArray(nodeData?.options) ? nodeData.options : [];

const getMenuLikeNodeMessage = (nodeData: any): string =>
  String(nodeData?.menu_title || nodeData?.message || "").trim();

const buildMenuText = (baseMessage: string, options: any[]) => {
  const optionLines = (options || []).map((opt: any, index: number) => {
    const label =
      typeof opt === "string" ? opt : opt?.label || opt?.value || "";
    return `${index + 1}. ${String(label).trim()}`;
  });
  const trimmedBase = String(baseMessage || "").trim();
  if (optionLines.length === 0) return trimmedBase;
  return `${trimmedBase}\n\n${optionLines.join("\n")}`.trim();
};

const toFlowCatalogNode = (node: FlowNode): FlowCatalogNode => {
  const data = (node?.data || {}) as FlowNodeData;
  const title = String(data.title || node.type || "Node").trim();
  const summary = String(data.summary || data.message || "").trim();
  const listOf = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];
  return {
    id: String(node.id || "").trim(),
    type: String(node.type || "").trim(),
    title,
    ...(summary ? { summary } : {}),
    ...(String(data.when_to_use || "").trim()
      ? { when_to_use: String(data.when_to_use).trim() }
      : {}),
    ...(listOf(data.examples).length > 0 ? { examples: listOf(data.examples) } : {}),
    ...(listOf(data.keywords).length > 0 ? { keywords: listOf(data.keywords) } : {}),
    ...(String(data.expected_user_state || "").trim()
      ? { expected_user_state: String(data.expected_user_state).trim() }
      : {}),
    ...(listOf(data.next_best_nodes).length > 0
      ? { next_best_nodes: listOf(data.next_best_nodes) }
      : {}),
    ...(listOf(data.requires_slots).length > 0
      ? { requires_slots: listOf(data.requires_slots) }
      : {}),
    ...(String(data.bot_voice_template || "").trim()
      ? { bot_voice_template: String(data.bot_voice_template).trim() }
      : {}),
    ...(typeof data.confidence_threshold === "number"
      ? { confidence_threshold: data.confidence_threshold }
      : {}),
    ...(String(data.confidence_rules || "").trim()
      ? { confidence_rules: String(data.confidence_rules).trim() }
      : {}),
  };
};

const classifyMessage = (message: string): Partial<MessageResponse> => {
  try {
    const produtoPattern =
      /https:\/\/api\.cestodamore\.com\.br\/preview\?img=[^\s]+/;
    const opcaoPattern = /_Opção \d+:_/;
    const precoPattern = /\*R\$\s+[\d.,]+\*/;
    const nomePrecoPattern = /\*[^*]+\*\s*-\s*VALOR\s*-\s*R\$\s*[\d.,]+/i;
    const precoPlainPattern = /R\$\s*[\d.,]+/;

    const temPreviewUrl = produtoPattern.test(message);
    const temOpcao = opcaoPattern.test(message);
    const temPreco = precoPattern.test(message);
    const temNomePreco = nomePrecoPattern.test(message);
    const temPrecoPlain = precoPlainPattern.test(message);

    if (
      temPreviewUrl &&
      (temOpcao || temNomePreco) &&
      (temPreco || temPrecoPlain)
    ) {
      return {
        isProduct: true,
        isProdutoMessage: true,
        messageType: "produto",
        originalMessage: message,
      };
    }

    if (
      message.includes("www.instagram.com") ||
      message.includes("instagram.com")
    ) {
      return {
        isProduct: false,
        isInstagramLink: true,
        messageType: "instagram",
        originalMessage: message,
      };
    }

    if (message.includes("https://api.cestodamore.com.br/preview?img=")) {
      return {
        isProduct: false,
        isPreviewImage: true,
        messageType: "preview_link",
        originalMessage: message,
      };
    }

    if (message.startsWith("http://") || message.startsWith("https://")) {
      return {
        isProduct: false,
        isGeneralLink: true,
        messageType: "link",
        originalMessage: message,
      };
    }
  } catch (error) {
    // Fallback to text
  }

  return {
    isProduct: false,
    isTextMessage: true,
    messageType: "texto",
    originalMessage: message,
  };
};

export const botFlowService = {
  async getActiveFlow() {
    let flow = await prisma.botFlow.findFirst({
      where: { is_active: true },
    });

    if (!flow) {
      flow = await prisma.botFlow.create({
        data: {
          name: "Fluxo Padrão Ana",
          is_active: true,
          nodes: [],
          edges: [],
        },
      });
    }

    return flow;
  },

  async saveFlow(nodes: any, edges: any) {
    const flow = await this.getActiveFlow();
    return prisma.botFlow.update({
      where: { id: flow.id },
      data: {
        nodes,
        edges,
      },
    });
  },

  async triggerFollowUpNode({
    phone,
    nodeId,
  }: {
    phone: string;
    nodeId: string;
  }): Promise<boolean> {
    const flow = await this.getActiveFlow();
    const nodes = (flow.nodes as any[]) || [];
    const node = nodes.find(
      (flowNode) => flowNode.id === nodeId && flowNode.type === "followUpNode",
    );

    if (!node) {
      return false;
    }

    const followUpText = buildMenuText(
      getMenuLikeNodeMessage(node.data),
      getNodeOptions(node.data),
    );

    if (!followUpText) {
      return false;
    }

    let session = await prisma.botSession.findUnique({
      where: { phone },
    });

    if (!session) {
      session = await prisma.botSession.create({
        data: {
          phone,
          flow_id: flow.id,
          current_node_id: null,
          is_human: false,
          state: {},
          history: [],
        },
      });
    }

    const sent = await whatsappService.sendDirectMessage(phone, followUpText);
    if (!sent) {
      return false;
    }

    const history = (Array.isArray(session.history) ? session.history : []) as any[];
    history.push({
      role: "bot",
      text: followUpText,
      type: "menu",
      created_at: new Date().toISOString(),
      meta: { source: "follow_up_node", node_id: nodeId },
    });

    const state = (session.state as any) || {};

    await prisma.botSession.update({
      where: { id: session.id },
      data: {
        current_node_id: nodeId,
        state,
        history: history as any,
        updated_at: new Date(),
      },
    });

    return true;
  },

  async processMessage({
    phone,
    message,
    contactName,
  }: BotMessageRequest): Promise<MessageResponse[]> {
    const rawText = (message || "").toString().trim();
    const text = rawText.toLowerCase();
    const hasInternalCartAddedEvent = isInternalCartAddedEvent(rawText);
    const hasInternalImageInstruction = isInternalImageEvent(rawText);

    // Find or create session
    let session = await prisma.botSession.findUnique({
      where: { phone },
    });

    // Default state building
    let sessionState: Record<string, any> = {};

    let history: any[] = [];

    const flow = await this.getActiveFlow();
    const nodes = ((flow.nodes as any[]) || []) as FlowNode[];
    const edges = (flow.edges as any[]) || [];
    const flowCatalog = nodes
      .map(toFlowCatalogNode)
      .filter((catalogNode) => Boolean(catalogNode.id));

    if (!session) {
      session = await prisma.botSession.create({
        data: {
          phone,
          flow_id: flow.id,
          current_node_id: null,
          is_human: false,
          state: { contactName },
          history: [],
        },
      });
    }

    if (session) {
      history = (
        Array.isArray(session.history) ? session.history : []
      ) as any[];
      if (rawText) {
        history.push({
          role: "user",
          text: message,
          created_at: new Date().toISOString(),
        });
      }

      sessionState = (session.state as any) || {};
      if (contactName && sessionState.contactName !== contactName) {
        sessionState.contactName = contactName;
        await prisma.botSession.update({
          where: { id: session.id },
          data: { state: sessionState },
        });
      }
    }

    if (
      session &&
      session.is_human &&
      !hasInternalCartAddedEvent &&
      !hasInternalImageInstruction
    ) {
      return []; // Return empty if human is handling
    }

    // Reset se pedir menu
    if (["oi", "ola", "olá", "menu", "início", "inicio"].includes(text)) {
      session.current_node_id = null;
    }

    let currentNodeId = session.current_node_id;
    let node: FlowNode | null = nodes.find((n) => n.id === currentNodeId) || null;

    const resolveNodeDelay = (nodeData: any, fallback = 1500) => {
      if (typeof nodeData?.delayMs === "number" && nodeData.delayMs >= 0) {
        return Math.round(nodeData.delayMs);
      }
      if (
        typeof nodeData?.delaySeconds === "number" &&
        nodeData.delaySeconds >= 0
      ) {
        return Math.round(nodeData.delaySeconds * 1000);
      }
      return fallback;
    };

    const saveSessionState = async (
      cNodeId: string | null,
      stateObj: any,
      msgs: any[],
    ) => {
      const finalHistory = [...history];
      msgs.forEach((m) =>
        finalHistory.push({
          role: "bot",
          text: m.text,
          type: m.type || "text",
          delay: m.delay,
          created_at: new Date().toISOString(),
        }),
      );
      await prisma.botSession.update({
        where: { id: session!.id },
        data: {
          current_node_id: cNodeId,
          state: stateObj,
          history: finalHistory as any,
          updated_at: new Date(),
        },
      });
    };

    const activateHumanHandoff = async ({
      botText,
      stateObj,
      reason,
      delayMs,
      alertTitle = "ATENDIMENTO HUMANO SOLICITADO",
    }: {
      botText: string;
      stateObj: any;
      reason?: string;
      delayMs?: number;
      alertTitle?: string;
    }) => {
      const safeBotText =
        String(botText || "").trim() ||
        "Perfeito! Vou te encaminhar para atendimento humano agora.\n> SEG-SEX: 08:30-12:00; 14:00-17:00 e SÁB: 08:00-11:00";

      const handoffMessages: MessageResponse[] = [
        {
          text: safeBotText,
          delay: typeof delayMs === "number" ? delayMs : 1000,
          ...classifyMessage(safeBotText),
        },
      ];

      const handoffState = {
        ...stateObj,
        is_human: true,
        ...(reason ? { handoff_reason: reason } : {}),
      };

      await saveSessionState(null, handoffState, handoffMessages);
      await prisma.botSession.update({
        where: { id: session.id },
        data: { is_human: true },
      });

      const cName =
        (session.state as any)?.contactName || contactName || "Cliente";
      let alertMsg = `🚨 *${alertTitle}* 🚨\n\n`;
      if (reason) {
        alertMsg += `*Motivo:* ${reason}\n`;
      }
      alertMsg += `*Nome:* ${cName}\n`;
      alertMsg += `*WhatsApp:* https://wa.me/${phone}\n`;
      alertMsg += `*Ação:* O bot foi pausado para este cliente.`;

      try {
        await whatsappService.sendMessage(alertMsg, BOT_HANDOFF_GROUP_ID);
      } catch (e) {
        console.error("[BotFlow] Erro ao notificar atendente de handoff:", e);
      }

      return handoffMessages;
    };

    const activateSilentBlock = async ({
      botText,
      stateObj,
      delayMs,
    }: {
      botText?: string;
      stateObj: any;
      delayMs?: number;
    }) => {
      const safeBotText = String(botText || "").trim();
      const blockMessages: MessageResponse[] = [];

      if (safeBotText) {
        blockMessages.push({
          text: safeBotText,
          delay: typeof delayMs === "number" ? delayMs : 900,
          ...classifyMessage(safeBotText),
        });
      }

      const blockState = {
        ...stateObj,
        is_human: true,
        blocked_by_flow: true,
      };

      await saveSessionState(null, blockState, blockMessages);
      await prisma.botSession.update({
        where: { id: session.id },
        data: { is_human: true },
      });

      return blockMessages;
    };

    const sendFallbackResponse = async (
      menuText: string,
      nodeId: string,
      stateObj: any,
      delayMs?: number,
    ) => {
      const fallbackResult = await aiAgentService.processFallback({
        userMessage: rawText,
        menuText,
        sessionHistory: history,
        customerName:
          (sessionState as any)?.contactName || contactName || "Cliente",
        flowCatalog,
      });

      const routerDecision = fallbackResult.routerDecision || null;
      const stateWithRouterMeta = routerDecision
        ? {
            ...stateObj,
            llm_router_last_decision: {
              ...routerDecision,
              created_at: new Date().toISOString(),
            },
          }
        : stateObj;

      if (fallbackResult.handoffToHuman) {
        return await activateHumanHandoff({
          botText: fallbackResult.text,
          stateObj: stateWithRouterMeta,
          reason:
            fallbackResult.handoffReason || "Solicitado pela LLM no fallback",
          delayMs: typeof delayMs === "number" ? delayMs : 800,
        });
      }

      const safeMenuText = String(menuText || "").trim();
      const rawFallbackText = String(fallbackResult.text || "").trim();
      const redirectMatch = rawFallbackText.match(FLOW_NODE_REDIRECT_REGEX);
      const redirectTextMatch = rawFallbackText.match(
        FLOW_NODE_REDIRECT_TEXT_REGEX,
      );
      const redirectNodeId =
        redirectMatch?.[1]?.trim() || redirectTextMatch?.[1]?.trim();
      const safeFallbackText = rawFallbackText
        .replace(FLOW_NODE_REDIRECT_REGEX, "")
        .replace(FLOW_NODE_REDIRECT_TEXT_REGEX, "")
        .trim();
      const baseDelay = typeof delayMs === "number" ? delayMs : 800;

      if (redirectNodeId) {
        const targetNode = nodes.find((n) => String(n.id) === redirectNodeId);
        if (targetNode) {
          const redirectMessages: MessageResponse[] = [];

          if (safeFallbackText) {
            redirectMessages.push({
              text: safeFallbackText,
              delay: Math.max(450, Math.round(baseDelay * 0.75)),
              ...classifyMessage(safeFallbackText),
            });
          }

          if (targetNode.type === "menuNode") {
            const targetOptions = Array.isArray(targetNode.data?.options)
              ? targetNode.data.options
              : [];
            const targetMenuText = buildMenuText(
              getMenuLikeNodeMessage(targetNode.data) || "Escolha uma opção:",
              targetOptions,
            );
            redirectMessages.push({
              text: targetMenuText,
              delay: baseDelay,
              ...classifyMessage(targetMenuText),
              type: "menu",
            });
          } else {
            const targetText = String(targetNode.data?.message || "").trim();
            if (targetText) {
              redirectMessages.push({
                text: targetText,
                delay: baseDelay,
                ...classifyMessage(targetText),
              });
            }
          }

          if (redirectMessages.length === 0) {
            const defaultText =
              "Perfeito! Te redirecionei para a próxima etapa.";
            redirectMessages.push({
              text: defaultText,
              delay: baseDelay,
              ...classifyMessage(defaultText),
            });
          }

          await saveSessionState(
            redirectNodeId,
            stateWithRouterMeta,
            redirectMessages,
          );
          return redirectMessages;
        }
      }

      const fallbackMessages: MessageResponse[] = [];

      if (
        safeMenuText &&
        safeFallbackText.endsWith(safeMenuText) &&
        safeFallbackText !== safeMenuText
      ) {
        const answerText = safeFallbackText
          .slice(0, safeFallbackText.length - safeMenuText.length)
          .trim();
        if (answerText) {
          fallbackMessages.push({
            text: answerText,
            delay: Math.max(500, Math.round(baseDelay * 0.85)),
            ...classifyMessage(answerText),
          });
        }
        fallbackMessages.push({
          text: safeMenuText,
          delay: baseDelay,
          ...classifyMessage(safeMenuText),
        });
      } else {
        fallbackMessages.push({
          text: safeFallbackText,
          delay: baseDelay,
          ...classifyMessage(safeFallbackText),
        });
      }

      await saveSessionState(nodeId, stateWithRouterMeta, fallbackMessages);
      return fallbackMessages;
    };

    const forceHumanHandoff = async (reason: string) => {
      return await activateHumanHandoff({
        botText:
          "Perfeito! Vou te encaminhar para atendimento humano agora.\n> SEG-SEX: 08:30-12:00; 14:00-17:00 e SÁB: 08:00-11:00",
        stateObj: {
          ...sessionState,
          forced_handoff_reason: reason,
          forced_handoff_input: rawText.slice(0, 700),
        },
        reason,
        delayMs: 600,
        alertTitle: "ATENDIMENTO HUMANO FORÇADO (BOT)",
      });
    };

    if (hasInternalCartAddedEvent) {
      return await forceHumanHandoff("Evento interno CART_ADDED");
    }

    if (hasInternalImageInstruction) {
      return await forceHumanHandoff("Mensagem interna de imagem recebida");
    }

    // Se nao tem node, acha o node inicial (tipo 'start' ou o primeiro sem source edge)
    if (!node) {
      node = nodes.find((n) => n.type === "startNode") || nodes[0];
      if (!node) return [{ text: "O fluxo ainda não foi configurado." }];
      currentNodeId = node.id;
    } else {
      // Process input based on node type
      if (node.type === "menuNode" || node.type === "followUpNode") {
        // Tenta achar a opcao escolhida
        const normalizedInput = normalizeText(text);
        const hasBackIntent =
          normalizedInput.includes("voltar") ||
          normalizedInput.includes("menu principal") ||
          normalizedInput.includes("inicio") ||
          normalizedInput.includes("inicial") ||
          normalizedInput.includes("primeiro menu");
        const isPureNumericInput = /^\s*\d+\s*$/.test(text);
        const digitsMatch = text.match(/\d+/);
        const optionMatched = digitsMatch ? parseInt(digitsMatch[0], 10) : NaN;
        let nextNodeId: string | null = null;

        // As edges que saem deste nó:
        const outEdges = edges.filter((e) => e.source === currentNodeId);

        if (Array.isArray(node.data?.options) && hasBackIntent) {
          const optionIndex = resolveMenuOptionIndex(text, node.data.options);
          if (optionIndex >= 0) {
            const edge = outEdges.find(
              (e) => String(e.sourceHandle) === String(optionIndex),
            );
            if (edge) {
              nextNodeId = edge.target;
            }
          }
        }

        if (!nextNodeId && !isNaN(optionMatched) && isPureNumericInput) {
          const candidateHandles: string[] = [];

          // Prioriza index baseado em 1 -> handle 0 (UI atual)
          if (optionMatched > 0) {
            candidateHandles.push(String(optionMatched - 1));
            candidateHandles.push(`option-${optionMatched - 1}`);
          }

          // Compatibilidade com fluxos antigos (1-based)
          candidateHandles.push(String(optionMatched));
          candidateHandles.push(`option-${optionMatched}`);

          const edgeByHandle = new Map(
            outEdges.map((e) => [String(e.sourceHandle), e]),
          );
          for (const handle of candidateHandles) {
            const edge = edgeByHandle.get(String(handle));
            if (edge) {
              nextNodeId = edge.target;
              break;
            }
          }
        } else if (!nextNodeId && Array.isArray(node.data?.options)) {
          const optionIndex = resolveMenuOptionIndex(text, node.data.options);
          if (optionIndex >= 0) {
            const edge = outEdges.find(
              (e) => String(e.sourceHandle) === String(optionIndex),
            );
            if (edge) {
              nextNodeId = edge.target;
            }
          }
        }

        if (nextNodeId) {
          node = nodes.find((n) => n.id === nextNodeId) || null;
        } else {
          const options = getNodeOptions(node.data);
          const menuText = buildMenuText(
            getMenuLikeNodeMessage(node.data),
            options,
          );

          if (!isNaN(optionMatched) && isPureNumericInput) {
            const invalidText =
              `Opção inválida. Escolha um número entre 1 e ${Math.max(options.length, 1)}.\n\n${menuText}`.trim();
            const invalidMessages: MessageResponse[] = [
              {
                text: invalidText,
                delay: resolveNodeDelay(node.data, 900),
                ...classifyMessage(invalidText),
              },
            ];
            await saveSessionState(
              currentNodeId!,
              sessionState,
              invalidMessages,
            );
            return invalidMessages;
          }

          return await sendFallbackResponse(
            menuText,
            currentNodeId!,
            sessionState,
            resolveNodeDelay(node.data, 1200),
          );
        }
      }
      if (node?.type === "productSearchNode") {
        const ctx = (sessionState?.productSearch || {}) as any;
        if (ctx?.nodeId === currentNodeId) {
          const normalized = normalizeText(text);
          const digitsMatch = normalized.match(/\d+/);
          const optionMatched = digitsMatch
            ? parseInt(digitsMatch[0], 10)
            : NaN;
          const hasMorePages = (ctx.page || 1) < (ctx.totalPages || 1);

          let wantsMore = false;
          let wantsDone = false;
          let wantsBack = false;

          if (hasMorePages) {
            wantsMore =
              optionMatched === 1 ||
              isYesOption(normalized, "ver mais") ||
              isYesOption(normalized, "mais opcoes") ||
              isYesOption(normalized, "mais opcoes dessa sessao") ||
              isYesOption(normalized, "mais opcoes dessa sessão");
            wantsDone =
              optionMatched === 2 ||
              isYesOption(normalized, "ja escolhi") ||
              isYesOption(normalized, "já escolhi") ||
              isYesOption(normalized, "seguir para proxima etapa") ||
              isYesOption(normalized, "seguir para próxima etapa") ||
              isYesOption(normalized, "seguir");
            wantsBack =
              optionMatched === 3 ||
              isYesOption(normalized, "voltar ao menu") ||
              isYesOption(normalized, "voltar") ||
              isYesOption(normalized, "menu");
          } else {
            wantsDone =
              optionMatched === 1 ||
              isYesOption(normalized, "ja escolhi") ||
              isYesOption(normalized, "já escolhi") ||
              isYesOption(normalized, "seguir para proxima etapa") ||
              isYesOption(normalized, "seguir para próxima etapa") ||
              isYesOption(normalized, "quero essa") ||
              isYesOption(normalized, "seguir");
            wantsBack =
              optionMatched === 2 ||
              isYesOption(normalized, "voltar ao menu") ||
              isYesOption(normalized, "voltar") ||
              isYesOption(normalized, "menu");
          }

          if (wantsMore) {
            const totalPages =
              typeof ctx.totalPages === "number" && ctx.totalPages > 0
                ? ctx.totalPages
                : 1;
            const nextPage =
              typeof ctx.page === "number" && ctx.page > 0 ? ctx.page + 1 : 2;
            if (nextPage > totalPages) {
              return [
                {
                  text: 'Não tenho mais opções nessa sessão. Se já escolheu, envie: "Já escolhi, seguir para próxima etapa".',
                },
              ];
            }
            sessionState = {
              ...sessionState,
              productSearch: { ...ctx, page: nextPage },
            };
            node = nodes.find((n) => n.id === currentNodeId) || null;
          } else if (wantsDone) {
            sessionState = { ...sessionState, productSearch: undefined };
            const foundEdge = edges.find(
              (e) =>
                e.source === currentNodeId &&
                String(e.sourceHandle) === "found",
            );
            const targetId = foundEdge?.target;
            if (!targetId) {
              const menuText = hasMorePages
                ? "Escolha uma opção:\n1. Ver mais opções dessa sessão\n2. Já escolhi, seguir para próxima etapa\n3. Voltar ao menu"
                : "Escolha uma opção:\n1. Já escolhi, seguir para próxima etapa\n2. Voltar ao menu";
              return await sendFallbackResponse(
                menuText,
                currentNodeId!,
                sessionState,
                resolveNodeDelay(node?.data, 1200),
              );
            }
            node = targetId ? nodes.find((n) => n.id === targetId) || null : null;
          } else if (wantsBack) {
            sessionState = { ...sessionState, productSearch: undefined };
            const backEdge = edges.find(
              (e) =>
                e.source === currentNodeId &&
                String(e.sourceHandle) === "back_to_menu",
            );
            if (!backEdge) {
              const menuText = hasMorePages
                ? "Escolha uma opção:\n1. Ver mais opções dessa sessão\n2. Já escolhi, seguir para próxima etapa\n3. Voltar ao menu"
                : "Escolha uma opção:\n1. Já escolhi, seguir para próxima etapa\n2. Voltar ao menu";
              return await sendFallbackResponse(
                menuText,
                currentNodeId!,
                sessionState,
                resolveNodeDelay(node?.data, 1200),
              );
            }
            node = nodes.find((n) => n.id === backEdge.target) || null;
          } else {
            const options = hasMorePages
              ? [
                  "Ver mais opções dessa sessão",
                  "Já escolhi, seguir para próxima etapa",
                  "Voltar ao menu",
                ]
              : ["Já escolhi, seguir para próxima etapa", "Voltar ao menu"];
            const menuText = `Escolha uma opção:\n${options
              .map((opt, index) => `${index + 1}. ${opt}`)
              .join("\n")}`.trim();

            if (!isNaN(optionMatched)) {
              const invalidText = `Opção inválida. Escolha uma das opções abaixo.\n\n${menuText}`;
              const invalidMessages: MessageResponse[] = [
                {
                  text: invalidText,
                  delay: resolveNodeDelay(node?.data, 900),
                  ...classifyMessage(invalidText),
                },
              ];
              await saveSessionState(
                currentNodeId!,
                sessionState,
                invalidMessages,
              );
              return invalidMessages;
            }

            return await sendFallbackResponse(
              menuText,
              currentNodeId!,
              sessionState,
              resolveNodeDelay(node?.data, 1200),
            );
          }
        }
      }
    }

    // At this point we are at the target node to be processed
    if (!node) {
      return [{ text: "Erro: Nó não encontrado." }];
    }

    // Vamos processar uma série de nós que talvez sejam atravessados automaticamente,
    // até parar num nó interativo ou finalizar as mensagens.
    let responseMessages: MessageResponse[] = [];
    const appendMessage = (
      text: string,
      delay?: number,
      extra?: Partial<MessageResponse>,
    ) => {
      responseMessages.push({
        text,
        delay,
        ...classifyMessage(text),
        ...extra,
      });
    };

    let currentNode: FlowNode | null = node;

    while (currentNode) {
      const state = sessionState || {};

      switch (currentNode.type) {
        case "startNode":
          if (currentNode.data?.message) {
            appendMessage(
              currentNode.data.message,
              resolveNodeDelay(currentNode.data, 1500),
            );
          }
          // Move to next node immediately
          const startEdge = edges.find((e) => e.source === currentNode?.id);
          currentNode = startEdge
            ? nodes.find((n) => n.id === startEdge.target) || null
            : null;
          continue;

        case "messageNode":
          appendMessage(
            currentNode.data?.message || "",
            resolveNodeDelay(currentNode.data, 1500),
          );
          // Move to next node immediately
          const msgEdge = edges.find((e) => e.source === currentNode?.id);
          currentNode = msgEdge
            ? nodes.find((n) => n.id === msgEdge.target) || null
            : null;
          continue;

        case "menuNode":
        case "followUpNode": {
          const options = getNodeOptions(currentNode.data);
          const menuText = buildMenuText(
            getMenuLikeNodeMessage(currentNode.data),
            options,
          );

          appendMessage(menuText, resolveNodeDelay(currentNode.data, 1500), {
            type: "menu",
          });
          // Stops here, waiting for user input
          await saveSessionState(currentNode.id, state, responseMessages);
          return responseMessages;
        }

        case "productSearchNode":
          // Perform search
          appendMessage(
            "🔍 Buscando opções para você...",
            resolveNodeDelay(currentNode.data, 1000),
          );

          const data = (currentNode.data || {}) as Record<string, any>;
          const searchTerm = String(data.searchQuery || data.searchPrefix || "").trim();
          const maxResults =
            typeof data.maxResults === "number" && data.maxResults > 0
              ? Math.round(data.maxResults)
              : null;
          const perPage = 6;

          const where: any = {};
          if (data.onlyActive) {
            where.is_active = true;
          }
          if (searchTerm) {
            const rawSearch = searchTerm.trim();
            const normalized = normalizeSearchTokens(searchTerm);
            const groups = normalized
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean);

            const buildTokenFilters = (group: string) => {
              const tokens = group
                .split(" ")
                .map((t) => t.trim())
                .filter(Boolean);
              if (tokens.length === 0) return null;
              if (tokens.length === 1) {
                return {
                  OR: [
                    { name: { contains: tokens[0], mode: "insensitive" } },
                    {
                      description: { contains: tokens[0], mode: "insensitive" },
                    },
                  ],
                };
              }
              return {
                AND: tokens.map((token) => ({
                  OR: [
                    { name: { contains: token, mode: "insensitive" } },
                    {
                      description: { contains: token, mode: "insensitive" },
                    },
                  ],
                })),
              };
            };

            const groupFilters = groups
              .map(buildTokenFilters)
              .filter(Boolean) as any[];

            const searchOrFilters: any[] = [];
            if (rawSearch) {
              searchOrFilters.push({
                name: { contains: rawSearch, mode: "insensitive" },
              });
              searchOrFilters.push({
                description: { contains: rawSearch, mode: "insensitive" },
              });
            }
            searchOrFilters.push(...groupFilters);

            if (searchOrFilters.length > 0) {
              where.OR = searchOrFilters;
            }
          }
          if (data.categoryId) {
            where.categories = {
              some: { category_id: data.categoryId },
            };
          }
          if (data.typeId) {
            where.type_id = data.typeId;
          }
          if (typeof data.minPrice === "number") {
            where.price = { ...(where.price || {}), gte: data.minPrice };
          }
          if (typeof data.maxPrice === "number") {
            where.price = { ...(where.price || {}), lte: data.maxPrice };
          }

          const requestedPage =
            sessionState?.productSearch?.nodeId === currentNode.id &&
            typeof sessionState.productSearch.page === "number"
              ? sessionState.productSearch.page
              : data.page;
          const page =
            typeof requestedPage === "number" && requestedPage > 0
              ? Math.round(requestedPage)
              : 1;
          const count = await prisma.product.count({ where });
          const total =
            typeof maxResults === "number"
              ? Math.min(count, maxResults)
              : count;
          const totalPages = Math.max(1, Math.ceil(total / perPage));
          const safePage = Math.min(Math.max(page, 1), totalPages);
          const effectiveSkip = (safePage - 1) * perPage;

          let take = perPage;
          if (typeof maxResults === "number") {
            if (effectiveSkip >= maxResults) {
              take = 0;
            } else {
              take = Math.min(perPage, maxResults - effectiveSkip);
            }
          }

          const products =
            take === 0
              ? []
              : await prisma.product.findMany({
                  where,
                  take,
                  skip: effectiveSkip,
                  orderBy: { price: "desc" },
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    price: true,
                    image_url: true,
                    production_time: true,
                  },
                });

          if (products.length === 0) {
            appendMessage(
              "Hmm, não encontrei produtos agora 😔",
              resolveNodeDelay(currentNode.data, 1200),
            );
            sessionState = { ...sessionState, productSearch: undefined };
            const notFoundEdge = edges.find(
              (e) =>
                e.source === currentNode?.id &&
                String(e.sourceHandle) === "not_found",
            );
            if (!notFoundEdge) {
              appendMessage(
                "No momento não encontrei opções para esse filtro. Digite menu para continuar.",
                1000,
              );
              await saveSessionState(
                currentNode.id,
                sessionState,
                responseMessages,
              );
              return responseMessages;
            }
            currentNode =
              nodes.find((n) => n.id === notFoundEdge.target) || null;
            continue;
          } else {
            for (let i = 0; i < products.length; i++) {
              const p = products[i];
              const previewUrl = resolvePreviewUrl(p.image_url);
              const description = p.description
                ? sanitizeProductDescription(p.description)
                : "";
              const productionTime =
                typeof p.production_time === "number" && p.production_time > 0
                  ? `${p.production_time} horas em horário comercial`
                  : "2 horas em horário comercial";

              const parts = [
                previewUrl,
                `*${p.name}* - VALOR - R$ ${formatPrice(p.price || 0)}`,
                description || null,
                `(Tempo de produção: ${productionTime})`,
              ].filter(Boolean);

              appendMessage(parts.join("\n"), 1000);
            }

            const hasMore = safePage < totalPages;
            const options = [];
            if (hasMore) {
              options.push("1. Ver mais opções dessa sessão");
              options.push("2. Já escolhi, seguir para próxima etapa");
              options.push("3. Voltar ao menu");
            } else {
              options.push("1. Já escolhi, seguir para próxima etapa");
              options.push("2. Voltar ao menu");
            }
            appendMessage(
              `Escolha uma opção:\n${options.join("\n")}`,
              resolveNodeDelay(currentNode.data, 800),
              {
                type: "menu",
              },
            );

            sessionState = {
              ...sessionState,
              productSearch: {
                nodeId: currentNode.id,
                page: safePage,
                perPage,
                total,
                totalPages,
                maxResults,
              },
            };

            await saveSessionState(
              currentNode.id,
              sessionState,
              responseMessages,
            );
            return responseMessages;
          }

          continue;

        case "handoffNode":
          return await activateHumanHandoff({
            botText: currentNode.data?.message || "Vou chamar um atendente.",
            stateObj: state,
            delayMs: resolveNodeDelay(currentNode.data, 1000),
          });

        case "blockNode":
          return await activateSilentBlock({
            botText: String(currentNode.data?.message || currentNode.data?.content || ""),
            stateObj: state,
            delayMs: resolveNodeDelay(currentNode.data, 900),
          });

        default:
          currentNode = null;
      }
    }

    if (responseMessages.length > 0) {
      const finalNodeId = null;
      await saveSessionState(finalNodeId, sessionState, responseMessages);
    }
    return responseMessages;
  },
};
