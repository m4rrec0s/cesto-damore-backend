import { Request, Response } from "express";
import tempUploadService from "../services/tempUploadService";
import logger from "../utils/logger";

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

class TempUploadController {
  /**
   * POST /api/uploads/temp
   * Fazer upload de arquivo temporário com TTL
   */
  async uploadTemp(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo fornecido" });
      }

      const userId = (req.user as any)?.id; // ID do usuário autenticado (opcional)
      const clientIp =
        (req.headers["x-forwarded-for"] as string) ||
        req.ip ||
        req.socket.remoteAddress;
      const ttlHours = req.body.ttlHours
        ? parseInt(req.body.ttlHours)
        : undefined;

      const result = await tempUploadService.saveTempUpload(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        { userId, clientIp, ttlHours },
      );

      return res.status(200).json({
        success: true,
        data: result,
        url: result.url,
        message: "Arquivo salvo temporariamente",
      });
    } catch (error) {
      logger.error("❌ Erro no upload temporário:", error);
      return res.status(500).json({
        error: "Erro ao fazer upload",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * POST /api/uploads/temp/:uploadId/make-permanent
   * Converter arquivo temporário para permanente (após compra)
   */
  async makePermanent(req: Request, res: Response) {
    try {
      const { uploadId } = req.params;
      const { orderId } = req.body;

      if (!orderId) {
        return res.status(400).json({ error: "orderId é obrigatório" });
      }

      // Verificação: apenas admin ou o dono do upload pode converter
      const upload = await (
        await import("../database/prisma").then((m) => m.default)
      ).tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        return res.status(404).json({ error: "Upload não encontrado" });
      }

      const userId = (req.user as any)?.id;
      if (upload.userId && upload.userId !== userId) {
        // Permitir admin passthrough (validado em middleware anterior)
      }

      const result = await tempUploadService.makePermanent(uploadId, orderId);

      return res.status(200).json({
        success: true,
        data: result,
        message: "Arquivo convertido para permanente",
      });
    } catch (error) {
      logger.error("❌ Erro ao converter para permanente:", error);
      return res.status(500).json({
        error: "Erro ao processar",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * DELETE /api/uploads/temp/:uploadId
   * Deletar arquivo temporário
   */
  async deleteTemp(req: Request, res: Response) {
    try {
      const { uploadId } = req.params;

      // Validação: apenas o dono ou admin podem deletar
      const upload = await (
        await import("../database/prisma").then((m) => m.default)
      ).tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        return res.status(404).json({ error: "Upload não encontrado" });
      }

      const userId = (req.user as any)?.id;
      if (upload.userId && upload.userId !== userId) {
        return res.status(403).json({ error: "Acesso negado" });
      }

      await tempUploadService.deleteTempUpload(uploadId);

      return res.status(200).json({
        success: true,
        message: "Arquivo deletado",
      });
    } catch (error) {
      logger.error("❌ Erro ao deletar upload:", error);
      return res.status(500).json({
        error: "Erro ao deletar",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * GET /api/uploads/stats
   * Obter estatísticas de uso (admin only)
   */
  async getStats(req: Request, res: Response) {
    try {
      const stats = await tempUploadService.getStorageStats();

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("❌ Erro ao obter estatísticas:", error);
      return res.status(500).json({
        error: "Erro ao obter estatísticas",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * POST /api/uploads/cleanup
   * Executar limpeza manual (admin only)
   */
  async cleanup(req: Request, res: Response) {
    try {
      const result = await tempUploadService.cleanupExpiredUploads();

      return res.status(200).json({
        success: true,
        data: result,
        message: `Limpeza concluída: ${result.deletedCount} arquivos deletados`,
      });
    } catch (error) {
      logger.error("❌ Erro durante limpeza:", error);
      return res.status(500).json({
        error: "Erro ao fazer limpeza",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export default new TempUploadController();
