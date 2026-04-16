import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import prisma from "../database/prisma";
import logger from "../utils/logger";
import { createOpenAIClient } from "../config/openai";

const execFileAsync = promisify(execFile);

type IngestDocumentInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  uploadedBy?: string | null;
};

export type KnowledgeSearchHit = {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  chunkIndex: number;
  pageNumber: number | null;
  score: number;
  text: string;
};

const KNOWLEDGE_EMBEDDING_MODEL =
  process.env.OPENAI_KNOWLEDGE_EMBEDDING_MODEL?.trim() ||
  "text-embedding-3-small";
const CHUNK_SIZE = Number(process.env.OPENAI_KNOWLEDGE_CHUNK_SIZE || 2400);
const CHUNK_OVERLAP = Number(process.env.OPENAI_KNOWLEDGE_CHUNK_OVERLAP || 350);
const SEARCH_SCAN_LIMIT = Number(process.env.OPENAI_KNOWLEDGE_SCAN_LIMIT || 300);

class KnowledgeBaseService {
  private readonly openai = createOpenAIClient();

  private hashText(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private sanitizeText(input: string) {
    return (input || "")
      .replace(/\u0000/g, " ")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[\t ]{2,}/g, " ")
      .trim();
  }

  private estimateTokens(text: string) {
    return Math.ceil((text || "").length / 4);
  }

  private splitIntoChunks(pages: Array<{ pageNumber: number; text: string }>) {
    const chunks: Array<{ chunkIndex: number; pageNumber: number | null; text: string }> = [];
    let chunkIndex = 0;

    for (const page of pages) {
      const source = this.sanitizeText(page.text);
      if (!source) continue;

      if (source.length <= CHUNK_SIZE) {
        chunks.push({
          chunkIndex,
          pageNumber: page.pageNumber,
          text: source,
        });
        chunkIndex += 1;
        continue;
      }

      let start = 0;
      while (start < source.length) {
        const end = Math.min(source.length, start + CHUNK_SIZE);
        const raw = source.slice(start, end);
        const normalized = this.sanitizeText(raw);

        if (normalized) {
          chunks.push({
            chunkIndex,
            pageNumber: page.pageNumber,
            text: normalized,
          });
          chunkIndex += 1;
        }

        if (end >= source.length) break;
        start = Math.max(0, end - CHUNK_OVERLAP);
      }
    }

    return chunks;
  }

  private parsePdfPages(rawText: string) {
    const pagesRaw = (rawText || "").split("\f");
    const pages: Array<{ pageNumber: number; text: string }> = [];

    for (let index = 0; index < pagesRaw.length; index += 1) {
      const pageText = this.sanitizeText(pagesRaw[index] || "");
      if (!pageText) continue;
      pages.push({
        pageNumber: index + 1,
        text: pageText,
      });
    }

    return pages;
  }

  private async extractTextFromPdf(buffer: Buffer) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cesto-kb-"));
    const inputPath = path.join(tempDir, `upload-${Date.now()}.pdf`);

    try {
      await fs.writeFile(inputPath, buffer);
      const { stdout } = await execFileAsync("pdftotext", [
        "-layout",
        "-enc",
        "UTF-8",
        inputPath,
        "-",
      ]);
      return this.sanitizeText(stdout || "");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async createEmbeddings(texts: string[]) {
    if (texts.length === 0) return [] as number[][];

    const vectors: number[][] = [];
    const BATCH_SIZE = 32;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.openai.embeddings.create({
        model: KNOWLEDGE_EMBEDDING_MODEL,
        input: batch,
      });

      for (const item of response.data) {
        vectors.push(item.embedding);
      }
    }

    return vectors;
  }

