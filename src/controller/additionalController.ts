import { Request, Response } from "express";
import additionalService from "../services/additionalService";
import sharp from "sharp";
import { saveImageLocally } from "../config/localStorage";

class AdditionalController {
  async index(req: Request, res: Response) {
    try {
      const includeProducts = req.query.include_products === "true";
      const additionals = await additionalService.getAllAdditionals(
        includeProducts
      );
      res.json(additionals);
    } catch (error: any) {
      console.error("Erro ao buscar adicionais:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const includeProducts = req.query.include_products === "true";
      const additional = await additionalService.getAdditionalById(
        id,
        includeProducts
      );
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

      // Processar imagem se existir
      let fileToProcess = null;

      if (req.file) {
        fileToProcess = req.file;
      } else if (req.files) {
        if (Array.isArray(req.files) && req.files.length > 0) {
          fileToProcess = req.files[0];
        } else if (typeof req.files === "object") {
          const fileKeys = Object.keys(req.files);
          if (fileKeys.length > 0) {
            const files = (req.files as any)[fileKeys[0]];
            if (Array.isArray(files) && files.length > 0) {
              fileToProcess = files[0];
            }
          }
        }
      }

      if (fileToProcess) {
        try {
          const imageUrl = await saveImageLocally(
            fileToProcess.buffer,
            fileToProcess.originalname || `additional_${Date.now()}.webp`,
            fileToProcess.mimetype
          );
          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro ao salvar imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      // Notas: suporte a cores removido — campos relacionados serão ignorados

      // Converter campos numéricos de string para número se necessário
      if (data.price && typeof data.price === "string") {
        data.price = parseFloat(data.price);
      }

      if (data.discount !== undefined && typeof data.discount === "string") {
        data.discount = data.discount === "" ? 0 : parseFloat(data.discount);
      }

      if (data.stock_quantity && typeof data.stock_quantity === "string") {
        data.stock_quantity = parseInt(data.stock_quantity, 10);
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

      if (req.file) {
        try {
          const imageUrl = await saveImageLocally(
            req.file.buffer,
            req.file.originalname || `additional_${Date.now()}.webp`,
            req.file.mimetype
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

      // Notas: suporte a cores removido — campos relacionados serão ignorados

      // Converter campos numéricos de string para número se necessário
      if (data.price && typeof data.price === "string") {
        data.price = parseFloat(data.price);
      }

      if (data.discount !== undefined && typeof data.discount === "string") {
        data.discount = data.discount === "" ? 0 : parseFloat(data.discount);
      }

      if (data.stock_quantity && typeof data.stock_quantity === "string") {
        data.stock_quantity = parseInt(data.stock_quantity, 10);
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
      const { productId, customPrice } = req.body;

      if (!productId) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const result = await additionalService.linkToProduct(
        id,
        productId,
        customPrice
      );
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

  async updateLink(req: Request, res: Response) {
    try {
      const { id } = req.params; // additional id
      const { productId, customPrice } = req.body;

      if (!productId) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const result = await additionalService.updateProductLink(
        id,
        productId,
        customPrice
      );
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao atualizar vínculo do adicional:", error);
      if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async getPrice(req: Request, res: Response) {
    try {
      const { id } = req.params; // additional id
      const { productId } = req.query;

      const price = await additionalService.getAdditionalPrice(
        id,
        productId as string
      );
      res.json({ price });
    } catch (error: any) {
      console.error("Erro ao buscar preço do adicional:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async getByProduct(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const additionals = await additionalService.getAdditionalsByProduct(
        productId
      );
      res.json(additionals);
    } catch (error: any) {
      console.error("Erro ao buscar adicionais do produto:", error);
      if (error.message.includes("obrigatório")) {
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
      } else if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }
}

export default new AdditionalController();
