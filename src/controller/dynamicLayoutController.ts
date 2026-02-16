import { Request, Response } from "express";
import dynamicLayoutService from "../services/dynamicLayoutService";
import logger from "../utils/logger";
import trendStatsService from "../services/trendStatsService";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role?: string;
  };
}

class DynamicLayoutController {
  

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        name,
        type,
        baseImageUrl,
        fabricJsonState,
        width,
        height,
        productionTime,
        tags,
        relatedLayoutBaseId,
      } = req.body;

      if (
        !name ||
        !type ||
        !baseImageUrl ||
        !fabricJsonState ||
        !width ||
        !height
      ) {
        return res.status(400).json({
          error:
            "Campos obrigatórios: name, type, baseImageUrl, fabricJsonState, width, height",
        });
      }

      const validTypes = ["mug", "frame", "custom"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: `Tipo inválido. Valores permitidos: ${validTypes.join(", ")}`,
        });
      }

      if (width <= 0 || height <= 0) {
        return res.status(400).json({
          error: "Width e height devem ser maiores que 0",
        });
      }

      const layout = await dynamicLayoutService.createLayout({
        userId: req.user?.id,
        name,
        type,
        baseImageUrl,
        fabricJsonState,
        width,
        height,
        productionTime: productionTime ? Number(productionTime) : 0,
        tags: tags || [],
        relatedLayoutBaseId,
      });

      return res.status(201).json(layout);
    } catch (error: any) {
      logger.error("❌ Erro ao criar layout dinâmico:", error);
      return res.status(400).json({
        error: error.message || "Erro ao criar layout",
      });
    }
  }

  

  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const { type, isPublished, search, userId: userIdQuery } = req.query;

      const filters: any = {};

      if (type) filters.type = type as string;
      if (isPublished === "true") filters.isPublished = true;
      if (search) filters.search = search as string;

      if (req.user) {
        if (req.user.role !== "admin") {

          filters.visibilityFilter = {
            userId: req.user.id,
            includePublished: true,
          };
        } else {

          if (userIdQuery) filters.userId = userIdQuery as string;
        }
      } else {

        filters.isPublished = true;
      }

      const layouts = await dynamicLayoutService.listLayouts(filters);

      return res.json({
        data: layouts,
        count: layouts.length,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao listar layouts:", error);
      return res.status(500).json({
        error: error.message || "Erro ao listar layouts",
      });
    }
  }

  

  async show(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      const layout = await dynamicLayoutService.getLayoutById(id);

      const isOwner = layout.userId === req.user?.id;
      const isAdmin = req.user?.role === "admin";
      const isPubliclyVisible = layout.isPublished;

      if (!isOwner && !isAdmin && !isPubliclyVisible) {
        return res.status(403).json({
          error: "Acesso negado ou layout não publicado",
        });
      }

      void trendStatsService.recordLayoutView(id, req);
      return res.json(layout);
    } catch (error: any) {
      logger.error("❌ Erro ao obter layout:", error);
      return res.status(404).json({
        error: error.message || "Layout não encontrado",
      });
    }
  }

  

  async update(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const {
        name,
        fabricJsonState,
        previewImageUrl,
        tags,
        isPublished,
        isShared,
        width,
        height,
        productionTime,
      } = req.body;

      const parsedWidth = width ? Math.round(Number(width)) : undefined;
      const parsedHeight = height ? Math.round(Number(height)) : undefined;

      const layout = await dynamicLayoutService.getLayoutById(id);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const updateData: any = {};
      if (name) updateData.name = name;
      if (fabricJsonState) updateData.fabricJsonState = fabricJsonState;
      if (previewImageUrl) updateData.previewImageUrl = previewImageUrl;
      if (tags) updateData.tags = tags;
      if (isPublished !== undefined) updateData.isPublished = isPublished;
      if (isShared !== undefined) updateData.isShared = isShared;
      if (parsedWidth !== undefined) updateData.width = parsedWidth;
      if (parsedHeight !== undefined) updateData.height = parsedHeight;
      if (productionTime !== undefined)
        updateData.productionTime = Number(productionTime);

      const updatedLayout = await dynamicLayoutService.updateLayout(
        id,
        updateData
      );

      return res.json(updatedLayout);
    } catch (error: any) {
      logger.error("❌ Erro ao atualizar layout:", error);
      return res.status(400).json({
        error: error.message || "Erro ao atualizar layout",
      });
    }
  }

  

  async delete(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      const layout = await dynamicLayoutService.getLayoutById(id);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const result = await dynamicLayoutService.deleteLayout(id);

      return res.json(result);
    } catch (error: any) {
      logger.error("❌ Erro ao deletar layout:", error);
      return res.status(400).json({
        error: error.message || "Erro ao deletar layout",
      });
    }
  }

  

  async saveVersion(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { changeDescription } = req.body;

      const layout = await dynamicLayoutService.getLayoutById(id);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const version = await dynamicLayoutService.saveVersion(id, {
        changeDescription,
        changedBy: req.user?.id,
      });

      return res.status(201).json(version);
    } catch (error: any) {
      logger.error("❌ Erro ao salvar versão:", error);
      return res.status(400).json({
        error: error.message || "Erro ao salvar versão",
      });
    }
  }

  

  async listVersions(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { limit } = req.query;

      const layout = await dynamicLayoutService.getLayoutById(id);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const versions = await dynamicLayoutService.getVersions(
        id,
        limit ? parseInt(limit as string) : 10
      );

      return res.json(versions);
    } catch (error: any) {
      logger.error("❌ Erro ao listar versões:", error);
      return res.status(400).json({
        error: error.message || "Erro ao listar versões",
      });
    }
  }

  

  async restoreVersion(req: AuthenticatedRequest, res: Response) {
    try {
      const { id, versionNumber } = req.params;

      const layout = await dynamicLayoutService.getLayoutById(id);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const restored = await dynamicLayoutService.restoreVersion(
        id,
        parseInt(versionNumber),
        req.user?.id
      );

      return res.json(restored);
    } catch (error: any) {
      logger.error("❌ Erro ao restaurar versão:", error);
      return res.status(400).json({
        error: error.message || "Erro ao restaurar versão",
      });
    }
  }

  

  async addElement(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { elementType, fabricObjectId, data, order, isLocked } = req.body;

      if (!elementType || !fabricObjectId || !data) {
        return res.status(400).json({
          error: "Campos obrigatórios: elementType, fabricObjectId, data",
        });
      }

      const layout = await dynamicLayoutService.getLayoutById(id);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const element = await dynamicLayoutService.addElement(id, {
        elementType,
        fabricObjectId,
        data,
        order,
        isLocked,
      });

      return res.status(201).json(element);
    } catch (error: any) {
      logger.error("❌ Erro ao adicionar elemento:", error);
      return res.status(400).json({
        error: error.message || "Erro ao adicionar elemento",
      });
    }
  }

  

  async updateElement(req: AuthenticatedRequest, res: Response) {
    try {
      const { layoutId, elementId } = req.params;
      const { data, order, isLocked } = req.body;

      const layout = await dynamicLayoutService.getLayoutById(layoutId);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const updateData: any = {};
      if (data) updateData.data = data;
      if (order !== undefined) updateData.order = order;
      if (isLocked !== undefined) updateData.isLocked = isLocked;

      const element = await dynamicLayoutService.updateElement(
        elementId,
        updateData
      );

      return res.json(element);
    } catch (error: any) {
      logger.error("❌ Erro ao atualizar elemento:", error);
      return res.status(400).json({
        error: error.message || "Erro ao atualizar elemento",
      });
    }
  }

  

  async deleteElement(req: AuthenticatedRequest, res: Response) {
    try {
      const { layoutId, elementId } = req.params;

      const layout = await dynamicLayoutService.getLayoutById(layoutId);

      if (
        layout.userId &&
        layout.userId !== req.user?.id &&
        req.user?.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      const result = await dynamicLayoutService.deleteElement(elementId);

      return res.json(result);
    } catch (error: any) {
      logger.error("❌ Erro ao deletar elemento:", error);
      return res.status(400).json({
        error: error.message || "Erro ao deletar elemento",
      });
    }
  }
}

export default new DynamicLayoutController();
