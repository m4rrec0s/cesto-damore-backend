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
      return element;
    } catch (error: any) {
      throw new Error(`Erro ao criar elemento: ${error.message}`);
    }
  }

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

      return {
        elements,
        total,
        hasMore: offset + limit < total,
      };
    } catch (error: any) {
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
        })),
      );

      return categoriesWithCount;
    } catch (error: any) {
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

      return element;
    } catch (error: any) {
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
    },
  ) {
    try {
      const element = await prisma.elementBank.update({
        where: { id: elementId },
        data,
      });

      return element;
    } catch (error: any) {
      throw new Error(`Erro ao atualizar elemento: ${error.message}`);
    }
  }

  /**
   * Deletar elemento
   */
  async deleteElement(elementId: string) {
    try {
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

      return { success: true, id: elementId };
    } catch (error: any) {
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
    }>,
  ) {
    try {
      const created = await prisma.elementBank.createMany({
        data: elements,
        skipDuplicates: true,
      });

      return created;
    } catch (error: any) {
      throw new Error(`Erro ao importar elementos: ${error.message}`);
    }
  }
}

export default new ElementBankService();
