import { Request, Response } from "express";
import sharp from "sharp";
import { saveImageLocally } from "../config/localStorage";
import elementBankService from "../services/elementBankService";
import logger from "../utils/logger";

class UploadController {
  async uploadImage(req: Request, res: Response) {
    try {

      const file = ((): any => {
        if (req.file) return req.file;
        if (Array.isArray(req.files) && req.files.length) return req.files[0];
        if (req.files && typeof req.files === "object") {
          const vals = Object.values(req.files).flat();
          if (vals.length) return vals[0];
        }
        return null;
      })();

      if (!file) {
        return res.status(400).json({ error: "Nenhuma imagem foi enviada" });
      }

      try {

        const imageUrl = await saveImageLocally(
          file.buffer,
          file.originalname,
          file.mimetype
        );

        await elementBankService.createElement({
          category: "Uploads",
          name: file.originalname,
          imageUrl: imageUrl,
          source: "local",
        });

        return res.status(200).json({
          url: imageUrl,
          image_url: imageUrl,
          imageUrl: imageUrl,
          message: "Upload realizado com sucesso e salvo no banco",
        });
      } catch (imageError: any) {
        return res.status(500).json({
          error: "Erro ao processar imagem",
          details: imageError.message,
        });
      }
    } catch (error: any) {
      return res.status(500).json({
        error: "Erro ao fazer upload",
        details: error.message,
      });
    }
  }
}

export default new UploadController();
