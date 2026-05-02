import prisma from "../database/prisma";
import logger from "../utils/logger";
import obsidianKnowledgeService from "./obsidianKnowledgeService";

export type ProposalType =
  | "repetitive_question"
  | "common_objection"
  | "uncovered_scenario"
  | "success_pattern"
  | "content_update";

export interface CreateProposalInput {
  sessionId: string;
  customerPhone?: string;
  proposalType: ProposalType;
  currentDocumentId?: string;
  suggestedContent: string;
  reasoning: string;
}

export interface ProposalFilters {
  status?: string;
  type?: ProposalType;
}

class ImprovementProposalService {
  async createProposal(input: CreateProposalInput) {
    const proposal = await prisma.improvementProposal.create({
      data: {
        session_id: input.sessionId,
        customer_phone: input.customerPhone || null,
        proposal_type: input.proposalType,
        current_document_id: input.currentDocumentId || null,
        suggested_content: input.suggestedContent,
        reasoning: input.reasoning,
        status: "pending",
      },
    });

    logger.info(
      `[ImprovementProposal] Created proposal: ${proposal.id} (${input.proposalType})`
    );

    return proposal;
  }

  async listProposals(filters?: ProposalFilters) {
    const where: any = {};

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.type) {
      where.proposal_type = filters.type;
    }

    return prisma.improvementProposal.findMany({
      where,
      orderBy: { detected_at: "desc" },
    });
  }

  async getProposal(id: string) {
    return prisma.improvementProposal.findUnique({
      where: { id },
    });
  }

  async approveProposal(id: string, approverId: string, notes?: string) {
    const proposal = await prisma.improvementProposal.findUnique({
      where: { id },
    });

    if (!proposal) {
      throw new Error("Proposal not found");
    }

    const updated = await prisma.improvementProposal.update({
      where: { id },
      data: {
        status: "approved",
        approved_by: approverId,
        approval_notes: notes || null,
      },
    });

    logger.info(`[ImprovementProposal] Approved proposal: ${id}`);

    return updated;
  }

  async rejectProposal(id: string, approverId: string, notes?: string) {
    const updated = await prisma.improvementProposal.update({
      where: { id },
      data: {
        status: "rejected",
        approved_by: approverId,
        approval_notes: notes || null,
      },
    });

    logger.info(`[ImprovementProposal] Rejected proposal: ${id}`);

    return updated;
  }

  async implementProposal(proposalId: string, approverId: string) {
    const proposal = await prisma.improvementProposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      throw new Error("Proposal not found");
    }

    if (proposal.status !== "approved") {
      throw new Error("Proposal must be approved before implementation");
    }

    const category = this.mapProposalTypeToCategory(proposal.proposal_type);

    const document = await obsidianKnowledgeService.createDocument({
      title: `Auto-generated: ${proposal.proposal_type}`,
      content: proposal.suggested_content,
      category,
      phases: ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"],
      tags: [proposal.proposal_type],
      createdBy: "SYSTEM",
    });

    await obsidianKnowledgeService.approveDocument(document.id, approverId);

    await prisma.improvementProposal.update({
      where: { id: proposalId },
      data: {
        status: "approved",
        implemented_at: new Date(),
        implemented_as_doc_id: document.id,
      },
    });

    logger.info(
      `[ImprovementProposal] Implemented proposal ${proposalId} as document ${document.id}`
    );

    return { proposal, document };
  }

  async getPendingCount() {
    return prisma.improvementProposal.count({
      where: { status: "pending" },
    });
  }

  async getStats() {
    const total = await prisma.improvementProposal.count();
    const pending = await prisma.improvementProposal.count({
      where: { status: "pending" },
    });
    const approved = await prisma.improvementProposal.count({
      where: { status: "approved" },
    });
    const implemented = await prisma.improvementProposal.count({
      where: { NOT: { implemented_at: null } },
    });

    return { total, pending, approved, implemented };
  }

  private mapProposalTypeToCategory(proposalType: string): any {
    const mapping: Record<string, string> = {
      repetitive_question: "pattern",
      common_objection: "objection",
      uncovered_scenario: "troubleshooting",
      success_pattern: "upsell",
      content_update: "general",
    };
    return mapping[proposalType] || "general";
  }
}

export default new ImprovementProposalService();