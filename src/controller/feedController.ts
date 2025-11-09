import { Request, Response } from "express";
import feedService from "../services/feedService";
import { saveImageLocally } from "../config/localStorage";

class FeedController {
  // ============== FEED CONFIGURATION ENDPOINTS ==============

  async getAllConfigurations(req: Request, res: Response) {
    try {
      const configurations = await feedService.getAllFeedConfigurations();
      res.json(configurations);
    } catch (error: any) {
      console.error("Erro ao buscar configurações de feed:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getConfiguration(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const configuration = await feedService.getFeedConfigurationById(id);
      res.json(configuration);
    } catch (error: any) {
      console.error("Erro ao buscar configuração de feed:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async createConfiguration(req: Request, res: Response) {
    try {
      const data = req.body;
      const configuration = await feedService.createFeedConfiguration(data);
      res.status(201).json(configuration);
    } catch (error: any) {
      console.error("Erro ao criar configuração de feed:", error);
      if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async updateConfiguration(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const configuration = await feedService.updateFeedConfiguration(id, data);
      res.json(configuration);
    } catch (error: any) {
      console.error("Erro ao atualizar configuração de feed:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async deleteConfiguration(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await feedService.deleteFeedConfiguration(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar configuração de feed:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  // ============== FEED BANNER ENDPOINTS ==============

  async createBanner(req: Request, res: Response) {
    try {
      const data = { ...req.body };

      // Converter tipos que vêm como string do FormData
      if (typeof data.is_active === "string") {
        data.is_active = data.is_active === "true";
      }
      if (typeof data.display_order === "string") {
        data.display_order = parseInt(data.display_order, 10);
      }

      // Processar imagem se existir (mantém formato original)
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
          const origName = fileToProcess.originalname || `banner_${Date.now()}`;
          const extension = origName.substring(origName.lastIndexOf("."));
          const baseName = origName.replace(/\.[^/.]+$/, "");
          const safeBase = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
          const filename = `banner_${Date.now()}-${safeBase}${extension}`;

          const imageUrl = await saveImageLocally(
            fileToProcess.buffer,
            filename,
            fileToProcess.mimetype
          );
          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro ao processar imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const banner = await feedService.createFeedBanner(data);
      res.status(201).json(banner);
    } catch (error: any) {
      console.error("Erro ao criar banner:", error);
      if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async updateBanner(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = { ...req.body };

      if (typeof data.is_active === "string") {
        data.is_active = data.is_active === "true";
      }
      if (typeof data.display_order === "string") {
        data.display_order = parseInt(data.display_order, 10);
      }

      const file = ((): any => {
        if (req.file) return req.file;
        if (Array.isArray(req.files) && req.files.length) return req.files[0];
        if (req.files && typeof req.files === "object") {
          const vals = Object.values(req.files).flat();
          if (vals.length) return vals[0];
        }
        return null;
      })();

      if (file) {
        try {
          const origName = file.originalname || `banner_${Date.now()}`;
          const extension = origName.substring(origName.lastIndexOf("."));
          const baseName = origName.replace(/\.[^/.]+$/, "");
          const safeBase = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
          const filename = `banner_${Date.now()}-${safeBase}${extension}`;

          const imageUrl = await saveImageLocally(
            file.buffer,
            filename,
            file.mimetype
          );
          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro ao processar imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const banner = await feedService.updateFeedBanner(id, data);
      res.json(banner);
    } catch (error: any) {
      console.error("Erro ao atualizar banner:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async deleteBanner(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await feedService.deleteFeedBanner(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar banner:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async createSection(req: Request, res: Response) {
    try {
      const data = req.body;
      const section = await feedService.createFeedSection(data);
      res.status(201).json(section);
    } catch (error: any) {
      console.error("Erro ao criar seção:", error);
      if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async updateSection(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const section = await feedService.updateFeedSection(id, data);
      res.json(section);
    } catch (error: any) {
      console.error("Erro ao atualizar seção:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async deleteSection(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await feedService.deleteFeedSection(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar seção:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  // ============== FEED SECTION ITEM ENDPOINTS ==============

  async createSectionItem(req: Request, res: Response) {
    try {
      const data = req.body;
      const item = await feedService.createFeedSectionItem(data);
      res.status(201).json(item);
    } catch (error: any) {
      console.error("Erro ao criar item da seção:", error);
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("não encontrad")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async updateSectionItem(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const item = await feedService.updateFeedSectionItem(id, data);
      res.json(item);
    } catch (error: any) {
      console.error("Erro ao atualizar item da seção:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("devem ser fornecidos")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async deleteSectionItem(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await feedService.deleteFeedSectionItem(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar item da seção:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  // ============== PUBLIC FEED ENDPOINT ==============

  async getPublicFeed(req: Request, res: Response) {
    try {
      const configId = req.query.config_id as string;
      const feed = await feedService.getPublicFeed(configId);
      res.json(feed);
    } catch (error: any) {
      console.error("Erro ao buscar feed público:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  // ============== UTILITY ENDPOINTS ==============

  async getSectionTypes(req: Request, res: Response) {
    try {
      const sectionTypes = [
        {
          value: "RECOMMENDED_PRODUCTS",
          label: "Produtos Recomendados",
          description:
            "Produtos selecionados automaticamente como recomendados",
        },
        {
          value: "DISCOUNTED_PRODUCTS",
          label: "Produtos com Desconto",
          description: "Produtos que possuem desconto aplicado",
        },
        {
          value: "FEATURED_CATEGORIES",
          label: "Categorias em Destaque",
          description: "Categorias principais para navegação",
        },
        {
          value: "FEATURED_ADDITIONALS",
          label: "Adicionais em Destaque",
          description: "Adicionais populares ou promocionais",
        },
        {
          value: "CUSTOM_PRODUCTS",
          label: "Produtos Personalizados",
          description: "Produtos selecionados manualmente pelo administrador",
        },
        {
          value: "NEW_ARRIVALS",
          label: "Novos Produtos",
          description: "Produtos recém-cadastrados no sistema",
        },
        {
          value: "BEST_SELLERS",
          label: "Mais Vendidos",
          description: "Produtos com maior volume de vendas",
        },
      ];

      res.json(sectionTypes);
    } catch (error: any) {
      console.error("Erro ao buscar tipos de seção:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new FeedController();
