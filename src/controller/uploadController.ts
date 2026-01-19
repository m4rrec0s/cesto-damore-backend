import { Request, Response } from "express";
import sharp from "sharp";
import { saveImageLocally } from "../config/localStorage";

class UploadController {
  async uploadImage(req: Request, res: Response) {
    try {
      // Processar o arquivo enviado
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
          file.data,
          file.name,
          file.mimetype
        );

        console.log("✅ [UPLOAD] Upload concluído com sucesso!");
        console.log("🔗 [UPLOAD] URL:", imageUrl);

        return res.status(200).json({
          url: imageUrl,
          image_url: imageUrl,
          imageUrl: imageUrl, // Adicionado para compatibilidade com frontend
          message: "Upload realizado com sucesso",
        });
      } catch (imageError: any) {
        console.error("❌ [UPLOAD] Erro ao processar imagem:", imageError);
        console.error("❌ [UPLOAD] Stack:", imageError.stack);
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
