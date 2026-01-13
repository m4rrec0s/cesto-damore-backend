import prisma from "../database/prisma";
import logger from "../utils/logger";
import { saveImageLocally, deleteImageLocally } from "../config/localStorage";

/**
 * Serviço para gerenciar banco de elementos (clipart, ícones, etc)
 */
class ElementBankService {
  /**
   * Criar novo elemento no banco
   */
  async createElement(data: {
    category: string;
    name: string;
    imageUrl: string;
    thumbnailUrl?: string;
    tags?: string[];
    width?: number;
    height?: number;
    source?: string;
    externalId?: string;
  }) {
    try {
      logger.info("📝 [ELEMENT_BANK] Criando novo elemento", {
        name: data.name,
        category: data.category,
        source: data.source,
      });

      const element = await prisma.elementBank.create({
        data: {
          category: data.category,
          name: data.name,
          imageUrl: data.imageUrl,
          thumbnailUrl: data.thumbnailUrl,
          tags: data.tags || [],
          width: data.width,
          height: data.height,
          source: data.source || "local",
          externalId: data.externalId,
        },
      });

      logger.info("✅ [ELEMENT_BANK] Elemento criado com sucesso", {
        id: element.id,
        name: element.name,
      });

      return element;
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao criar elemento:", error);
      throw new Error(`Erro ao criar elemento: ${error.message}`);
    }
  }

  /**
   * Listar elementos com filtros
   */
  async listElements(filters?: {
    category?: string;
    search?: string;
    source?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }) {
    try {
      const where: any = {
        isActive: true,
      };

      if (filters?.category) where.category = filters.category;
      if (filters?.source) where.source = filters.source;

      if (filters?.search) {
        where.OR = [
          { name: { contains: filters.search, mode: "insensitive" } },
          { tags: { hasSome: [filters.search] } },
        ];
      }

      if (filters?.tags && filters.tags.length > 0) {
        where.tags = { hasSome: filters.tags };
      }

      const limit = filters?.limit || 50;
      const offset = filters?.offset || 0;

      const [elements, total] = await Promise.all([
        prisma.elementBank.findMany({
          where,
          orderBy: {
            usageCount: "desc",
          },
          take: limit,
          skip: offset,
        }),
        prisma.elementBank.count({ where }),
      ]);

      logger.info("📋 [ELEMENT_BANK] Listando elementos", {
        count: elements.length,
        total,
        filters,
      });

      return {
        elements,
        total,
        hasMore: offset + limit < total,
      };
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao listar elementos:", error);
      throw new Error(`Erro ao listar elementos: ${error.message}`);
    }
  }

  /**
   * Listar categorias disponíveis
   */
  async listCategories() {
    try {
      const categories = await prisma.elementBank.findMany({
        where: { isActive: true },
        distinct: ["category"],
        select: {
          category: true,
        },
        orderBy: {
          category: "asc",
        },
      });

      const categoriesWithCount = await Promise.all(
        categories.map(async (cat) => ({
          name: cat.category,
          count: await prisma.elementBank.count({
            where: {
              category: cat.category,
              isActive: true,
            },
          }),
        }))
      );

      logger.info("📂 [ELEMENT_BANK] Listando categorias", {
        count: categoriesWithCount.length,
      });

      return categoriesWithCount;
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao listar categorias:", error);
      throw new Error(`Erro ao listar categorias: ${error.message}`);
    }
  }

  /**
   * Obter elemento por ID
   */
  async getElementById(elementId: string) {
    try {
      const element = await prisma.elementBank.findUnique({
        where: { id: elementId },
      });

      if (!element) {
        throw new Error("Elemento não encontrado");
      }

      // Incrementar contador de uso
      await prisma.elementBank.update({
        where: { id: elementId },
        data: {
          usageCount: {
            increment: 1,
          },
        },
      });

      logger.info("📖 [ELEMENT_BANK] Obtendo elemento", {
        id: elementId,
        name: element.name,
      });

      return element;
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao obter elemento:", error);
      throw new Error(`Erro ao obter elemento: ${error.message}`);
    }
  }

  /**
   * Atualizar elemento
   */
  async updateElement(
    elementId: string,
    data: {
      name?: string;
      tags?: string[];
      width?: number;
      height?: number;
      isActive?: boolean;
    }
  ) {
    try {
      logger.info("✏️ [ELEMENT_BANK] Atualizando elemento", {
        id: elementId,
      });

      const element = await prisma.elementBank.update({
        where: { id: elementId },
        data,
      });

      logger.info("✅ [ELEMENT_BANK] Elemento atualizado com sucesso", {
        id: element.id,
      });

      return element;
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao atualizar elemento:", error);
      throw new Error(`Erro ao atualizar elemento: ${error.message}`);
    }
  }

  /**
   * Deletar elemento
   */
  async deleteElement(elementId: string) {
    try {
      logger.info("🗑️ [ELEMENT_BANK] Deletando elemento", {
        id: elementId,
      });

      const element = await prisma.elementBank.findUnique({
        where: { id: elementId },
      });

      if (!element) {
        throw new Error("Elemento não encontrado");
      }

      // Deletar imagem se for local
      if (element.source === "local") {
        try {
          await deleteImageLocally(element.imageUrl);
          if (element.thumbnailUrl) {
            await deleteImageLocally(element.thumbnailUrl);
          }
        } catch (error) {
          logger.warn("⚠️ Erro ao deletar imagens do elemento:", error);
        }
      }

      await prisma.elementBank.delete({
        where: { id: elementId },
      });

      logger.info("✅ [ELEMENT_BANK] Elemento deletado com sucesso", {
        id: elementId,
      });

      return { success: true, id: elementId };
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao deletar elemento:", error);
      throw new Error(`Erro ao deletar elemento: ${error.message}`);
    }
  }

  /**
   * Registrar múltiplos elementos (importação em lote)
   */
  async bulkCreateElements(
    elements: Array<{
      category: string;
      name: string;
      imageUrl: string;
      thumbnailUrl?: string;
      tags?: string[];
      width?: number;
      height?: number;
      source?: string;
      externalId?: string;
    }>
  ) {
    try {
      logger.info("📦 [ELEMENT_BANK] Importando elementos em lote", {
        count: elements.length,
      });

      const created = await prisma.elementBank.createMany({
        data: elements,
        skipDuplicates: true,
      });

      logger.info("✅ [ELEMENT_BANK] Elementos importados com sucesso", {
        count: created.count,
      });

      return created;
    } catch (error: any) {
      logger.error("❌ [ELEMENT_BANK] Erro ao importar elementos:", error);
      throw new Error(`Erro ao importar elementos: ${error.message}`);
    }
  }
}

export default new ElementBankService();
