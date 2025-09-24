import { Request, Response } from "express";
import sharp from "sharp";
import productService from "../services/productService";
import { saveImageLocally } from "../config/localStorage";

class ProductController {
  async index(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const perPage = parseInt(req.query.per_page as string) || 15;
      const sort = (req.query.sort as string) || "name";
      const search = req.query.search as string;
      const category_id = req.query.category_id as string;
      const type_id = req.query.type_id as string;

      const result = await productService.getAllProducts({
        page,
        perPage,
        sort,
        search,
        category_id,
        type_id,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao buscar produtos:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const product = await productService.getProductById(id);
      res.json(product);
    } catch (error: any) {
      console.error("Erro ao buscar produto:", error);
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
            fileToProcess.originalname || `product_${Date.now()}.webp`,
            fileToProcess.mimetype || "image/webp"
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

      const product = await productService.createProduct(data);
      res.status(201).json(product);
    } catch (error: any) {
      console.error("Erro ao criar produto:", error);
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

      const file = ((): any => {
        if (req.file) return req.file;
        if (Array.isArray(req.files) && req.files.length) return req.files[0];
        if (req.files && typeof req.files === "object") {
          const vals = Object.values(req.files).flat();
          if (vals.length) return vals[0];
        }
        return null;
      })();

      // Processamento de imagem se fornecida
      if (file) {
        try {
          const compressedImage = await sharp(file.buffer)
            .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

          const imageUrl = await saveImageLocally(
            compressedImage,
            file.originalname || `product_${Date.now()}.webp`,
            "image/webp"
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

      const product = await productService.updateProduct(id, data);
      res.json(product);
    } catch (error: any) {
      console.error("Erro ao atualizar produto:", error);
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
      const result = await productService.deleteProduct(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar produto:", error);
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
      const { id } = req.params;
      const { additionalId } = req.body;

      if (!additionalId) {
        return res.status(400).json({ error: "ID do adicional é obrigatório" });
      }

      const result = await productService.linkAdditional(id, additionalId);
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
      const { id } = req.params;
      const { additionalId } = req.body;

      if (!additionalId) {
        return res.status(400).json({ error: "ID do adicional é obrigatório" });
      }

      const result = await productService.unlinkAdditional(id, additionalId);
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

export default new ProductController();
