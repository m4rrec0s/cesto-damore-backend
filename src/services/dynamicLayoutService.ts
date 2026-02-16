import prisma from "../database/prisma";
import logger from "../utils/logger";
import {
  saveImageLocally,
  deleteImageLocally,
  saveBase64Image,
} from "../config/localStorage";

class DynamicLayoutService {
  

  async createLayout(data: {
    userId?: string;
    name: string;
    type: string;
    baseImageUrl: string;
    fabricJsonState: any;
    width: number;
    height: number;
    productionTime?: number;
    previewImageUrl?: string;
    tags?: string[];
    relatedLayoutBaseId?: string;
  }) {
    try {

      const finalBaseImageUrl = await saveBase64Image(
        data.baseImageUrl,
        "base-layout",
      );

      const finalPreviewImageUrl = data.previewImageUrl
        ? await saveBase64Image(data.previewImageUrl, "preview-layout")
        : data.previewImageUrl;

      const layout = await prisma.dynamicLayout.create({
        data: {
          userId: data.userId,
          name: data.name,
          type: data.type,
          baseImageUrl: finalBaseImageUrl,
          fabricJsonState: data.fabricJsonState,
          width: data.width,
          height: data.height,
          productionTime: data.productionTime || 0,
          previewImageUrl: finalPreviewImageUrl,
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

  

  async listLayouts(filters?: {
    userId?: string;
    type?: string;
    isPublished?: boolean;
    search?: string;
    visibilityFilter?: {
      userId: string;
      includePublished: boolean;
    };
  }) {
    try {
      const where: any = {};

      if (filters?.visibilityFilter) {
        where.OR = [
          { userId: filters.visibilityFilter.userId },
          ...(filters.visibilityFilter.includePublished
            ? [{ isPublished: true }]
            : []),
        ];
      } else {
        if (filters?.userId) where.userId = filters.userId;
        if (filters?.isPublished !== undefined)
          where.isPublished = filters.isPublished;
      }

      if (filters?.type) {

        if (where.OR) {
          where.AND = [{ type: filters.type }, { OR: where.OR }];
          delete where.OR;
        } else {
          where.type = filters.type;
        }
      }

      if (filters?.search) {
        const searchCondition = {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { tags: { has: filters.search } },
          ],
        };

        if (where.AND) {
          where.AND.push(searchCondition);
        } else if (where.OR) {

          const previousOR = where.OR;
          delete where.OR;
          where.AND = [{ OR: previousOR }, searchCondition];
        } else {
          where.OR = searchCondition.OR;
        }
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
            take: 5,
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

  

  async updateLayout(
    layoutId: string,
    data: {
      name?: string;
      fabricJsonState?: any;
      previewImageUrl?: string;
      baseImageUrl?: string;
      tags?: string[];
      isPublished?: boolean;
      isShared?: boolean;
      width?: number;
      height?: number;
      productionTime?: number;
    },
  ) {
    try {

      const currentLayout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
        select: {
          baseImageUrl: true,
          previewImageUrl: true,
          fabricJsonState: true,
        },
      });

      if (!currentLayout) throw new Error("Layout não encontrado");

      const updateData: any = { ...data };

      let targetBaseImage = data.baseImageUrl || currentLayout.baseImageUrl;
      if (targetBaseImage && targetBaseImage.startsWith("data:image")) {
        const newUrl = await saveBase64Image(targetBaseImage, "base-layout");
        updateData.baseImageUrl = newUrl;

        if (
          currentLayout.baseImageUrl &&
          currentLayout.baseImageUrl !== newUrl
        ) {
          await deleteImageLocally(currentLayout.baseImageUrl);
        }
      }

      if (
        data.previewImageUrl &&
        data.previewImageUrl.startsWith("data:image")
      ) {
        const newUrl = await saveBase64Image(
          data.previewImageUrl,
          "preview-layout",
        );
        updateData.previewImageUrl = newUrl;

        if (
          currentLayout.previewImageUrl &&
          currentLayout.previewImageUrl !== newUrl
        ) {
          await deleteImageLocally(currentLayout.previewImageUrl);
        }
      }

      if (data.fabricJsonState) {
        updateData.fabricJsonState = await this.extractBase64FromObjects(
          data.fabricJsonState,
        );
      }

      const layout = await prisma.dynamicLayout.update({
        where: { id: layoutId },
        data: updateData,
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

  

  private async extractBase64FromObjects(json: any): Promise<any> {
    if (!json || !json.objects) return json;

    const processedObjects = await Promise.all(
      json.objects.map(async (obj: any) => {

        if (
          (obj.type === "image" || obj.type === "Image") &&
          obj.src &&
          obj.src.startsWith("data:image")
        ) {
          try {
            const newUrl = await saveBase64Image(obj.src, "element");
            return { ...obj, src: newUrl };
          } catch (e) {
            logger.warn("⚠️ Falha ao extrair base64 de objeto do canvas");
            return obj;
          }
        }
        return obj;
      }),
    );

    return { ...json, objects: processedObjects };
  }

  

  async saveVersion(
    layoutId: string,
    data: { changeDescription?: string; changedBy?: string },
  ) {
    try {
      logger.info("📸 [DYNAMIC_LAYOUT] Salvando versão do layout", {
        id: layoutId,
        description: data.changeDescription,
      });

      const layout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
      });

      if (!layout) {
        throw new Error("Layout não encontrado");
      }

      const versionCount = await prisma.dynamicLayoutVersion.count({
        where: { layoutId },
      });

      const version = await prisma.dynamicLayoutVersion.create({
        data: {
          layoutId,
          versionNumber: versionCount + 1,
          fabricJsonState: layout.fabricJsonState as any,
          changedBy: data.changedBy,
          changeDescription: data.changeDescription,
        },
      });

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

  

  async restoreVersion(
    layoutId: string,
    versionNumber: number,
    changedBy?: string,
  ) {
    try {
      logger.info("⏮️ [DYNAMIC_LAYOUT] Restaurando versão anterior", {
        layoutId,
        versionNumber,
      });

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

      const currentLayout = await prisma.dynamicLayout.findUnique({
        where: { id: layoutId },
      });

      if (currentLayout) {
        await this.saveVersion(layoutId, {
          changeDescription: `Restaurado de versão ${versionNumber}`,
          changedBy,
        });
      }

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

      if (layout.previewImageUrl) {
        try {
          await deleteImageLocally(layout.previewImageUrl);
        } catch (error) {
          logger.warn("⚠️ Erro ao deletar preview image:", error);
        }
      }

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

  

  async addElement(
    layoutId: string,
    element: {
      elementType: string;
      fabricObjectId: string;
      data: any;
      order?: number;
      isLocked?: boolean;
    },
  ) {
    try {
      logger.info("➕ [DYNAMIC_LAYOUT] Adicionando elemento", {
        layoutId,
        elementType: element.elementType,
      });

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

  

  async updateElement(
    elementId: string,
    data: {
      data?: any;
      order?: number;
      isLocked?: boolean;
    },
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
