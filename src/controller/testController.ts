import { Request, Response } from "express";
import {
  saveImageLocally,
  deleteImageLocally,
  listLocalImages,
} from "../config/localStorage";

export const testController = {
  async testUpload(req: Request, res: Response) {
    console.log("=== TEST UPLOAD ENDPOINT ===");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);
    console.log("File:", req.file);
    console.log("Files:", req.files);
    console.log("Content-Type:", req.headers["content-type"]);

    // Log detalhado dos arquivos
    if (req.files) {
      console.log("Files details:");
      if (Array.isArray(req.files)) {
        req.files.forEach((file, index) => {
          console.log(`File ${index}:`, {
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
          });
        });
      } else {
        Object.entries(req.files).forEach(([key, files]) => {
          console.log(`Field ${key}:`, files);
        });
      }
    }

    let imageUrl = null;
    let uploadError = null;

    // Tenta fazer upload local se houver arquivo
    if (req.file) {
      try {
        console.log("🚀 Salvando imagem localmente...");
        imageUrl = await saveImageLocally(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype
        );
        console.log("✅ Upload realizado com sucesso:", imageUrl);
      } catch (error: any) {
        console.error("❌ Erro no upload local:", error.message);
        uploadError = error.message;
      }
    }

    console.log("========================");

    res.json({
      message: "Test endpoint",
      hasFile: !!req.file,
      hasFiles: !!req.files,
      bodyKeys: Object.keys(req.body || {}),
      body: req.body,
      file: req.file
        ? {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
          }
        : null,
      files: req.files
        ? Array.isArray(req.files)
          ? req.files.map((f) => ({
              fieldname: f.fieldname,
              originalname: f.originalname,
              mimetype: f.mimetype,
              size: f.size,
            }))
          : Object.entries(req.files).reduce((acc, [key, files]) => {
              acc[key] = Array.isArray(files)
                ? files.map((f) => ({
                    fieldname: f.fieldname,
                    originalname: f.originalname,
                    mimetype: f.mimetype,
                    size: f.size,
                  }))
                : files;
              return acc;
            }, {} as any)
        : null,
      // Informações do upload local
      localStorage: {
        success: !!imageUrl,
        url: imageUrl,
        error: uploadError,
      },
    });
  },

  async testLocalUpload(req: Request, res: Response) {
    console.log("=== TEST LOCAL UPLOAD ENDPOINT ===");

    if (!req.file) {
      return res.status(400).json({
        error: "Nenhum arquivo foi enviado",
        message: "Envie um arquivo usando o campo 'image'",
      });
    }

    try {
      console.log("📁 Arquivo recebido:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      console.log("🚀 Salvando imagem localmente...");
      const imageUrl = await saveImageLocally(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      console.log("✅ Upload concluído com sucesso!");
      console.log("🔗 URL:", imageUrl);
      console.log("========================");

      res.json({
        success: true,
        message: "Upload realizado com sucesso!",
        file: {
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
        imageUrl: imageUrl,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("❌ Erro no upload:", error.message);
      console.log("========================");

      res.status(500).json({
        success: false,
        error: "Erro no upload local",
        message: error.message,
        file: {
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
      });
    }
  },

  async listImages(req: Request, res: Response) {
    console.log("=== LISTANDO IMAGENS LOCAIS ===");

    try {
      const images = listLocalImages();

      res.json({
        success: true,
        message: "Imagens listadas com sucesso",
        totalImages: images.length,
        images,
        storageInfo: {
          totalSize: images.reduce((sum, img) => sum + img.size, 0),
          directory: "images/",
        },
      });
    } catch (error: any) {
      console.error("❌ Erro:", error.message);
      res.status(500).json({
        success: false,
        error: "Erro ao listar imagens",
        message: error.message,
      });
    }
  },

  async deleteImage(req: Request, res: Response) {
    console.log("=== DELETANDO IMAGEM ===");

    const imageUrl = req.body.imageUrl || (req.query.imageUrl as string);

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: "URL da imagem não fornecida",
        message: "Forneça imageUrl no body ou query string",
      });
    }

    try {
      await deleteImageLocally(imageUrl);

      res.json({
        success: true,
        message: "Imagem deletada com sucesso",
        deletedUrl: imageUrl,
      });
    } catch (error: any) {
      console.error("❌ Erro:", error.message);
      res.status(500).json({
        success: false,
        error: "Erro ao deletar imagem",
        message: error.message,
      });
    }
  },

  async testPlain(req: Request, res: Response) {
    console.log("=== TEST PLAIN ENDPOINT ===");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);
    console.log("========================");

    res.json({
      message: "Plain endpoint",
      bodyKeys: Object.keys(req.body || {}),
      body: req.body,
    });
  },
};

export default testController;