  private cosineSimilarity(a: number[], b: number[]) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
      return -1;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i += 1) {
      const av = Number(a[i] || 0);
      const bv = Number(b[i] || 0);
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    if (!normA || !normB) return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async ingestPdfDocument(input: IngestDocumentInput) {
    if (!input.buffer || input.buffer.length === 0) {
      throw new Error("Arquivo vazio para ingestão");
    }

    const mimeType = (input.mimeType || "").toLowerCase();
    if (mimeType !== "application/pdf") {
      throw new Error("Apenas arquivos PDF são suportados nesta versão");
    }

    const extractedText = await this.extractTextFromPdf(input.buffer);
    if (!extractedText) {
      throw new Error("Não foi possível extrair texto do PDF");
    }

    const pages = this.parsePdfPages(extractedText);
    const chunks = this.splitIntoChunks(pages);
    if (chunks.length === 0) {
      throw new Error("PDF sem conteúdo útil após chunking");
    }

    const vectors = await this.createEmbeddings(chunks.map((chunk) => chunk.text));
    if (vectors.length !== chunks.length) {
      throw new Error("Falha ao gerar embeddings de todos os chunks");
    }

    const baseTitle = (input.originalName || "Documento").replace(/\.pdf$/i, "").trim();
    const title = baseTitle || "Documento";

    const document = await prisma.knowledgeDocument.create({
      data: {
        title,
        source_filename: input.originalName || "documento.pdf",
        mime_type: input.mimeType || "application/pdf",
        status: "active",
        version: 1,
        total_chunks: chunks.length,
        extracted_text: extractedText,
        uploaded_by: input.uploadedBy || null,
      },
    });

    await prisma.knowledgeChunk.createMany({
      data: chunks.map((chunk, index) => ({
        document_id: document.id,
        chunk_index: chunk.chunkIndex,
        page_number: chunk.pageNumber,
        text_content: chunk.text,
        token_estimate: this.estimateTokens(chunk.text),
        embedding: vectors[index] || [],
        embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
        content_hash: this.hashText(`${document.id}:${chunk.chunkIndex}:${chunk.text}`),
      })),
    });

    logger.info(
      `[KnowledgeBase] Documento ingerido: ${document.id} (${chunks.length} chunks)`
    );

    return {
      id: document.id,
      title: document.title,
      sourceFilename: document.source_filename,
      totalChunks: document.total_chunks,
      status: document.status,
      createdAt: document.created_at,
    };
  }

  async listDocuments() {
    const docs = await prisma.knowledgeDocument.findMany({
      orderBy: { updated_at: "desc" },
      take: 200,
    });

    return docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      sourceFilename: doc.source_filename,
      mimeType: doc.mime_type,
      status: doc.status,
      version: doc.version,
      totalChunks: doc.total_chunks,
      uploadedBy: doc.uploaded_by,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    }));
  }

  async deleteDocument(documentId: string) {
    await prisma.knowledgeDocument.delete({
      where: { id: documentId },
    });

    return { success: true };
  }

  async reindexDocument(documentId: string) {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      throw new Error("Documento não encontrado");
    }

    const pages = this.parsePdfPages(doc.extracted_text || "");
    const chunks = this.splitIntoChunks(pages);
    if (chunks.length === 0) {
      throw new Error("Documento sem conteúdo para reindexação");
    }

    const vectors = await this.createEmbeddings(chunks.map((chunk) => chunk.text));

    await prisma.$transaction([
      prisma.knowledgeChunk.deleteMany({ where: { document_id: documentId } }),
      prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          version: { increment: 1 },
          total_chunks: chunks.length,
        },
      }),
      prisma.knowledgeChunk.createMany({
        data: chunks.map((chunk, index) => ({
          document_id: documentId,
          chunk_index: chunk.chunkIndex,
          page_number: chunk.pageNumber,
          text_content: chunk.text,
          token_estimate: this.estimateTokens(chunk.text),
          embedding: vectors[index] || [],
          embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
          content_hash: this.hashText(`${documentId}:${chunk.chunkIndex}:${chunk.text}`),
        })),
      }),
    ]);

    return {
      id: documentId,
      totalChunks: chunks.length,
      reindexedAt: new Date().toISOString(),
    };
  }

  async searchKnowledge(
    question: string,
    options?: {
      topK?: number;
      minScore?: number;
      documentId?: string;
    },
  ) {
    const text = (question || "").trim();
    if (!text) return [] as KnowledgeSearchHit[];

    const topK = Math.max(1, Math.min(20, Number(options?.topK || 6)));
    const minScore = Number.isFinite(Number(options?.minScore))
      ? Number(options?.minScore)
      : 0.35;

    const embeddingResponse = await this.openai.embeddings.create({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      input: text,
    });
    const queryVector = embeddingResponse.data[0]?.embedding || [];

    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        ...(options?.documentId ? { document_id: options.documentId } : {}),
        document: {
          status: "active",
        },
      },
      include: {
        document: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
      take: SEARCH_SCAN_LIMIT,
    });

    const scored = chunks
      .map((chunk) => {
        const candidateVector = Array.isArray(chunk.embedding)
          ? chunk.embedding.map((value) => Number(value || 0))
          : [];
        const score = this.cosineSimilarity(queryVector, candidateVector);

        return {
          documentId: chunk.document.id,
          documentTitle: chunk.document.title,
          chunkId: chunk.id,
          chunkIndex: chunk.chunk_index,
          pageNumber: chunk.page_number,
          score,
          text: chunk.text_content,
        } as KnowledgeSearchHit;
      })
      .filter((hit) => Number.isFinite(hit.score) && hit.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }
}

export default new KnowledgeBaseService();
