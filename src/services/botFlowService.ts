import { PrismaClient } from "@prisma/client";
import whatsappService from "./whatsappService";
import aiAgentService from "./aiAgentService";
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

const BASE_URL = process.env.BASE_URL || "https://api.cestodamore.com.br";
const BOT_HANDOFF_GROUP_ID =
  process.env.WHATSAPP_BOT_HANDOFF_GROUP_ID || "120363421291021203@g.us";

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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s,]+/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isYesOption = (value: string, option: string) => {
  const normalized = normalizeText(value);
  return normalized.includes(option);
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

  async processMessage({
    phone,
    message,
    contactName,
  }: BotMessageRequest): Promise<MessageResponse[]> {
    const rawText = (message || "").toString().trim();
    const text = rawText.toLowerCase();

    // Find or create session
    let session = await prisma.botSession.findUnique({
      where: { phone },
    });

    // Default state building
    let sessionState: Record<string, any> = {};

    let history: any[] = [];

    const flow = await this.getActiveFlow();
    const nodes = (flow.nodes as any[]) || [];
    const edges = (flow.edges as any[]) || [];

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

    if (session && session.is_human) {
      return []; // Return empty if human is handling
    }

    // Reset se pedir menu
    if (["oi", "ola", "olá", "menu", "início", "inicio"].includes(text)) {
      session.current_node_id = null;
    }

    let currentNodeId = session.current_node_id;
    let node = nodes.find((n) => n.id === currentNodeId);

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

    const sendFallbackResponse = async (
      menuText: string,
      nodeId: string,
      stateObj: any,
      delayMs?: number,
    ) => {
      const fallbackText = await aiAgentService.processFallback({
        userMessage: rawText,
        menuText,
        sessionHistory: history,
        customerName:
          (sessionState as any)?.contactName || contactName || "Cliente",
      });
      const fallbackMessages: MessageResponse[] = [
        {
          text: fallbackText,
          delay: typeof delayMs === "number" ? delayMs : 800,
          ...classifyMessage(fallbackText),
        },
      ];
      await saveSessionState(nodeId, stateObj, fallbackMessages);
      return fallbackMessages;
    };

    const normalizedRawText = normalizeText(rawText);
    const isCartAddedInternalEvent =
      normalizedRawText.includes("[interno]") &&
      normalizedRawText.includes("evento=cart_added");
    const isInternalImageInstruction =
      normalizedRawText.includes("[informacoes internas]") &&
      normalizedRawText.includes("o cliente mandou uma imagem");

    const forceHumanHandoff = async (reason: string) => {
      const handoffMessages: MessageResponse[] = [
        {
          text: "Perfeito! Vou te encaminhar para atendimento humano agora.",
          delay: 600,
          ...classifyMessage(
            "Perfeito! Vou te encaminhar para atendimento humano agora.",
          ),
        },
      ];

      const handoffState = {
        ...sessionState,
        is_human: true,
        forced_handoff_reason: reason,
      };

      await saveSessionState(null, handoffState, handoffMessages);
      await prisma.botSession.update({
        where: { id: session.id },
        data: { is_human: true },
      });

      const cName =
        (session.state as any)?.contactName || contactName || "Cliente";
      let alertMsg = `🚨 *ATENDIMENTO HUMANO FORÇADO (BOT)* 🚨\n\n`;
      alertMsg += `*Motivo:* ${reason}\n`;
      alertMsg += `*Nome:* ${cName}\n`;
      alertMsg += `*WhatsApp:* https://wa.me/${phone}\n`;
      alertMsg += `*Entrada:* ${rawText.slice(0, 700)}\n`;
      alertMsg += `*Ação:* O bot foi pausado e o cliente deve ser atendido por humano.`;

      try {
        await whatsappService.sendMessage(alertMsg, BOT_HANDOFF_GROUP_ID);
      } catch (e) {
        console.error(
          "[BotFlow] Erro ao notificar atendente de handoff forçado:",
          e,
        );
      }

      return handoffMessages;
    };

    if (isCartAddedInternalEvent) {
      return await forceHumanHandoff("Evento interno CART_ADDED");
    }

    if (isInternalImageInstruction) {
      return await forceHumanHandoff("Mensagem interna de imagem recebida");
    }

    // Se nao tem node, acha o node inicial (tipo 'start' ou o primeiro sem source edge)
    if (!node) {
      node = nodes.find((n) => n.type === "startNode") || nodes[0];
      if (!node) return [{ text: "O fluxo ainda não foi configurado." }];
      currentNodeId = node.id;
    } else {
      // Process input based on node type
      if (node.type === "menuNode") {
        // Tenta achar a opcao escolhida
        const digitsMatch = text.match(/\d+/);
        const optionMatched = digitsMatch ? parseInt(digitsMatch[0], 10) : NaN;
        let nextNodeId: string | null = null;

        // As edges que saem deste nó:
        const outEdges = edges.filter((e) => e.source === currentNodeId);

        if (!isNaN(optionMatched)) {
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
        } else if (Array.isArray(node.data?.options)) {
          const normalizedText = text.trim();
          const optionIndex = node.data.options.findIndex((opt: any) => {
            const label =
              typeof opt === "string" ? opt : opt?.label || opt?.value || "";
            return String(label).trim().toLowerCase() === normalizedText;
          });
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
          node = nodes.find((n) => n.id === nextNodeId);
        } else {
          const options = Array.isArray(node.data?.options)
            ? node.data.options
            : [];
          const menuText = buildMenuText(node.data?.message || "", options);

          if (!isNaN(optionMatched)) {
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
      if (node.type === "productSearchNode") {
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
            node = nodes.find((n) => n.id === currentNodeId);
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
                resolveNodeDelay(node.data, 1200),
              );
            }
            node = targetId ? nodes.find((n) => n.id === targetId) : null;
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
                resolveNodeDelay(node.data, 1200),
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

    let currentNode = node;

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
            ? nodes.find((n) => n.id === startEdge.target)
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
            ? nodes.find((n) => n.id === msgEdge.target)
            : null;
          continue;

        case "menuNode": {
          const options = Array.isArray(currentNode.data?.options)
            ? currentNode.data.options
            : [];
          const baseMessage = currentNode.data?.message || "";
          let menuText = baseMessage;
          if (options.length > 0) {
            const optionLines = options.map((opt: any, index: number) => {
              const label =
                typeof opt === "string"
                  ? opt
                  : opt?.label || opt?.value || `Opção ${index + 1}`;
              return `${index + 1}. ${String(label).trim()}`;
            });
            menuText = `${baseMessage}\n\n${optionLines.join("\n")}`.trim();
          }

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

          const data = currentNode.data || {};
          const searchTerm = (
            data.searchQuery ||
            data.searchPrefix ||
            ""
          ).trim();
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

            if (groupFilters.length > 0) {
              where.OR = groupFilters;
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
          appendMessage(
            currentNode.data?.message || "Vou chamar um atendente.",
            resolveNodeDelay(currentNode.data, 1000),
          );

          await saveSessionState(
            null,
            { ...state, is_human: true },
            responseMessages,
          );
          await prisma.botSession.update({
            where: { id: session.id },
            data: { is_human: true },
          });

          // Envia notificação para a equipe via WhatsApp
          const cName =
            (session.state as any)?.contactName || contactName || "Cliente";
          let alertMsg = `🚨 *ATENDIMENTO HUMANO SOLICITADO* 🚨\n\n`;
          alertMsg += `*Nome:* ${cName}\n`;
          alertMsg += `*WhatsApp:* https://wa.me/${phone}\n`;
          alertMsg += `*Ação:* O bot foi pausado para este cliente.`;

          try {
            await whatsappService.sendMessage(alertMsg, BOT_HANDOFF_GROUP_ID);
          } catch (e) {
            console.error(
              "[BotFlow] Erro ao notificar atendente de handoff:",
              e,
            );
          }

          return responseMessages;

        default:
          currentNode = null;
      }
    }

    if (responseMessages.length > 0) {
      const finalNodeId = currentNode ? currentNode.id : null;
      await saveSessionState(finalNodeId, sessionState, responseMessages);
    }
    return responseMessages;
  },
};
