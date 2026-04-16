import type { SessionMemoryState } from "./openClawMemoryService";

export type SalesPhase = "DISCOVERY" | "CURATION" | "CUSTOMIZATION" | "CHECKOUT";
export type PhaseAgentName = "Ana" | "Bianca" | "Lucas" | "Alice";

export type PhaseChecklist = {
  discoveryQualified: boolean;
  productSelected: boolean;
  customizationDecided: boolean;
  checkoutDataCollected: boolean;
};

export type PhaseResolution = {
  phase: SalesPhase;
  agentName: PhaseAgentName;
  checklist: PhaseChecklist;
  reason: string;
};

class PhaseGateService {
  getAgentName(phase: SalesPhase): PhaseAgentName {
    switch (phase) {
      case "DISCOVERY":
        return "Ana";
      case "CURATION":
        return "Bianca";
      case "CUSTOMIZATION":
        return "Lucas";
      case "CHECKOUT":
        return "Alice";
      default:
        return "Ana";
    }
  }

  getChecklist(memory: SessionMemoryState): PhaseChecklist {
    const discoveryQualified = Boolean(
      memory.client.occasion ||
        memory.client.audience ||
        memory.client.recipientName,
    );
    const productSelected = Boolean(
      memory.conversation.selectedProductConfirmed && memory.focusedProductId,
    );
    const customizationDecided =
      productSelected && memory.conversation.customizationDecision !== "pending";
    const checkoutDataCollected =
      customizationDecided &&
      memory.conversation.checkoutData.dateTime &&
      memory.conversation.checkoutData.address &&
      memory.conversation.checkoutData.payment;

    return {
      discoveryQualified,
      productSelected,
      customizationDecided,
      checkoutDataCollected,
    };
  }

  resolvePhase(memory: SessionMemoryState, userMessage: string): PhaseResolution {
    const lower = (userMessage || "").toLowerCase();
    const checklist = this.getChecklist(memory);

    if (
      /\b(mais op[cç][oõ]es|outra op[cç][aã]o|me mostra mais|tem outras)\b/i.test(
        lower,
      )
    ) {
      return {
        phase: "CURATION",
        agentName: this.getAgentName("CURATION"),
        checklist,
        reason: "cliente_solicitou_mais_opcoes",
      };
    }

    if (!checklist.discoveryQualified) {
      return {
        phase: "DISCOVERY",
        agentName: this.getAgentName("DISCOVERY"),
        checklist,
        reason: "falta_qualificacao_inicial",
      };
    }

    if (!checklist.productSelected) {
      return {
        phase: "CURATION",
        agentName: this.getAgentName("CURATION"),
        checklist,
        reason: "produto_ainda_nao_confirmado",
      };
    }

    if (!checklist.customizationDecided) {
      return {
        phase: "CUSTOMIZATION",
        agentName: this.getAgentName("CUSTOMIZATION"),
        checklist,
        reason: "customizacao_ou_adicionais_pendentes",
      };
    }

    return {
      phase: "CHECKOUT",
      agentName: this.getAgentName("CHECKOUT"),
      checklist,
      reason: checklist.checkoutDataCollected
        ? "checkout_pronto_para_confirmacao"
        : "coleta_checkout_em_andamento",
    };
  }
}

export default new PhaseGateService();
