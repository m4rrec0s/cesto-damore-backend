import { Request, Response } from "express";
import aiProductService from "../services/aiProductService";

class AIProductController {
  

  async getLightweightProducts(req: Request, res: Response) {
    try {
      const result = await aiProductService.getLightweightProducts(req.query);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao buscar produtos leves:", error);
      res.status(500).json({
        error: "Erro ao buscar produtos",
        message: error.message,
      });
    }
  }

  

  async getProductDetail(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await aiProductService.getProductDetail(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao buscar detalhe do produto:", error);
      res.status(500).json({
        error: "Erro ao buscar detalhe do produto",
        message: error.message,
      });
    }
  }

  

  async searchProducts(req: Request, res: Response) {
    try {
      const result = await aiProductService.searchProducts(req.query);
      res.json(result);
    } catch (error: any) {
      console.error("Erro na consulta AI de produtos:", error);
      res.status(500).json({
        success: false,
        error: "Erro ao processar consulta de produtos",
        message: error.message,
      });
    }
  }

  

  async getEndpointInfo(req: Request, res: Response) {
    res.json({
      endpoints: {
        light: {
          url: "/ai/products/light",
          description: "Lista leve de todos os produtos (<1KB/item)",
        },
        detail: {
          url: "/ai/products/detail/:id",
          description: "Detalhes completos do produto com componentes e adicionais",
        },
        search: {
          url: "/ai/products/search",
          description: "Busca otimizada para tool-calling",
          params: [
            "keywords",
            "occasion",
            "price_max",
            "tag",
            "available",
            "has_custom_photo",
          ],
        },
      },
    });
  }
}

export default new AIProductController();
