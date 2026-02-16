import { Request, Response } from "express";
import productComponentService from "../services/productComponentService";

class ProductComponentController {
  

  async addComponent(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const { item_id, quantity } = req.body;

      if (!item_id) {
        return res.status(400).json({ error: "Item ID é obrigatório" });
      }

      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          error: "Quantidade é obrigatória e deve ser maior que zero",
        });
      }

      const component = await productComponentService.addComponent({
        product_id: productId,
        item_id,
        quantity,
      });

      const newStock = await productComponentService.updateProductStock(
        productId
      );

      res.status(201).json({
        component,
        product_stock: newStock,
      });
    } catch (error: any) {
      console.error("Erro ao adicionar componente:", error);
      if (
        error.message.includes("não encontrado") ||
        error.message.includes("já foi adicionado")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao adicionar componente",
          details: error.message,
        });
      }
    }
  }

  

  async updateComponent(req: Request, res: Response) {
    try {
      const { componentId } = req.params;
      const { quantity } = req.body;

      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          error: "Quantidade é obrigatória e deve ser maior que zero",
        });
      }

      const component = await productComponentService.updateComponent(
        componentId,
        { quantity }
      );

      const newStock = await productComponentService.updateProductStock(
        component.product_id
      );

      res.json({
        component,
        product_stock: newStock,
      });
    } catch (error: any) {
      console.error("Erro ao atualizar componente:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao atualizar componente",
          details: error.message,
        });
      }
    }
  }

  

  async removeComponent(req: Request, res: Response) {
    try {
      const { componentId } = req.params;

      const component = await productComponentService.removeComponent(
        componentId
      );

      const newStock = await productComponentService.updateProductStock(
        component.product_id
      );

      res.json({
        message: "Componente removido com sucesso",
        product_stock: newStock,
      });
    } catch (error: any) {
      console.error("Erro ao remover componente:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao remover componente",
          details: error.message,
        });
      }
    }
  }

  

  async getProductComponents(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      const components = await productComponentService.getProductComponents(
        productId
      );

      res.json({
        product_id: productId,
        components,
        total_components: components.length,
      });
    } catch (error: any) {
      console.error("Erro ao buscar componentes:", error);
      res.status(500).json({
        error: "Erro ao buscar componentes",
        details: error.message,
      });
    }
  }

  

  async calculateProductStock(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      const availableStock =
        await productComponentService.calculateProductStock(productId);

      res.json({
        product_id: productId,
        available_stock: availableStock,
      });
    } catch (error: any) {
      console.error("Erro ao calcular estoque:", error);
      res.status(500).json({
        error: "Erro ao calcular estoque",
        details: error.message,
      });
    }
  }

  

  async validateComponentsStock(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const { quantity } = req.body;

      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          error: "Quantidade é obrigatória e deve ser maior que zero",
        });
      }

      const validation = await productComponentService.validateComponentsStock(
        productId,
        quantity
      );

      if (validation.valid) {
        res.json({
          valid: true,
          message: "Estoque suficiente para os componentes",
        });
      } else {
        res.status(400).json({
          valid: false,
          errors: validation.errors,
        });
      }
    } catch (error: any) {
      console.error("Erro ao validar estoque:", error);
      res.status(500).json({
        error: "Erro ao validar estoque",
        details: error.message,
      });
    }
  }

  

  async getProductsUsingItem(req: Request, res: Response) {
    try {
      const { itemId } = req.params;

      const products = await productComponentService.getProductsUsingItem(
        itemId
      );

      res.json({
        item_id: itemId,
        products,
        total_products: products.length,
      });
    } catch (error: any) {
      console.error("Erro ao buscar produtos:", error);
      res.status(500).json({
        error: "Erro ao buscar produtos",
        details: error.message,
      });
    }
  }
}

export default new ProductComponentController();
