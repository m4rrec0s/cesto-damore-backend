import { Request, Response } from "express";
import colorService from "../services/colorService";

class ColorController {
  async index(req: Request, res: Response) {
    try {
      const colors = await colorService.getAllColors();
      res.json(colors);
    } catch (error: any) {
      console.error("Erro ao buscar cores:", error);
      res.status(500).json({
        error: "Erro ao buscar cores",
        message: error.message,
      });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const color = await colorService.getColorById(id);
      res.json(color);
    } catch (error: any) {
      console.error("Erro ao buscar cor:", error);
      const status = error.message.includes("não encontrada") ? 404 : 500;
      res.status(status).json({
        error: "Erro ao buscar cor",
        message: error.message,
      });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const color = await colorService.createColor(req.body);
      res.status(201).json(color);
    } catch (error: any) {
      console.error("Erro ao criar cor:", error);
      res.status(400).json({
        error: "Erro ao criar cor",
        message: error.message,
      });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const color = await colorService.updateColor(id, req.body);
      res.json(color);
    } catch (error: any) {
      console.error("Erro ao atualizar cor:", error);
      const status = error.message.includes("não encontrada") ? 404 : 400;
      res.status(status).json({
        error: "Erro ao atualizar cor",
        message: error.message,
      });
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await colorService.deleteColor(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar cor:", error);
      const status = error.message.includes("não encontrada") ? 404 : 500;
      res.status(status).json({
        error: "Erro ao deletar cor",
        message: error.message,
      });
    }
  }
}

export default new ColorController();
