import { Request, Response } from "express";
import orderService from "../services/orderService";

class OrderController {
  async index(req: Request, res: Response) {
    try {
      const orders = await orderService.getAllOrders();
      res.json(orders);
    } catch (error: any) {
      console.error("Erro ao buscar pedidos:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const order = await orderService.getOrderById(id);
      res.json(order);
    } catch (error: any) {
      console.error("Erro ao buscar pedido:", error);
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
      const order = await orderService.createOrder(req.body);
      res.status(201).json(order);
    } catch (error: any) {
      console.error("Erro ao criar pedido:", error);
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("não encontrado") ||
        error.message.includes("deve ser maior")
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
      const result = await orderService.deleteOrder(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar pedido:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }
}

export default new OrderController();
