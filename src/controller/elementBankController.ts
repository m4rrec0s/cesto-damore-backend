import { Request, Response } from "express";
import elementBankService from "../services/elementBankService";
import { saveImageLocally } from "../config/localStorage";
import logger from "../utils/logger";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role?: string;
  };
}

class ElementBankController {
  

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const { category, name, tags, width, height, source, externalId } =
        req.body;

      if (!category || !name) {
        return res.status(400).json({
          error: "Campos obrigatórios: category, name",
        });
      }

      let imageUrl = "";
      let thumbnailUrl = "";

      if (req.file) {
        try {
          imageUrl = await saveImageLocally(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
          );

          logger.info("✅ Imagem salva", { url: imageUrl });
        } catch (uploadError) {
          logger.error("❌ Erro ao salvar imagem:", uploadError);
          return res.status(400).json({
            error: "Erro ao salvar imagem",
          });
        }
      } else if (req.body.imageUrl) {

        imageUrl = req.body.imageUrl;
      } else {
        return res.status(400).json({
          error: "Imagem obrigatória: envie arquivo ou forneça imageUrl",
        });
      }

      const element = await elementBankService.createElement({
        category,
        name,
        imageUrl,
        thumbnailUrl,
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : [],
        width: width ? parseInt(width) : undefined,
        height: height ? parseInt(height) : undefined,
        source: source || "local",
        externalId,
      });

      return res.status(201).json(element);
    } catch (error: any) {
      logger.error("❌ Erro ao criar elemento:", error);
      return res.status(400).json({
        error: error.message || "Erro ao criar elemento",
      });
    }
  }

  

  async list(req: AuthenticatedRequest, res: Response) {
    try {
      const { category, search, source, tags, limit, offset } = req.query;

      const filters: any = {};

      if (category) filters.category = category as string;
      if (search) filters.search = search as string;
      if (source) filters.source = source as string;
      if (tags) {
        filters.tags = Array.isArray(tags)
          ? (tags as string[])
          : [tags as string];
      }
      if (limit) filters.limit = parseInt(limit as string);
      if (offset) filters.offset = parseInt(offset as string);

      const result = await elementBankService.listElements(filters);

      return res.json(result);
    } catch (error: any) {
      logger.error("❌ Erro ao listar elementos:", error);
      return res.status(500).json({
        error: error.message || "Erro ao listar elementos",
      });
    }
  }

  

  async listCategories(req: AuthenticatedRequest, res: Response) {
    try {
      const categories = await elementBankService.listCategories();

      return res.json({
        categories,
        count: categories.length,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao listar categorias:", error);
      return res.status(500).json({
        error: error.message || "Erro ao listar categorias",
      });
    }
  }

  

  async show(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      const element = await elementBankService.getElementById(id);

      return res.json(element);
    } catch (error: any) {
      logger.error("❌ Erro ao obter elemento:", error);
      return res.status(404).json({
        error: error.message || "Elemento não encontrado",
      });
    }
  }

  

  async update(req: AuthenticatedRequest, res: Response) {
    try {

      if (req.user?.role !== "admin") {
        return res.status(403).json({
          error: "Acesso negado - permissão de administrador necessária",
        });
      }

      const { id } = req.params;
      const { name, tags, width, height, isActive } = req.body;

      const updateData: any = {};
      if (name) updateData.name = name;
      if (tags) updateData.tags = Array.isArray(tags) ? tags : [tags];
      if (width) updateData.width = parseInt(width);
      if (height) updateData.height = parseInt(height);
      if (isActive !== undefined) updateData.isActive = isActive;

      const element = await elementBankService.updateElement(id, updateData);

      return res.json(element);
    } catch (error: any) {
      logger.error("❌ Erro ao atualizar elemento:", error);
      return res.status(400).json({
        error: error.message || "Erro ao atualizar elemento",
      });
    }
  }

  

  async delete(req: AuthenticatedRequest, res: Response) {
    try {

      if (req.user?.role !== "admin") {
        return res.status(403).json({
          error: "Acesso negado - permissão de administrador necessária",
        });
      }

      const { id } = req.params;

      const result = await elementBankService.deleteElement(id);

      return res.json(result);
    } catch (error: any) {
      logger.error("❌ Erro ao deletar elemento:", error);
      return res.status(400).json({
        error: error.message || "Erro ao deletar elemento",
      });
    }
  }

  

  async bulkCreate(req: AuthenticatedRequest, res: Response) {
    try {

      if (req.user?.role !== "admin") {
        return res.status(403).json({
          error: "Acesso negado - permissão de administrador necessária",
        });
      }

      const { elements } = req.body;

      if (!Array.isArray(elements) || elements.length === 0) {
        return res.status(400).json({
          error: "Array 'elements' obrigatório e não pode estar vazio",
        });
      }

      for (const el of elements) {
        if (!el.category || !el.name || !el.imageUrl) {
          return res.status(400).json({
            error: "Cada elemento deve ter: category, name, imageUrl",
          });
        }
      }

      const result = await elementBankService.bulkCreateElements(elements);

      return res.status(201).json({
        created: result.count,
        message: `${result.count} elemento(s) importado(s) com sucesso`,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao importar elementos:", error);
      return res.status(400).json({
        error: error.message || "Erro ao importar elementos",
      });
    }
  }
}

export default new ElementBankController();
