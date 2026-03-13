import { PrismaClient } from "@prisma/client";
import whatsappService from "./whatsappService";
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
}

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
          history: []
        },
      });
    }

    if (session) {
      history = (Array.isArray(session.history) ? session.history : []) as any[];
      if (rawText) {
         history.push({ role: "user", text: message, created_at: new Date().toISOString() });
      }

      sessionState = (session.state as any) || {};
      if (contactName && sessionState.contactName !== contactName) {
        sessionState.contactName = contactName;
        await prisma.botSession.update({
          where: { id: session.id },
          data: { state: sessionState }
        });
      }
    }

    if (session && session.is_human) {
      return []; // Return empty if human is handling
    }

    // Reset se pedir menu
    if (
      ["oi", "ola", "olá", "menu", "início", "inicio", "voltar"].includes(text)
    ) {
      session.current_node_id = null;
    }

    let currentNodeId = session.current_node_id;
    let node = nodes.find((n) => n.id === currentNodeId);

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

          const edge = outEdges.find((e) =>
            candidateHandles.includes(String(e.sourceHandle)),
          );
          if (edge) {
            nextNodeId = edge.target;
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
          return [
            {
              text:
                "Opção inválida. Tente novamente.\n\n" +
                (node.data?.message || ""),
            },
          ];
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

    let currentNode = node;
    
    const saveSessionState = async (cNodeId: string | null, stateObj: any, msgs: any[]) => {
      const finalHistory = [...history];
      msgs.forEach(m => finalHistory.push({ role: "bot", text: m.text, type: m.type || "text", delay: m.delay, created_at: new Date().toISOString() }));
      await prisma.botSession.update({
        where: { id: session!.id },
        data: { 
          current_node_id: cNodeId, 
          state: stateObj,
          history: finalHistory as any,
          updated_at: new Date()
        }
      });
    };

    while (currentNode) {
      const state = sessionState || {};

      switch (currentNode.type) {
        case "startNode":
          if (currentNode.data?.message) {
            responseMessages.push({
              text: currentNode.data.message,
              delay: 1500,
            });
          }
          // Move to next node immediately
          const startEdge = edges.find((e) => e.source === currentNode?.id);
          currentNode = startEdge
            ? nodes.find((n) => n.id === startEdge.target)
            : null;
          continue;

        case "messageNode":
          responseMessages.push({
            text: currentNode.data?.message || "",
            delay: 1500,
          });
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
                typeof opt === "string" ? opt : opt?.label || opt?.value || `Opção ${index + 1}`;
              return `${index + 1}. ${String(label).trim()}`;
            });
            menuText = `${baseMessage}\n\n${optionLines.join("\n")}`.trim();
          }

          responseMessages.push({
            text: menuText,
            delay: 1500,
            type: "menu",
          });
          // Stops here, waiting for user input
          await saveSessionState(currentNode.id, state, responseMessages);
          return responseMessages;
        }

        case "productSearchNode":
          // Perform search
          responseMessages.push({
            text: "🔍 Buscando opções para você...",
            delay: 1000,
          });

          let products: any[] = [];
          const sq = currentNode.data?.searchQuery || "";

          if (sq) {
            products = await prisma.$queryRawUnsafe(`
                SELECT id, name, description, price, image_url, production_time 
                FROM public."Product" 
                WHERE is_active = true AND (${sq}) 
                ORDER BY price DESC LIMIT 8
              `);
          }

          if (products.length === 0) {
            responseMessages.push({
              text: `Hmm, não encontrei produtos agora 😔`,
              delay: 1500,
            });
          } else {
            responseMessages.push({
              text: `Encontrei estas opções:`,
              delay: 1500,
            });
            for (let i = 0; i < products.length; i++) {
              const p = products[i] as any;
              let msg = "";
              if (p.image_url) msg += `${p.image_url}\n`;

              msg += `_Opção ${i + 1}_: *${p.name}* - R$ ${p.price.toFixed(2).replace(".", ",")}\n`;
              if (p.description)
                msg += `${p.description.replace(/<[^>]*>/g, "").replace(/\\[.*?\\]/g, "")}\n`;
              msg += `(Produção: ${p.production_time || 2} horas em horário comercial)`;

              responseMessages.push({ text: msg, delay: 2000 });
            }
          }

          // Move to next node immediately
          const searchEdge = edges.find((e) => e.source === currentNode?.id);
          currentNode = searchEdge
            ? nodes.find((n) => n.id === searchEdge.target)
            : null;
          continue;

        case "handoffNode":
          responseMessages.push({
            text: currentNode.data?.message || "Vou chamar um atendente.",
            delay: 1000,
          });
          
          await saveSessionState(null, { ...state, is_human: true }, responseMessages);
          await prisma.botSession.update({ where: { id: session.id }, data: { is_human: true }});
          
          // Envia notificação para a equipe via WhatsApp
          const cName = ((session.state as any)?.contactName) || contactName || "Cliente";
          let alertMsg = `🚨 *ATENDIMENTO HUMANO SOLICITADO* 🚨\n\n`;
          alertMsg += `*Nome:* ${cName}\n`;
          alertMsg += `*WhatsApp:* https://wa.me/${phone}\n`;
          alertMsg += `*Ação:* O bot foi pausado para este cliente.`;
          
          try {
             await whatsappService.sendMessage(alertMsg);
          } catch (e) {
             console.error("[BotFlow] Erro ao notificar atendente de handoff:", e);
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
