import prisma from "../database/prisma";
import logger from "../utils/logger";
import { saveImageLocally, deleteImageLocally } from "../config/localStorage";

/**
 * Serviço para gerenciar layouts dinâmicos (v2)
 * Suporta criação, edição, versionamento e gerenciamento de camadas
 */
class DynamicLayoutService {
  /**
   * Criar novo layout dinâmico
   */
  async createLayout(data: {
    userId?: string;
    name: string;
    type: string;
    baseImageUrl: string;
    fabricJsonState: any;
    width: number;
    height: number;
    previewImageUrl?: string;
    tags?: string[];
    relatedLayoutBaseId?: string;
  }) {
    try {
      const layout = await prisma.dynamicLayout.create({
        data: {
          userId: data.userId,
          name: data.name,
          type: data.type,
          baseImageUrl: data.baseImageUrl,
          fabricJsonState: data.fabricJsonState,
          width: data.width,
          height: data.height,
          previewImageUrl: data.previewImageUrl,
          tags: data.tags || [],
          relatedLayoutBaseId: data.relatedLayoutBaseId,
          version: 1,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return layout;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao criar layout:", error);
      throw new Error(`Erro ao criar layout: ${error.message}`);
    }
  }

  /**
   * Listar layouts com filtros opcionais
   */
  async listLayouts(filters?: {
    userId?: string;
    type?: string;
    isPublished?: boolean;
    search?: string;
  }) {
    try {
      const where: any = {};

      if (filters?.userId) where.userId = filters.userId;
      if (filters?.type) where.type = filters.type;
      if (filters?.isPublished !== undefined)
        where.isPublished = filters.isPublished;

      if (filters?.search) {
        where.OR = [
          { name: { contains: filters.search, mode: "insensitive" } },
          { tags: { has: filters.search } },
        ];
      }

      const layouts = await prisma.dynamicLayout.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              versions: true,
              elements: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return layouts;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao listar layouts:", error);
      throw new Error(`Erro ao listar layouts: ${error.message}`);
    }
  }

  /**
   * Obter detalhe de um layout
   */
  async getLayoutById(layoutId: string) {
    try {
      const layout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          elements: {
            orderBy: {
              order: "asc",
            },
          },
          versions: {
            orderBy: {
              versionNumber: "desc",
            },
            take: 5, // Últimas 5 versões por padrão
          },
        },
      });

      if (!layout) {
        throw new Error("Layout não encontrado");
      }

      return layout;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao obter layout:", error);
      throw new Error(`Erro ao obter layout: ${error.message}`);
    }
  }

  /**
   * Atualizar layout dinâmico
   */
  async updateLayout(
    layoutId: string,
    data: {
      name?: string;
      fabricJsonState?: any;
      previewImageUrl?: string;
      tags?: string[];
      isPublished?: boolean;
      isShared?: boolean;
      width?: number;
      height?: number;
    }
  ) {
    try {
      const layout = await prisma.dynamicLayout.update({
        where: { id: layoutId },
        data,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return layout;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao atualizar layout:", error);
      throw new Error(`Erro ao atualizar layout: ${error.message}`);
    }
  }

  /**
   * Salvar versão do layout (snapshot histórico)
   */
  async saveVersion(
    layoutId: string,
    data: { changeDescription?: string; changedBy?: string }
  ) {
    try {
      logger.info("📸 [DYNAMIC_LAYOUT] Salvando versão do layout", {
        id: layoutId,
        description: data.changeDescription,
      });

      // Obter layout atual
      const layout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
      });

      if (!layout) {
        throw new Error("Layout não encontrado");
      }

      // Contar versões existentes
      const versionCount = await prisma.dynamicLayoutVersion.count({
        where: { layoutId },
      });

      // Criar nova versão
      const version = await prisma.dynamicLayoutVersion.create({
        data: {
          layoutId,
          versionNumber: versionCount + 1,
          fabricJsonState: layout.fabricJsonState as any,
          changedBy: data.changedBy,
          changeDescription: data.changeDescription,
        },
      });

      // Atualizar versão do layout
      await prisma.dynamicLayout.update({
        where: { id: layoutId },
        data: { version: layout.version + 1 },
      });

      logger.info("✅ [DYNAMIC_LAYOUT] Versão salva com sucesso", {
        layoutId,
        versionNumber: version.versionNumber,
      });

      return version;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao salvar versão:", error);
      throw new Error(`Erro ao salvar versão: ${error.message}`);
    }
  }

  /**
   * Listar versões de um layout
   */
  async getVersions(layoutId: string, limit = 10) {
    try {
      const versions = await prisma.dynamicLayoutVersion.findMany({
        where: { layoutId },
        orderBy: {
          versionNumber: "desc",
        },
        take: limit,
      });

      logger.info("📚 [DYNAMIC_LAYOUT] Listando versões", {
        layoutId,
        count: versions.length,
      });

      return versions;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao listar versões:", error);
      throw new Error(`Erro ao listar versões: ${error.message}`);
    }
  }

