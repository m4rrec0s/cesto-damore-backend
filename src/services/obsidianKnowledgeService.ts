import prisma from "../database/prisma";
import logger from "../utils/logger";
import { createOpenAIClient } from "../config/openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

export type KBDocumentCategory =
  | "faq"
  | "pattern"
  | "objection"
  | "upsell"
  | "troubleshooting"
  | "general";

export type SalesPhase = "DISCOVERY" | "CURATION" | "CUSTOMIZATION" | "CHECKOUT";

export type KBApprovalStatus = "draft" | "approved" | "archived";

export interface CreateKBDocumentInput {
  title: string;
  content: string;
  category: KBDocumentCategory;
  phases: SalesPhase[];
  tags?: string[];
  patternType?: string;
  createdBy?: string;
}

export interface UpdateKBDocumentInput {
  title?: string;
  content?: string;
  category?: KBDocumentCategory;
  phases?: SalesPhase[];
  tags?: string[];
  patternType?: string;
}

export interface KBDocumentFilters {
  category?: KBDocumentCategory;
  phases?: SalesPhase[];
  approvalStatus?: KBApprovalStatus;
  tags?: string[];
  search?: string;
}

export interface KBHybridSearchResult {
  documentId: string;
  title: string;
  content: string;
  category: string;
  phases: string[];
  score: number;
  source: "vector" | "keyword";
}

export interface KBAnalytics {
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
}

class ObsidianKnowledgeService {
  private openai = createOpenAIClient();

  private cosineSimilarity(a: number[], b: number[]) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
      return -1;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (!normA || !normB) return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async createDocument(input: CreateKBDocumentInput) {
    const document = await prisma.kBKnowledgeDocument.create({
      data: {
        title: input.title,
        content: input.content,
        category: input.category,
        phases: input.phases,
        tags: input.tags || [],
        pattern_type: input.patternType || null,
        created_by: input.createdBy || "SYSTEM",
        approval_status: "draft",
      },
    });

    await prisma.kBVersion.create({
      data: {
        document_id: document.id,
        version: 1,
        content: input.content,
        changed_by: input.createdBy || "SYSTEM",
        change_reason: "Initial creation",
      },
    });

    await this.generateEmbedding(document.id, input.content);

    logger.info(`[ObsidianKB] Created document: ${document.id}`);
    return document;
  }

