import { Request, Response } from "express";
import additionalService from "../services/additionalService";
import sharp from "sharp";
import { saveImageLocally } from "../config/localStorage";

class AdditionalController {
  async index(req: Request, res: Response) {
    try {
      const additionals = await additionalService.getAllAdditionals();
      res.json(additionals);
    } catch (error: any) {
      console.error("Erro ao buscar adicionais:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const additional = await additionalService.getAdditionalById(id);
      res.json(additional);
    } catch (error: any) {
      console.error("Erro ao buscar adicional:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async create(req: Request, res: Response) {
    try {
      const data = { ...req.body };

      // Processamento de imagem se fornecida
      if (req.file) {
        try {
          const compressedImage = await sharp(req.file.buffer)
            .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          const imageUrl = await saveImageLocally(
            compressedImage,
            req.file.originalname || `additional_${Date.now()}.jpg`,
            "image/jpeg"
          );

          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro no processamento de imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const additional = await additionalService.createAdditional(data);
      res.status(201).json(additional);
    } catch (error: any) {
      console.error("Erro ao criar adicional:", error);
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = { ...req.body };

      // Processamento de imagem se fornecida
      if (req.file) {
        try {
          const compressedImage = await sharp(req.file.buffer)
            .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          const imageUrl = await saveImageLocally(
            compressedImage,
            req.file.originalname || `additional_${Date.now()}.jpg`,
            "image/jpeg"
          );

          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro no processamento de imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const additional = await additionalService.updateAdditional(id, data);
      res.json(additional);
    } catch (error: any) {
      console.error("Erro ao atualizar adicional:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await additionalService.deleteAdditional(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar adicional:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async link(req: Request, res: Response) {
    try {
      const { id } = req.params; // additional id
      const { productId } = req.body;

      if (!productId) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const result = await additionalService.linkToProduct(id, productId);
      res.status(201).json(result);
    } catch (error: any) {
      console.error("Erro ao vincular adicional:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async unlink(req: Request, res: Response) {
    try {
      const { id } = req.params; // additional id
      const { productId } = req.body;

      if (!productId) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const result = await additionalService.unlinkFromProduct(id, productId);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao desvincular adicional:", error);
      if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }
}

export default new AdditionalController();
