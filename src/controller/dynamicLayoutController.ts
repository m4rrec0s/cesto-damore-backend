import { Request, Response } from "express";
import dynamicLayoutService from "../services/dynamicLayoutService";
import logger from "../utils/logger";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role?: string;
  };
}

class DynamicLayoutController {
  /**
   * POST /api/layouts/dynamic
   * Criar novo layout dinâmico
   */
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

      // Validar campos obrigatórios
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

      // Validar tipo
      const validTypes = ["mug", "frame", "custom"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: `Tipo inválido. Valores permitidos: ${validTypes.join(", ")}`,
        });
      }

      // Validar dimensões
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

  /**
   * GET /api/layouts/dynamic
   * Listar layouts dinâmicos
   */
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const { type, isPublished, search, userId: userIdQuery } = req.query;

      // Se not admin, retorna apenas layouts próprios ou públicos
      const filters: any = {};

      if (type) filters.type = type as string;
      if (isPublished === "true") filters.isPublished = true;
      if (search) filters.search = search as string;

      // Lógica de visibilidade baseada na autenticação
      if (req.user) {
        if (req.user.role !== "admin") {
          // Se for usuário autenticado mas não admin, vê os seus layouts
          // ou layouts marcados como publicados
          filters.visibilityFilter = {
            userId: req.user.id,
            includePublished: true,
          };
        } else {
          // Admin vê tudo de acordo com os filtros passados
          if (userIdQuery) filters.userId = userIdQuery as string;
        }
      } else {
        // Acesso público (não autenticado): apenas layouts publicados
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

  /**
   * GET /api/layouts/dynamic/:id
   * Obter detalhe de um layout
   */
  async show(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      const layout = await dynamicLayoutService.getLayoutById(id);

      // Verificar autorização: permitindo acesso se for publicado,
      // ou se o usuário for o dono, ou se for admin
      const isOwner = layout.userId === req.user?.id;
      const isAdmin = req.user?.role === "admin";
      const isPubliclyVisible = layout.isPublished;

      if (!isOwner && !isAdmin && !isPubliclyVisible) {
        return res.status(403).json({
          error: "Acesso negado ou layout não publicado",
        });
      }

      return res.json(layout);
    } catch (error: any) {
      logger.error("❌ Erro ao obter layout:", error);
      return res.status(404).json({
        error: error.message || "Layout não encontrado",
      });
    }
  }

  /**
   * PUT /api/layouts/dynamic/:id
   * Atualizar layout dinâmico
   */
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

      // Garantir que width e height sejam números inteiros para o Prisma
      const parsedWidth = width ? Math.round(Number(width)) : undefined;
      const parsedHeight = height ? Math.round(Number(height)) : undefined;

      // Verificar se layout existe e autorização
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

  /**
   * DELETE /api/layouts/dynamic/:id
   * Deletar layout
   */
  async delete(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      // Verificar autorização
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

  /**
   * POST /api/layouts/dynamic/:id/versions
   * Salvar versão do layout
   */
  async saveVersion(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { changeDescription } = req.body;

      // Verificar autorização
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

  /**
   * GET /api/layouts/dynamic/:id/versions
   * Listar versões do layout
   */
  async listVersions(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { limit } = req.query;

      // Verificar autorização
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

  /**
   * POST /api/layouts/dynamic/:id/versions/:versionNumber/restore
   * Restaurar versão anterior
   */
  async restoreVersion(req: AuthenticatedRequest, res: Response) {
    try {
      const { id, versionNumber } = req.params;

      // Verificar autorização
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

  /**
   * POST /api/layouts/dynamic/:id/elements
   * Adicionar elemento ao layout
   */
  async addElement(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { elementType, fabricObjectId, data, order, isLocked } = req.body;

      if (!elementType || !fabricObjectId || !data) {
        return res.status(400).json({
          error: "Campos obrigatórios: elementType, fabricObjectId, data",
        });
      }

      // Verificar autorização
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

  /**
   * PUT /api/layouts/dynamic/:layoutId/elements/:elementId
   * Atualizar elemento
   */
  async updateElement(req: AuthenticatedRequest, res: Response) {
    try {
      const { layoutId, elementId } = req.params;
      const { data, order, isLocked } = req.body;

      // Verificar autorização
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

  /**
   * DELETE /api/layouts/dynamic/:layoutId/elements/:elementId
   * Deletar elemento
   */
  async deleteElement(req: AuthenticatedRequest, res: Response) {
    try {
      const { layoutId, elementId } = req.params;

      // Verificar autorização
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
