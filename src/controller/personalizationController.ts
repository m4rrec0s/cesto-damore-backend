import { Request, Response } from "express";
import personalizationService from "../services/personalizationService";

interface AuthenticatedRequest extends Request {
  userId?: string;
}

class PersonalizationController {
  /**
   * POST /orders/:orderId/items/:itemId/personalize/commit
   * Finalizar personalização do item
   */
  async commit(req: AuthenticatedRequest, res: Response) {
    try {
      const { orderId, itemId } = req.params;
      const { layoutBaseId, configJson, images } = req.body;

      if (!req.userId) {
        return res.status(401).json({ error: "Não autenticado" });
      }

      // Validar campos
      if (!layoutBaseId || !images || !Array.isArray(images)) {
        return res.status(400).json({
          error: "Campos obrigatórios: layoutBaseId, images (array)",
        });
      }

      const result = await personalizationService.commitPersonalization(
        req.userId,
        {
          orderId,
          itemId,
          layoutBaseId,
          configJson: configJson || {},
          images,
        }
      );

      return res.status(201).json(result);
    } catch (error) {
      console.error("Erro ao finalizar personalização:", error);
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Erro ao finalizar personalização",
      });
    }
  }

  /**
   * POST /preview/compose
   * Gerar preview da composição
   */
  async preview(req: Request, res: Response) {
    try {
      const { layoutBaseId, images, width } = req.body;

      if (!layoutBaseId || !images || !Array.isArray(images)) {
        return res.status(400).json({
          error: "Campos obrigatórios: layoutBaseId, images (array)",
        });
      }

      const maxWidth = width ? parseInt(width) : 800;

      const previewBuffer = await personalizationService.generatePreview(
        layoutBaseId,
        images,
        maxWidth
      );

      // Retornar imagem como base64
      const base64 = previewBuffer.toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;

      return res.json({
        previewUrl: dataUrl,
      });
    } catch (error) {
      console.error("Erro ao gerar preview:", error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Erro ao gerar preview",
      });
    }
  }

  /**
   * GET /personalizations/:id
   * Buscar personalização por ID
   */
  async show(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      const personalization = await personalizationService.getById(id);

      // Verificar se pertence ao usuário (se não for admin)
      if (req.userId && personalization.order.user_id !== req.userId) {
        return res.status(403).json({
          error: "Sem permissão para acessar esta personalização",
        });
      }

      return res.json(personalization);
    } catch (error) {
      console.error("Erro ao buscar personalização:", error);
      return res.status(404).json({
        error:
          error instanceof Error
            ? error.message
            : "Personalização não encontrada",
      });
    }
  }

  /**
   * GET /orders/:orderId/personalizations
   * Listar personalizações de um pedido
   */
  async listByOrder(req: AuthenticatedRequest, res: Response) {
    try {
      const { orderId } = req.params;

      const personalizations = await personalizationService.listByOrder(
        orderId,
        req.userId
      );

      return res.json(personalizations);
    } catch (error) {
      console.error("Erro ao listar personalizações:", error);
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Erro ao listar personalizações",
      });
    }
  }
}

export default new PersonalizationController();
