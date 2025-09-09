import { Request, Response } from "express";
import typeService from "../services/typeService";

class TypeController {
  async index(req: Request, res: Response) {
    try {
      const types = await typeService.getAllTypes();
      res.json(types);
    } catch (error: any) {
      console.error("Erro ao buscar tipos:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const type = await typeService.getTypeById(id);
      res.json(type);
    } catch (error: any) {
      console.error("Erro ao buscar tipo:", error);
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
      const type = await typeService.createType(req.body);
      res.status(201).json(type);
    } catch (error: any) {
      console.error("Erro ao criar tipo:", error);
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
      const type = await typeService.updateType(id, req.body);
      res.json(type);
    } catch (error: any) {
      console.error("Erro ao atualizar tipo:", error);
      if (error.message.includes("não encontrado")) {
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
      const result = await typeService.deleteType(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar tipo:", error);
      if (error.message.includes("não encontrado")) {
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

export default new TypeController();
