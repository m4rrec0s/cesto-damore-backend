import { Request, Response } from "express";
import orderService from "../services/orderService";

class OrderController {
  async index(req: Request, res: Response) {
    try {
      const { status } = req.query;
      const orders = await orderService.getAllOrders(
        status ? { status: String(status) } : undefined
      );
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

  async getByUserId(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({ error: "ID do usuário é obrigatório" });
      }

      const orders = await orderService.getOrdersByUserId(userId);
      res.status(200).json(orders);
    } catch (error: any) {
      console.error("Erro ao buscar pedidos do usuário:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      // Log sucinto: evitar imprimir payloads grandes (base64, imagens)
      console.log("📝 Criando pedido - resumo:", {
        user_id: req.body?.user_id,
        itemsCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
        total: req.body?.total ?? null,
        delivery_city: req.body?.delivery_city ?? null,
      });
      const order = await orderService.createOrder(req.body);
      // Log curto para indicar sucesso (apenas ID)
      console.log("✅ Pedido criado com sucesso:", order.id);
      res.status(201).json(order);
    } catch (error: any) {
      console.error("❌ Erro ao criar pedido:", error);
      console.error("Stack trace:", error.stack);

      // Erros de validação (400)
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("não encontrado") ||
        error.message.includes("deve ser maior") ||
        error.message.includes("Estoque insuficiente") ||
        error.message.includes("inválida") ||
        error.message.includes("não pode ser") ||
        error.message.includes("não fazemos entrega") ||
        error.message.includes("só entregamos")
      ) {
        return res.status(400).json({
          error: error.message,
          code: error.message.includes("Estoque insuficiente")
            ? "INSUFFICIENT_STOCK"
            : "VALIDATION_ERROR",
        });
      }

      // Erro específico: produtos faltando (informar ids)
      if ((error as any).code === "MISSING_PRODUCTS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_PRODUCTS",
        });
      }
      if ((error as any).code === "MISSING_ADDITIONALS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_ADDITIONALS",
        });
      }
      if ((error as any).code === "MISSING_ADDITIONALS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_ADDITIONALS",
        });
      }

      // Erro genérico (500)
      res.status(500).json({
        error: "Erro interno do servidor",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
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

  async updateStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status, notifyCustomer = true } = req.body;

      if (!status) {
        return res
          .status(400)
          .json({ error: "Status do pedido é obrigatório" });
      }

      const updated = await orderService.updateOrderStatus(id, status, {
        notifyCustomer,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Erro ao atualizar status do pedido:", error);

      if (error.message.includes("Status inválido")) {
        return res.status(400).json({ error: error.message });
      }

      if (error.message.includes("Status inválido")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async updateMetadata(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const {
        send_anonymously,
        complement,
        delivery_address,
        delivery_city,
        delivery_state,
        recipient_phone,
        delivery_date,
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: "ID do pedido é obrigatório" });
      }

      // Ownership: only order owner can update metadata
      const userId = (req as any).user?.id;
      const existingOrder = await orderService.getOrderById(id);
      if (userId && existingOrder.user_id !== userId) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para modificar este pedido" });
      }

      const updated = await orderService.updateOrderMetadata(id, {
        send_anonymously,
        complement,
        delivery_address,
        delivery_city,
        delivery_state,
        recipient_phone,
        delivery_date,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Erro ao atualizar metadata do pedido:", error);
      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes("não encontrado")) {
        return res.status(404).json({ error: error.message });
      }
      if ((error as any).code === "MISSING_PRODUCTS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_PRODUCTS",
        });
      }
      if (error.message.includes("pendentes")) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async updateItems(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { items } = req.body;

      if (!id) {
        return res.status(400).json({ error: "ID do pedido é obrigatório" });
      }

      // Verificar se o usuário autenticado é dono do pedido
      const userId = (req as any).user?.id;
      const existingOrder = await orderService.getOrderById(id);
      if (userId && existingOrder.user_id !== userId) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para modificar este pedido" });
      }

      const updated = await orderService.updateOrderItems(id, items);
      res.json(updated);
    } catch (error: any) {
      console.error("Erro ao atualizar itens do pedido:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes("não encontrado")) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes("pendentes")) {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getPendingOrder(req: Request, res: Response) {
    try {
      // ✅ Corrigido: usar req.params.id ao invés de req.params.userId
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: "ID do usuário é obrigatório" });
      }

      const pendingOrder = await orderService.getPendingOrder(id);

      if (!pendingOrder) {
        return res
          .status(404)
          .json({ error: "Nenhum pedido pendente encontrado" });
      }

      res.status(200).json(pendingOrder);
    } catch (error: any) {
      console.error("Erro ao buscar pedido pendente:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async cancelOrder(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id; // Do middleware de autenticação

      if (!id) {
        return res.status(400).json({ error: "ID do pedido é obrigatório" });
      }

      const canceledOrder = await orderService.cancelOrder(id, userId);

      res.status(200).json({
        success: true,
        message: "Pedido cancelado com sucesso",
        order: canceledOrder,
      });
    } catch (error: any) {
      console.error("Erro ao cancelar pedido:", error);

      if (error.message.includes("não encontrado")) {
        return res.status(404).json({ error: error.message });
      }

      if (
        error.message.includes("não tem permissão") ||
        error.message.includes("Apenas pedidos")
      ) {
        return res.status(403).json({ error: error.message });
      }

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new OrderController();
