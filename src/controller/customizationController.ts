import { Request, Response } from "express";
import customizationService from "../services/customizationService";
import previewService from "../services/previewService";
import constraintService from "../services/constraintService";

class CustomizationController {
  /**
   * Upload de arquivo temporário
   * POST /api/customization/upload-temp
   */
  async uploadTemporaryFile(req: Request, res: Response) {
    try {
      const { sessionId } = req.body;
      const file = req.file;

      if (!sessionId) {
        return res.status(400).json({
          error: "Session ID é obrigatório",
        });
      }

      if (!file) {
        return res.status(400).json({
          error: "Nenhum arquivo foi enviado",
        });
      }

      // Validar tipo de arquivo (apenas imagens)
      const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
      ];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          error: "Apenas imagens são permitidas (JPEG, PNG, WEBP)",
        });
      }

      // Validar tamanho (máx 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        return res.status(400).json({
          error: "Arquivo muito grande. Máximo: 10MB",
        });
      }

      const tempFile = await customizationService.saveTemporaryFile(
        sessionId,
        file
      );

      res.status(201).json({
        id: tempFile.id,
        original_name: tempFile.original_name,
        size: tempFile.size,
        mime_type: tempFile.mime_type,
        expires_at: tempFile.expires_at,
      });
    } catch (error: any) {
      console.error("Erro ao fazer upload de arquivo temporário:", error);
      res.status(500).json({
        error: "Erro ao fazer upload do arquivo",
        details: error.message,
      });
    }
  }

  /**
   * Buscar arquivos temporários de uma sessão
   * GET /api/customization/session/:sessionId/files
   */
  async getSessionFiles(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      const files = await customizationService.getSessionFiles(sessionId);

      res.json({
        files: files.map((f) => ({
          id: f.id,
          original_name: f.original_name,
          size: f.size,
          mime_type: f.mime_type,
          expires_at: f.expires_at,
        })),
      });
    } catch (error: any) {
      console.error("Erro ao buscar arquivos da sessão:", error);
      res.status(500).json({
        error: "Erro ao buscar arquivos",
        details: error.message,
      });
    }
  }

  /**
   * Deletar arquivo temporário
   * DELETE /api/customization/temp-file/:id
   */
  async deleteTemporaryFile(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await customizationService.deleteTemporaryFile(id);

      res.json({
        message: "Arquivo deletado com sucesso",
      });
    } catch (error: any) {
      console.error("Erro ao deletar arquivo temporário:", error);
      res.status(500).json({
        error: "Erro ao deletar arquivo",
        details: error.message,
      });
    }
  }

  /**
   * Buscar customizações de um produto
   * GET /api/products/:productId/customizations
   */
  async getProductCustomizations(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      const customizations =
        await customizationService.getProductCustomizations(productId);

      // Parse available_options de JSON string para objeto
      const formatted = customizations.map((c) => ({
        ...c,
        available_options: c.available_options
          ? JSON.parse(c.available_options)
          : null,
      }));

      res.json(formatted);
    } catch (error: any) {
      console.error("Erro ao buscar customizações do produto:", error);
      res.status(500).json({
        error: "Erro ao buscar customizações",
        details: error.message,
      });
    }
  }

  /**
   * Buscar customizações de um adicional
   * GET /api/additionals/:additionalId/customizations
   */
  async getAdditionalCustomizations(req: Request, res: Response) {
    try {
      const { additionalId } = req.params;

      const customizations =
        await customizationService.getAdditionalCustomizations(additionalId);

      // Parse available_options de JSON string para objeto
      const formatted = customizations.map((c) => ({
        ...c,
        available_options: c.available_options
          ? JSON.parse(c.available_options)
          : null,
      }));

      res.json(formatted);
    } catch (error: any) {
      console.error("Erro ao buscar customizações do adicional:", error);
      res.status(500).json({
        error: "Erro ao buscar customizações",
        details: error.message,
      });
    }
  }

  /**
   * Criar regra de customização para produto (ADMIN)
   * POST /api/admin/customization/product
   */
  async createProductCustomization(req: Request, res: Response) {
    try {
      const data = req.body;

      // Converter available_options para JSON string se for objeto
      if (
        data.available_options &&
        typeof data.available_options === "object"
      ) {
        data.available_options = JSON.stringify(data.available_options);
      }

      const customization =
        await customizationService.createProductCustomization(data);

      res.status(201).json(customization);
    } catch (error: any) {
      console.error("Erro ao criar customização de produto:", error);
      res.status(500).json({
        error: "Erro ao criar customização",
        details: error.message,
      });
    }
  }

  /**
   * Criar regra de customização para adicional (ADMIN)
   * POST /api/admin/customization/additional
   */
  async createAdditionalCustomization(req: Request, res: Response) {
    try {
      const data = req.body;

      // Converter available_options para JSON string se for objeto
      if (
        data.available_options &&
        typeof data.available_options === "object"
      ) {
        data.available_options = JSON.stringify(data.available_options);
      }

      const customization =
        await customizationService.createAdditionalCustomization(data);

      res.status(201).json(customization);
    } catch (error: any) {
      console.error("Erro ao criar customização de adicional:", error);
      res.status(500).json({
        error: "Erro ao criar customização",
        details: error.message,
      });
    }
  }

  /**
   * Atualizar regra de customização de produto (ADMIN)
   * PUT /api/admin/customization/product/:id
   */
  async updateProductCustomization(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;

      // Converter available_options para JSON string se for objeto
      if (
        data.available_options &&
        typeof data.available_options === "object"
      ) {
        data.available_options = JSON.stringify(data.available_options);
      }

      const customization =
        await customizationService.updateProductCustomization(id, data);

      res.json(customization);
    } catch (error: any) {
      console.error("Erro ao atualizar customização de produto:", error);
      res.status(500).json({
        error: "Erro ao atualizar customização",
        details: error.message,
      });
    }
  }

  /**
   * Atualizar regra de customização de adicional (ADMIN)
   * PUT /api/admin/customization/additional/:id
   */
  async updateAdditionalCustomization(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;

      // Converter available_options para JSON string se for objeto
      if (
        data.available_options &&
        typeof data.available_options === "object"
      ) {
        data.available_options = JSON.stringify(data.available_options);
      }

      const customization =
        await customizationService.updateAdditionalCustomization(id, data);

      res.json(customization);
    } catch (error: any) {
      console.error("Erro ao atualizar customização de adicional:", error);
      res.status(500).json({
        error: "Erro ao atualizar customização",
        details: error.message,
      });
    }
  }

  /**
   * Deletar regra de customização de produto (ADMIN)
   * DELETE /api/admin/customization/product/:id
   */
  async deleteProductCustomization(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await customizationService.deleteProductCustomization(id);

      res.json({
        message: "Customização deletada com sucesso",
      });
    } catch (error: any) {
      console.error("Erro ao deletar customização de produto:", error);
      res.status(500).json({
        error: "Erro ao deletar customização",
        details: error.message,
      });
    }
  }

  /**
   * Deletar regra de customização de adicional (ADMIN)
   * DELETE /api/admin/customization/additional/:id
   */
  async deleteAdditionalCustomization(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await customizationService.deleteAdditionalCustomization(id);

      res.json({
        message: "Customização deletada com sucesso",
      });
    } catch (error: any) {
      console.error("Erro ao deletar customização de adicional:", error);
      res.status(500).json({
        error: "Erro ao deletar customização",
        details: error.message,
      });
    }
  }

  /**
   * Limpar arquivos temporários expirados (CRON)
   * POST /api/admin/customization/cleanup
   */
  async cleanupExpiredFiles(req: Request, res: Response) {
    try {
      const deletedCount = await customizationService.cleanupExpiredFiles();

      res.json({
        message: "Limpeza concluída",
        deleted_count: deletedCount,
      });
    } catch (error: any) {
      console.error("Erro ao limpar arquivos expirados:", error);
      res.status(500).json({
        error: "Erro ao limpar arquivos",
        details: error.message,
      });
    }
  }

  // ================ NEW: UNIFIED ENDPOINTS ================

  /**
   * Buscar customizações por ID de referência (unificado)
   * GET /api/customizations/:referenceId
   */
  async getCustomizationsByReference(req: Request, res: Response) {
    try {
      const { referenceId } = req.params;

      const result = await customizationService.getCustomizationsByReference(
        referenceId
      );

      res.json(result);
    } catch (error: any) {
      console.error("Erro ao buscar customizações:", error);
      res.status(500).json({
        error: "Erro ao buscar customizações",
        details: error.message,
      });
    }
  }

  /**
   * Gerar preview de customização
   * POST /api/customization/preview
   */
  async generatePreview(req: Request, res: Response) {
    try {
      const { productId, customizationData } = req.body;

      // Validar dados
      const validation = previewService.validatePreviewData({
        productId,
        customizationData,
      });

      if (!validation.valid) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: validation.errors,
        });
      }

      const preview = await previewService.generatePreview({
        productId,
        customizationData,
      });

      res.json(preview);
    } catch (error: any) {
      console.error("Erro ao gerar preview:", error);
      res.status(500).json({
        error: "Erro ao gerar preview",
        details: error.message,
      });
    }
  }

  /**
   * Servir arquivo temporário para preview
   * GET /api/temp-files/:fileId
   */
  async serveTempFile(req: Request, res: Response) {
    try {
      const { fileId } = req.params;

      const fileData = await previewService.serveTempFile(fileId);

      if (!fileData) {
        return res.status(404).json({
          error: "Arquivo não encontrado ou expirado",
        });
      }

      res.setHeader("Content-Type", fileData.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${fileData.fileName}"`
      );
      res.sendFile(fileData.filePath);
    } catch (error: any) {
      console.error("Erro ao servir arquivo temporário:", error);
      res.status(500).json({
        error: "Erro ao servir arquivo",
        details: error.message,
      });
    }
  }

  // ================ NEW: PRODUCT RULE ADMIN ENDPOINTS ================

  /**
   * Criar regra de customização (novo sistema)
   * POST /api/admin/customization/rule
   */
  async createProductRule(req: Request, res: Response) {
    try {
      const data = req.body;

      const rule = await customizationService.createProductRule(data);

      res.status(201).json(rule);
    } catch (error: any) {
      console.error("Erro ao criar regra de customização:", error);
      res.status(500).json({
        error: "Erro ao criar regra",
        details: error.message,
      });
    }
  }

  /**
   * Atualizar regra de customização
   * PUT /api/admin/customization/rule/:id
   */
  async updateProductRule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;

      const rule = await customizationService.updateProductRule(id, data);

      res.json(rule);
    } catch (error: any) {
      console.error("Erro ao atualizar regra:", error);
      res.status(500).json({
        error: "Erro ao atualizar regra",
        details: error.message,
      });
    }
  }

  /**
   * Deletar regra de customização
   * DELETE /api/admin/customization/rule/:id
   */
  async deleteProductRule(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await customizationService.deleteProductRule(id);

      res.json({
        message: "Regra deletada com sucesso",
      });
    } catch (error: any) {
      console.error("Erro ao deletar regra:", error);
      res.status(500).json({
        error: "Erro ao deletar regra",
        details: error.message,
      });
    }
  }

  /**
   * Validar regras de customização
   * POST /api/customization/validate
   */
  async validateCustomizations(req: Request, res: Response) {
    try {
      const { productId, customizations } = req.body;

      if (!productId) {
        return res.status(400).json({
          error: "ID do produto é obrigatório",
        });
      }

      const validation = await customizationService.validateProductRules(
        productId,
        customizations || []
      );

      res.json(validation);
    } catch (error: any) {
      console.error("Erro ao validar customizações:", error);
      res.status(500).json({
        error: "Erro ao validar customizações",
        details: error.message,
      });
    }
  }

  // ================ ITEM CONSTRAINTS ENDPOINTS ================

  /**
   * Criar restrição entre itens
   * POST /api/admin/constraints
   */
  async createConstraint(req: Request, res: Response) {
    try {
      const data = req.body;

      const constraint = await constraintService.createConstraint(data);

      res.status(201).json(constraint);
    } catch (error: any) {
      console.error("Erro ao criar restrição:", error);
      res.status(500).json({
        error: "Erro ao criar restrição",
        details: error.message,
      });
    }
  }

  /**
   * Listar restrições de um item
   * GET /api/admin/constraints/:itemId
   */
  async getItemConstraints(req: Request, res: Response) {
    try {
      const { itemId } = req.params;
      const { itemType } = req.query;

      if (!itemType || (itemType !== "PRODUCT" && itemType !== "ADDITIONAL")) {
        return res.status(400).json({
          error: "itemType inválido. Use 'PRODUCT' ou 'ADDITIONAL'",
        });
      }

      const constraints = await constraintService.getItemConstraints(
        itemId,
        itemType as "PRODUCT" | "ADDITIONAL"
      );

      res.json(constraints);
    } catch (error: any) {
      console.error("Erro ao buscar restrições:", error);
      res.status(500).json({
        error: "Erro ao buscar restrições",
        details: error.message,
      });
    }
  }

  /**
   * Validar restrições do carrinho
   * POST /api/constraints/validate
   */
  async validateCartConstraints(req: Request, res: Response) {
    try {
      const { items } = req.body;

      if (!Array.isArray(items)) {
        return res.status(400).json({
          error: "Items deve ser um array",
        });
      }

      const validation = await constraintService.validateItemConstraints(items);

      res.json(validation);
    } catch (error: any) {
      console.error("Erro ao validar restrições:", error);
      res.status(500).json({
        error: "Erro ao validar restrições do carrinho",
        details: error.message,
      });
    }
  }

  /**
   * Deletar restrição
   * DELETE /api/admin/constraints/:id
   */
  async deleteConstraint(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await constraintService.deleteConstraint(id);

      res.json({
        message: "Restrição deletada com sucesso",
      });
    } catch (error: any) {
      console.error("Erro ao deletar restrição:", error);
      res.status(500).json({
        error: "Erro ao deletar restrição",
        details: error.message,
      });
    }
  }
}

export default new CustomizationController();
