import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import tempFileService from "../services/tempFileService";
import logger from "../utils/logger";

class CustomizationUploadController {
  

  async uploadImage(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Nenhum arquivo enviado",
          message: "É necessário enviar um arquivo de imagem",
        });
      }

      const file = req.file;

      const result = await tempFileService.saveFile(
        file.buffer,
        file.originalname
      );

      logger.info(
        `✅ [customizationUploadController] Imagem de customização salva: ${result.filename}`
      );

      return res.status(201).json({
        success: true,
        imageUrl: result.url,
        filename: result.filename,
        mimeType: file.mimetype,
        size: file.size,
        originalName: file.originalname,
      });
    } catch (error: any) {
      logger.error(
        "❌ [customizationUploadController] Erro ao fazer upload:",
        error
      );
      return res.status(500).json({
        error: "Erro ao fazer upload da imagem",
        details: error.message,
      });
    }
  }

  

  async deleteImage(req: Request, res: Response) {
    try {
      const { filename } = req.params;

      if (!filename) {
        return res.status(400).json({
          error: "Nome do arquivo não informado",
        });
      }

      const deleted = tempFileService.deleteFile(filename);

      if (!deleted) {
        return res.status(404).json({
          error: "Arquivo não encontrado ou não pôde ser deletado",
        });
      }

      logger.info(
        `✅ [customizationUploadController] Imagem deletada: ${filename}`
      );

      return res.json({
        success: true,
        message: "Imagem removida com sucesso",
      });
    } catch (error: any) {
      logger.error(
        "❌ [customizationUploadController] Erro ao deletar:",
        error
      );
      return res.status(500).json({
        error: "Erro ao remover imagem",
        details: error.message,
      });
    }
  }
}

export default new CustomizationUploadController();
