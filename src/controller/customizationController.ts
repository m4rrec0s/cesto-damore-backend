import { Request, Response } from "express";
import customizationService from "../services/customizationService";

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
}

export default new CustomizationController();
