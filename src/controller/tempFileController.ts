import { Request, Response } from "express";
import tempFileService from "../services/tempFileService";
import logger from "../utils/logger";

class TempFileController {
  

  async upload(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Nenhum arquivo enviado",
          message: "É necessário enviar um arquivo",
        });
      }

      const file = req.file;

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        return res.status(413).json({
          error: "Arquivo muito grande",
          message: `Máximo permitido: ${maxSize / 1024 / 1024}MB`,
          maxSize,
          fileSize: file.size,
        });
      }

      const allowedMimes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/svg+xml",
      ];
      if (!allowedMimes.includes(file.mimetype)) {
        return res.status(415).json({
          error: "Tipo de arquivo não permitido",
          message: "Apenas imagens são aceitas",
          receivedMime: file.mimetype,
          allowedMimes,
        });
      }

      const result = await tempFileService.saveFile(
        file.buffer,
        file.originalname
      );

      return res.status(201).json({
        success: true,
        filename: result.filename,
        url: result.url,
        size: file.size,
        mimeType: file.mimetype,
        originalName: file.originalname,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao fazer upload de arquivo temporário:", error);
      return res.status(500).json({
        error: "Erro ao fazer upload",
        details: error.message,
      });
    }
  }

  

  async listFiles(req: Request, res: Response) {
    try {

      const files = tempFileService.listFiles();

      return res.json({
        success: true,
        count: files.length,
        files: files.map((f) => ({
          filename: f.filename,
          size: f.size,
          sizeKB: (f.size / 1024).toFixed(2),
          createdAt: f.createdAt,
          ageMinutes: Math.round(
            (Date.now() - f.createdAt.getTime()) / 1000 / 60
          ),
        })),
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
      });
    } catch (error: any) {
      logger.error("❌ Erro ao listar arquivos temp:", error);
      return res.status(500).json({
        error: "Erro ao listar arquivos",
        details: error.message,
      });
    }
  }

  

  async deleteFile(req: Request, res: Response) {
    try {
      const { filename } = req.params;

      if (!filename) {
        return res.status(400).json({
          error: "Nome do arquivo não informado",
        });
      }

      if (
        filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        return res.status(400).json({
          error: "Nome de arquivo inválido",
        });
      }

      const deleted = tempFileService.deleteFile(filename);

      if (!deleted) {
        return res.status(404).json({
          error: "Arquivo não encontrado ou já foi deletado",
        });
      }

      return res.json({
        success: true,
        message: "Arquivo deletado com sucesso",
        filename,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao deletar arquivo temp:", error);
      return res.status(500).json({
        error: "Erro ao deletar arquivo",
        details: error.message,
      });
    }
  }

  

  async cleanup(req: Request, res: Response) {
    try {

      const hoursParam = req.query.hours;
      const hours =
        hoursParam && !isNaN(Number(hoursParam)) ? Number(hoursParam) : 48;

      const result = tempFileService.cleanupOldFiles(hours);

      return res.json({
        success: true,
        message: `Limpeza concluída: ${result.deleted} deletados, ${result.failed} falharam`,
        ...result,
        hoursThreshold: hours,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao fazer cleanup de temp files:", error);
      return res.status(500).json({
        error: "Erro ao fazer cleanup",
        details: error.message,
      });
    }
  }

  

  async cleanupByOrder(req: Request, res: Response) {
    try {
      const { filenames } = req.body as { filenames?: string[] };

      if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({
          error: "Lista de arquivos não fornecida",
          message: "Envie um array 'filenames' com os nomes dos arquivos",
        });
      }

      const result = tempFileService.deleteFiles(filenames);

      return res.json({
        success: true,
        message: `${result.deleted} arquivo(s) deletado(s), ${result.failed} falharam`,
        ...result,
      });
    } catch (error: any) {
      logger.error("❌ Erro ao fazer cleanup by order:", error);
      return res.status(500).json({
        error: "Erro ao fazer cleanup",
        details: error.message,
      });
    }
  }
}

export default new TempFileController();
