import { Request, Response } from "express";
import fs from "fs";
import path from "path";

class CustomizationUploadController {
  /**
   * POST /api/customization/upload-image
   * Upload de imagem para preview de regras de customização
   */
  async uploadImage(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Nenhum arquivo enviado",
          message: "É necessário enviar um arquivo de imagem",
        });
      }

      const file = req.file;

      // Garantir que a pasta existe
      const customizationDir = path.join(
        process.cwd(),
        "images",
        "customizations"
      );

      if (!fs.existsSync(customizationDir)) {
        fs.mkdirSync(customizationDir, { recursive: true });
      }

      // Gerar nome único para o arquivo
      const timestamp = Date.now();
      const sanitizedOriginalName = file.originalname
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .toLowerCase();
      const filename = `${timestamp}-${sanitizedOriginalName}`;
      const filepath = path.join(customizationDir, filename);

      // Salvar arquivo
      fs.writeFileSync(filepath, file.buffer);

      // Retornar URL relativa que pode ser acessada via GET /images/customizations/:filename
      const imageUrl = `/images/customizations/${filename}`;

      return res.status(201).json({
        success: true,
        imageUrl,
        filename,
        mimeType: file.mimetype,
        size: file.size,
      });
    } catch (error: any) {
      console.error("Erro ao fazer upload de imagem:", error);
      return res.status(500).json({
        error: "Erro ao fazer upload da imagem",
        details: error.message,
      });
    }
  }

  /**
   * DELETE /api/customization/image/:filename
   * Remove uma imagem de customização
   */
  async deleteImage(req: Request, res: Response) {
    try {
      const { filename } = req.params;

      if (!filename) {
        return res.status(400).json({
          error: "Nome do arquivo não informado",
        });
      }

      const filepath = path.join(
        process.cwd(),
        "images",
        "customizations",
        filename
      );

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({
          error: "Arquivo não encontrado",
        });
      }

      fs.unlinkSync(filepath);

      return res.json({
        success: true,
        message: "Imagem removida com sucesso",
      });
    } catch (error: any) {
      console.error("Erro ao remover imagem:", error);
      return res.status(500).json({
        error: "Erro ao remover imagem",
        details: error.message,
      });
    }
  }
}

export default new CustomizationUploadController();