  /**
   * Restaurar versão anterior
   */
  async restoreVersion(
    layoutId: string,
    versionNumber: number,
    changedBy?: string
  ) {
    try {
      logger.info("⏮️ [DYNAMIC_LAYOUT] Restaurando versão anterior", {
        layoutId,
        versionNumber,
      });

      // Obter versão
      const version = await prisma.dynamicLayoutVersion.findUnique({
        where: {
          layoutId_versionNumber: {
            layoutId,
            versionNumber,
          },
        },
      });

      if (!version) {
        throw new Error("Versão não encontrada");
      }

      // Salvar versão atual antes de restaurar
      const currentLayout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
      });

      if (currentLayout) {
        await this.saveVersion(layoutId, {
          changeDescription: `Restaurado de versão ${versionNumber}`,
          changedBy,
        });
      }

      // Restaurar estado anterior
      const restoredLayout = await prisma.dynamicLayout.update({
        where: { id: layoutId },
        data: {
          fabricJsonState: version.fabricJsonState as any,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      logger.info("✅ [DYNAMIC_LAYOUT] Versão restaurada com sucesso", {
        layoutId,
        versionNumber,
      });

      return restoredLayout;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao restaurar versão:", error);
      throw new Error(`Erro ao restaurar versão: ${error.message}`);
    }
  }

  /**
   * Deletar layout
   */
  async deleteLayout(layoutId: string) {
    try {
      logger.info("🗑️ [DYNAMIC_LAYOUT] Deletando layout", {
        id: layoutId,
      });

      const layout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
      });

      if (!layout) {
        throw new Error("Layout não encontrado");
      }

      // Deletar imagem preview se existir
      if (layout.previewImageUrl) {
        try {
          await deleteImageLocally(layout.previewImageUrl);
        } catch (error) {
          logger.warn("⚠️ Erro ao deletar preview image:", error);
        }
      }

      // Prisma cascata delete (elementos e versões)
      await prisma.dynamicLayout.delete({
        where: { id: layoutId },
      });

      logger.info("✅ [DYNAMIC_LAYOUT] Layout deletado com sucesso", {
        id: layoutId,
      });

      return { success: true, id: layoutId };
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao deletar layout:", error);
      throw new Error(`Erro ao deletar layout: ${error.message}`);
    }
  }

  /**
   * Adicionar elemento ao layout
   */
  async addElement(
    layoutId: string,
    element: {
      elementType: string;
      fabricObjectId: string;
      data: any;
      order?: number;
      isLocked?: boolean;
    }
  ) {
    try {
      logger.info("➕ [DYNAMIC_LAYOUT] Adicionando elemento", {
        layoutId,
        elementType: element.elementType,
      });

      // Obter próxima ordem se não fornecida
      let order = element.order;
      if (order === undefined) {
        const lastElement = await prisma.dynamicLayoutElement.findFirst({
          where: { layoutId },
          orderBy: { order: "desc" },
        });
        order = (lastElement?.order || 0) + 1;
      }

      const newElement = await prisma.dynamicLayoutElement.create({
        data: {
          layoutId,
          elementType: element.elementType,
          fabricObjectId: element.fabricObjectId,
          data: element.data,
          order,
          isLocked: element.isLocked || false,
        },
      });

      logger.info("✅ [DYNAMIC_LAYOUT] Elemento adicionado com sucesso", {
        elementId: newElement.id,
      });

      return newElement;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao adicionar elemento:", error);
      throw new Error(`Erro ao adicionar elemento: ${error.message}`);
    }
  }

  /**
   * Atualizar elemento
   */
  async updateElement(
    elementId: string,
    data: {
      data?: any;
      order?: number;
      isLocked?: boolean;
    }
  ) {
    try {
      const updatedElement = await prisma.dynamicLayoutElement.update({
        where: { id: elementId },
        data,
      });

      logger.info("✅ [DYNAMIC_LAYOUT] Elemento atualizado com sucesso", {
        elementId,
      });

      return updatedElement;
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao atualizar elemento:", error);
      throw new Error(`Erro ao atualizar elemento: ${error.message}`);
    }
  }

  /**
   * Deletar elemento
   */
  async deleteElement(elementId: string) {
    try {
      await prisma.dynamicLayoutElement.delete({
        where: { id: elementId },
      });

      logger.info("✅ [DYNAMIC_LAYOUT] Elemento deletado com sucesso", {
        elementId,
      });

      return { success: true, id: elementId };
    } catch (error: any) {
      logger.error("❌ [DYNAMIC_LAYOUT] Erro ao deletar elemento:", error);
      throw new Error(`Erro ao deletar elemento: ${error.message}`);
    }
  }
}

export default new DynamicLayoutService();
