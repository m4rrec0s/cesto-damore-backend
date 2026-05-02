import { Request, Response } from "express";
import obsidianKnowledgeService, {
  type KBDocumentCategory,
  type SalesPhase,
} from "../services/obsidianKnowledgeService";
import logger from "../utils/logger";

const KB_DOCUMENT_CATEGORIES = [
  "faq",
  "pattern",
  "objection",
  "upsell",
  "troubleshooting",
  "general",
];

const SALES_PHASES = ["DISCOVERY", "CURATION", "CUSTOMIZATION", "CHECKOUT"];

export const knowledgeBaseController = {
  async create(req: Request, res: Response) {
    try {
      const { title, content, category, phases, tags, patternType } = req.body;

      if (!title || !content || !category) {
        return res.status(400).json({
          error: "Title, content, and category are required",
        });
      }

      if (!KB_DOCUMENT_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: `Invalid category. Allowed: ${KB_DOCUMENT_CATEGORIES.join(", ")}`,
        });
      }

      if (!phases || !Array.isArray(phases) || phases.length === 0) {
        return res.status(400).json({
          error: "At least one phase is required",
        });
      }

      const validPhases = phases.filter((p: string) =>
        SALES_PHASES.includes(p)
      );
      if (validPhases.length === 0) {
        return res.status(400).json({
          error: `Invalid phases. Allowed: ${SALES_PHASES.join(", ")}`,
        });
      }

      const userId = req.user?.id || "SYSTEM";

      const document = await obsidianKnowledgeService.createDocument({
        title,
        content,
        category: category as KBDocumentCategory,
        phases: validPhases as SalesPhase[],
        tags,
        patternType,
        createdBy: userId,
      });

      res.status(201).json({ document });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Create error:", error);
      res.status(500).json({ error: error.message || "Failed to create document" });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { title, content, category, phases, tags, patternType } = req.body;

      const userId = req.user?.id || "SYSTEM";

      const document = await obsidianKnowledgeService.updateDocument(
        id,
        { title, content, category, phases, tags, patternType },
        userId
      );

      res.json({ document });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Update error:", error);
      res.status(500).json({ error: error.message || "Failed to update document" });
    }
  },

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const document = await obsidianKnowledgeService.getDocument(id);

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.json({ document });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Show error:", error);
      res.status(500).json({ error: error.message || "Failed to get document" });
    }
  },

  async index(req: Request, res: Response) {
    try {
      const { category, phase, approvalStatus, tags, search } = req.query;

      const phases = phase
        ? Array.isArray(phase)
          ? (phase as string[])
          : [phase as string]
        : undefined;

      const documents = await obsidianKnowledgeService.listDocuments({
        category: category as KBDocumentCategory | undefined,
        phases: phases as SalesPhase[] | undefined,
        approvalStatus: approvalStatus as any,
        tags: tags ? (tags as string).split(",") : undefined,
        search: search as string | undefined,
      });
      res.json({ documents });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Index error:", error);
      res.status(500).json({ error: error.message || "Failed to list documents" });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await obsidianKnowledgeService.archiveDocument(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Delete error:", error);
      res.status(500).json({ error: error.message || "Failed to delete document" });
    }
  },

  async approve(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const document = await obsidianKnowledgeService.approveDocument(id, userId);
      res.json({ document });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Approve error:", error);
      res.status(500).json({ error: error.message || "Failed to approve document" });
    }
  },

  async search(req: Request, res: Response) {
    try {
      const { query, topK, phase } = req.body;

      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      const results = await obsidianKnowledgeService.hybridSearch(
        query,
        topK ? parseInt(topK as string, 10) : 5,
        phase as SalesPhase | undefined
      );

      res.json({ results });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Search error:", error);
      res.status(500).json({ error: error.message || "Failed to search" });
    }
  },

  async getByPhase(req: Request, res: Response) {
    try {
      const { phase } = req.params;

      if (!SALES_PHASES.includes(phase)) {
        return res.status(400).json({
          error: `Invalid phase. Allowed: ${SALES_PHASES.join(", ")}`,
        });
      }

      const documents = await obsidianKnowledgeService.getDocumentsByPhase(
        phase as SalesPhase
      );

      res.json({ documents });
    } catch (error: any) {
      logger.error("[KnowledgeBase] GetByPhase error:", error);
      res.status(500).json({ error: error.message || "Failed to get documents" });
    }
  },

  async getVersions(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const versions = await obsidianKnowledgeService.getVersionHistory(id);
      res.json({ versions });
    } catch (error: any) {
      logger.error("[KnowledgeBase] GetVersions error:", error);
      res.status(500).json({ error: error.message || "Failed to get versions" });
    }
  },

  async revert(req: Request, res: Response) {
    try {
      const { id, version } = req.params;
      const userId = req.user?.id || "SYSTEM";

      await obsidianKnowledgeService.revertToVersion(
        id,
        parseInt(version, 10),
        userId
      );

      res.json({ success: true });
    } catch (error: any) {
      logger.error("[KnowledgeBase] Revert error:", error);
      res.status(500).json({ error: error.message || "Failed to revert" });
    }
  },

  async getAnalytics(req: Request, res: Response) {
    try {
      const analytics = await obsidianKnowledgeService.getAnalytics();
      res.json(analytics);
    } catch (error: any) {
      logger.error("[KnowledgeBase] Analytics error:", error);
      res.status(500).json({ error: error.message || "Failed to get analytics" });
    }
  },
};

export default knowledgeBaseController;