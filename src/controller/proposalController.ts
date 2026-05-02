import { Request, Response } from "express";
import improvementProposalService from "../services/improvementProposalService";
import logger from "../utils/logger";

export const proposalController = {
  async index(req: Request, res: Response) {
    try {
      const { status, type } = req.query;
      const proposals = await improvementProposalService.listProposals({
        status: status as string | undefined,
        type: type as any,
      });
      res.json({ proposals });
    } catch (error: any) {
      logger.error("[ProposalController] Index error:", error);
      res.status(500).json({ error: error.message || "Failed to list proposals" });
    }
  },

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const proposal = await improvementProposalService.getProposal(id);
      if (!proposal) {
        return res.status(404).json({ error: "Proposal not found" });
      }
      res.json({ proposal });
    } catch (error: any) {
      logger.error("[ProposalController] Show error:", error);
      res.status(500).json({ error: error.message || "Failed to get proposal" });
    }
  },

  async approve(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const { notes } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const proposal = await improvementProposalService.approveProposal(
        id,
        userId,
        notes
      );
      res.json({ proposal });
    } catch (error: any) {
      logger.error("[ProposalController] Approve error:", error);
      res.status(500).json({ error: error.message || "Failed to approve proposal" });
    }
  },

  async reject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const { notes } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const proposal = await improvementProposalService.rejectProposal(
        id,
        userId,
        notes
      );
      res.json({ proposal });
    } catch (error: any) {
      logger.error("[ProposalController] Reject error:", error);
      res.status(500).json({ error: error.message || "Failed to reject proposal" });
    }
  },

  async implement(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await improvementProposalService.implementProposal(
        id,
        userId
      );
      res.json(result);
    } catch (error: any) {
      logger.error("[ProposalController] Implement error:", error);
      res.status(500).json({ error: error.message || "Failed to implement proposal" });
    }
  },

  async getStats(req: Request, res: Response) {
    try {
      const stats = await improvementProposalService.getStats();
      res.json(stats);
    } catch (error: any) {
      logger.error("[ProposalController] Stats error:", error);
      res.status(500).json({ error: error.message || "Failed to get stats" });
    }
  },

  async getPendingCount(req: Request, res: Response) {
    try {
      const count = await improvementProposalService.getPendingCount();
      res.json({ count });
    } catch (error: any) {
      logger.error("[ProposalController] Pending count error:", error);
      res.status(500).json({ error: error.message || "Failed to get count" });
    }
  },
};

export default proposalController;