  async updateDocument(id: string, input: UpdateKBDocumentInput, changedBy: string) {
    const current = await prisma.kBKnowledgeDocument.findUnique({
      where: { id },
    });

    if (!current) {
      throw new Error("Document not found");
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (typeof input.title === "string") updateData.title = input.title;
    if (typeof input.content === "string") updateData.content = input.content;
    if (typeof input.category === "string") updateData.category = input.category;
    if (Array.isArray(input.phases)) updateData.phases = input.phases;
    if (Array.isArray(input.tags)) updateData.tags = input.tags;
    if (typeof input.patternType === "string") {
      updateData.pattern_type = input.patternType;
    }

    const updated = await prisma.kBKnowledgeDocument.update({
      where: { id },
      data: updateData,
    });

    const newVersion = (current as any).version + 1;

    await prisma.kBVersion.create({
      data: {
        document_id: id,
        version: newVersion,
        content: input.content || (current as any).content,
        changed_by: changedBy,
        change_reason: `Update to version ${newVersion}`,
      },
    });

    if (input.content) {
      await this.generateEmbedding(id, input.content);
    }

    logger.info(`[ObsidianKB] Updated document: ${id} to version ${newVersion}`);
    return updated;
  }

  async getDocument(id: string) {
    return prisma.kBKnowledgeDocument.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 10,
        },
      },
    });
  }

  async listDocuments(filters?: KBDocumentFilters) {
    const where: any = {};

    if (filters?.category) {
      where.category = filters.category;
    }
    if (filters?.phases && filters.phases.length > 0) {
      where.phases = { hasSome: filters.phases };
    }
    if (filters?.approvalStatus) {
      where.approval_status = filters.approvalStatus;
    }
    if (filters?.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }
    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { content: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    return prisma.kBKnowledgeDocument.findMany({
      where,
      orderBy: { updated_at: "desc" },
    });
  }

  async archiveDocument(id: string) {
    return prisma.kBKnowledgeDocument.update({
      where: { id },
      data: { approval_status: "archived" },
    });
  }

  async approveDocument(id: string, approverId: string) {
    return prisma.kBKnowledgeDocument.update({
      where: { id },
      data: {
        approval_status: "approved",
        approved_by: approverId,
      },
    });
  }

  async searchSimilarDocuments(
    query: string,
    topK: number = 5,
    phase?: SalesPhase
  ): Promise<KBHybridSearchResult[]> {
    const embeddingResponse = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });

    const queryVector = embeddingResponse.data[0]?.embedding || [];

    const where: any = {
      approval_status: "approved",
    };
    if (phase) {
      where.phases = { has: phase };
    }

    const documents = await prisma.kBKnowledgeDocument.findMany({
      where,
      include: {
        embeddings: {
          take: 1,
        },
      },
    });

    const results: KBHybridSearchResult[] = [];

    for (const doc of documents) {
      const vectorStr = (doc as any).embeddings[0]?.vector as string | undefined;
      if (!vectorStr) continue;

      let vector: number[];
      try {
        vector = JSON.parse(vectorStr);
      } catch {
        continue;
      }

      const score = this.cosineSimilarity(queryVector, vector);
      if (score > 0.3) {
        results.push({
          documentId: doc.id,
          title: doc.title,
          content: doc.content,
          category: doc.category,
          phases: (doc as any).phases,
          score,
          source: "vector",
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async hybridSearch(
    query: string,
    topK: number = 5,
    phase?: SalesPhase
  ): Promise<KBHybridSearchResult[]> {
    const vectorResults = await this.searchSimilarDocuments(query, topK * 2, phase);

    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter((w: string) => w.length > 2);

    const where: any = {
      approval_status: "approved",
    };
    if (phase) {
      where.phases = { has: phase };
    }

    const allDocs = await prisma.kBKnowledgeDocument.findMany({ where });

    const keywordMatches: KBHybridSearchResult[] = [];

    for (const doc of allDocs) {
      if (vectorResults.find((r) => r.documentId === doc.id)) continue;

      const contentLower = doc.content.toLowerCase();
      const titleLower = doc.title.toLowerCase();

      let matchScore = 0;
      for (const keyword of keywords) {
        if (titleLower.includes(keyword)) matchScore += 2;
        if (contentLower.includes(keyword)) matchScore += 1;
      }

      if (matchScore > 0) {
        keywordMatches.push({
          documentId: doc.id,
          title: doc.title,
          content: doc.content,
          category: doc.category,
          phases: (doc as any).phases,
          score: Math.min(matchScore / 10, 0.8),
          source: "keyword",
        });
      }
    }

    keywordMatches.sort((a, b) => b.score - a.score);

    const merged = [...vectorResults, ...keywordMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return merged;
  }

  async getDocumentsByPhase(phase: SalesPhase) {
    return prisma.kBKnowledgeDocument.findMany({
      where: {
        phases: { has: phase },
        approval_status: "approved",
      },
      orderBy: { updated_at: "desc" },
    });
  }

  async getDocumentsByCategory(category: KBDocumentCategory) {
    return prisma.kBKnowledgeDocument.findMany({
      where: {
        category,
        approval_status: "approved",
      },
      orderBy: { updated_at: "desc" },
    });
  }

  async getVersionHistory(documentId: string) {
    return prisma.kBVersion.findMany({
      where: { document_id: documentId },
      orderBy: { version: "desc" },
    });
  }

  async revertToVersion(documentId: string, version: number, revertedBy: string) {
    const targetVersion = await prisma.kBVersion.findFirst({
      where: { document_id: documentId, version },
    });

    if (!targetVersion) {
      throw new Error("Version not found");
    }

    const current = await prisma.kBKnowledgeDocument.findUnique({
      where: { id: documentId },
    });

    const newVersion = (current as any).version + 1;

    await prisma.kBKnowledgeDocument.update({
      where: { id: documentId },
      data: {
        content: (targetVersion as any).content,
        version: newVersion,
      },
    });

    await prisma.kBVersion.create({
      data: {
        document_id: documentId,
        version: newVersion,
        content: (targetVersion as any).content,
        changed_by: revertedBy,
        change_reason: `Reverted to version ${version}`,
      },
    });

    await this.generateEmbedding(documentId, (targetVersion as any).content);

    logger.info(`[ObsidianKB] Reverted document ${documentId} to version ${version}`);
  }

  private async generateEmbedding(documentId: string, content: string) {
    try {
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: content,
      });

      const embedding = response.data[0]?.embedding;

      if (embedding) {
        await prisma.kBEmbedding.deleteMany({
          where: { document_id: documentId },
        });

        await prisma.kBEmbedding.create({
          data: {
            document_id: documentId,
            vector: JSON.stringify(embedding),
            model: EMBEDDING_MODEL,
          },
        });

        logger.info(`[ObsidianKB] Generated embedding for document: ${documentId}`);
      }
    } catch (error) {
      logger.error(`[ObsidianKB] Failed to generate embedding: ${error}`);
    }
  }

  async getAnalytics() {
    const total = await prisma.kBKnowledgeDocument.count();
    const byCategory = await prisma.kBKnowledgeDocument.groupBy({
      by: ["category"],
      _count: true,
    });
    const byPhase = await prisma.kBKnowledgeDocument.groupBy({
      by: ["approval_status"],
      _count: true,
    });

    return {
      total,
      byCategory: byCategory.reduce(
        (acc: any, curr: any) => ({
          ...acc,
          [curr.category]: curr._count,
        }),
        {}
      ),
      byStatus: byPhase.reduce(
        (acc: any, curr: any) => ({
          ...acc,
          [curr.approval_status]: curr._count,
        }),
        {}
      ),
    };
  }
}

export default new ObsidianKnowledgeService();
