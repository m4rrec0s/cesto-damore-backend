import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

interface BotMessageRequest {
  phone: string;
  message: string;
  contactName?: string;
}

interface MessageResponse {
  text: string;
  delay?: number;
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
    const text = (message || "").toString().trim().toLowerCase();

    // Find or create session
    let session = await prisma.botSession.findUnique({
      where: { phone },
    });

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
          state: {},
        },
      });
    }

    if (session.is_human) {
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
        const optionMatched = parseInt(text);
        let nextNodeId = null;

        // As edges que saem deste nó:
        const outEdges = edges.filter((e) => e.source === currentNodeId);

        if (!isNaN(optionMatched)) {
          // Find edge with sourceHandle matching the option (e.g. `option-1`)
          const edge = outEdges.find(
            (e) => e.sourceHandle === `option-${optionMatched}`,
          );
          if (edge) {
            nextNodeId = edge.target;
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
    while (currentNode) {
      const state = (session.state as any) || {};

      switch (currentNode.type) {
        case "startNode":
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

        case "menuNode":
          responseMessages.push({
            text: currentNode.data?.message || "",
            delay: 1500,
          });
          // Stops here, waiting for user input
          await prisma.botSession.update({
            where: { id: session.id },
            data: { current_node_id: currentNode.id, state },
          });
          return responseMessages;

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
          await prisma.botSession.update({
            where: { id: session.id },
            data: { is_human: true, current_node_id: null },
          });
          // Parar chat
          return responseMessages;

        default:
          currentNode = null;
      }
    }

    return responseMessages;
  },
};
