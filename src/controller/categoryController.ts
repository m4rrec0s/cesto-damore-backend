import { Request, Response } from "express";
import categoryService from "../services/categoryService";

class CategoryController {
  async index(req: Request, res: Response) {
    try {
      const categories = await categoryService.getAllCategories();
      res.json(categories);
    } catch (error: any) {
      console.error("Erro ao buscar categorias:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const category = await categoryService.getCategoryById(id);
      res.json(category);
    } catch (error: any) {
      console.error("Erro ao buscar categoria:", error);
      if (error.message.includes("não encontrada")) {
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
      const category = await categoryService.createCategory(req.body);
      res.status(201).json(category);
    } catch (error: any) {
      console.error("Erro ao criar categoria:", error);
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("Já existe")
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
      const category = await categoryService.updateCategory(id, req.body);
      res.json(category);
    } catch (error: any) {
      console.error("Erro ao atualizar categoria:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("Já existe") ||
        error.message.includes("não pode estar vazio")
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
      const result = await categoryService.deleteCategory(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar categoria:", error);
      if (error.message.includes("não encontrada")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("Não é possível deletar")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }
}

export default new CategoryController();
