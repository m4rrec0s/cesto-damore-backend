import { Request, Response } from "express";
import itemService from "../services/itemService";

class ItemController {
  async index(req: Request, res: Response) {
    try {
      const items = await itemService.listItems();
      res.json(items);
    } catch (error: any) {
      console.error("Erro ao buscar items:", error);
      res.status(500).json({
        error: "Erro ao buscar items",
        details: error.message,
      });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const item = await itemService.getItemById(id);
      res.json(item);
    } catch (error: any) {
      console.error("Erro ao buscar item:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao buscar item",
          details: error.message,
        });
      }
    }
  }

  async create(req: Request, res: Response) {
    try {
      // Processar dados do FormData
      const data = {
        name: req.body.name,
        description: req.body.description || undefined,
        stock_quantity: parseInt(req.body.stock_quantity) || 0,
        base_price: parseFloat(req.body.base_price) || 0,
        allows_customization: req.body.allows_customization === "true",
        additional_id:
          req.body.additional_id && req.body.additional_id !== ""
            ? req.body.additional_id
            : undefined,
        image_url: req.file ? `/images/${req.file.filename}` : undefined,
      };

      const item = await itemService.createItem(data);
      res.status(201).json(item);
    } catch (error: any) {
      console.error("Erro ao criar item:", error);
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao criar item",
          details: error.message,
        });
      }
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Processar dados do FormData
      const data: any = {};

      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.description !== undefined)
        data.description = req.body.description || undefined;
      if (req.body.stock_quantity !== undefined)
        data.stock_quantity = parseInt(req.body.stock_quantity);
      if (req.body.base_price !== undefined)
        data.base_price = parseFloat(req.body.base_price);
      if (req.body.allows_customization !== undefined)
        data.allows_customization = req.body.allows_customization === "true";
      if (req.body.additional_id !== undefined)
        data.additional_id =
          req.body.additional_id && req.body.additional_id !== ""
            ? req.body.additional_id
            : null;
      if (req.file) data.image_url = `/images/${req.file.filename}`;

      const item = await itemService.updateItem(id, data);
      res.json(item);
    } catch (error: any) {
      console.error("Erro ao atualizar item:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao atualizar item",
          details: error.message,
        });
      }
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await itemService.deleteItem(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Erro ao deletar item:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("usado")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao deletar item",
          details: error.message,
        });
      }
    }
  }

  async getAvailable(req: Request, res: Response) {
    try {
      const items = await itemService.getAvailableItems();
      res.json(items);
    } catch (error: any) {
      console.error("Erro ao buscar items disponíveis:", error);
      res.status(500).json({
        error: "Erro ao buscar items disponíveis",
        details: error.message,
      });
    }
  }

  async getWithCustomizations(req: Request, res: Response) {
    try {
      const items = await itemService.getItemsWithCustomizations();
      res.json(items);
    } catch (error: any) {
      console.error("Erro ao buscar items com customizações:", error);
      res.status(500).json({
        error: "Erro ao buscar items com customizações",
        details: error.message,
      });
    }
  }

  async updateStock(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { quantity } = req.body;

      if (quantity === undefined || quantity === null) {
        return res.status(400).json({ error: "Quantidade é obrigatória" });
      }

      const item = await itemService.updateStock(id, quantity);
      res.json(item);
    } catch (error: any) {
      console.error("Erro ao atualizar estoque:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("inválid")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({
          error: "Erro ao atualizar estoque",
          details: error.message,
        });
      }
    }
  }
}

export default new ItemController();
