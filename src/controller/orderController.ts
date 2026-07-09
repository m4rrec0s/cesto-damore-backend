import { Request, Response } from "express";
import orderService from "../services/orderService";
import metaConversionsService from "../services/metaConversionsService";
import logger from "../utils/logger";

class OrderController {
  constructor() {
    this.index = this.index.bind(this);
    this.show = this.show.bind(this);
    this.getByUserId = this.getByUserId.bind(this);
    this.getPendingOrderByUserId = this.getPendingOrderByUserId.bind(this);
    this.create = this.create.bind(this);
    this.remove = this.remove.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.updateMetadata = this.updateMetadata.bind(this);
    this.updateItems = this.updateItems.bind(this);
    this.getPendingOrder = this.getPendingOrder.bind(this);
    this.cancelOrder = this.cancelOrder.bind(this);
    this.removeAllCanceledOrders = this.removeAllCanceledOrders.bind(this);
    this.manualStockDecrement = this.manualStockDecrement.bind(this);
  }

  private isAdmin(req: Request) {
    return String((req as any).user?.role || "").toUpperCase() === "ADMIN";
  }

  private canAccessOrder(req: Request, orderUserId: string) {
    const currentUserId = (req as any).user?.id;
    return this.isAdmin(req) || currentUserId === orderUserId;
  }

  async index(req: Request, res: Response) {
    try {
      const { status, page = "1", limit = "8", summary, includeNonCustomer } = req.query;
      const pageNum = Math.max(1, parseInt(String(page), 10));
      const limitNum = Math.max(1, Math.min(100, parseInt(String(limit), 10)));
      const summaryMode =
        String(summary).toLowerCase() === "true" || String(summary) === "1";
      const currentUserId = (req as any).user?.id;
      const isAdmin = this.isAdmin(req);

      if (!currentUserId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      if (isAdmin) {
        const orders = await orderService.getAllOrders(
          status ? { status: String(status) } : undefined,
          { page: pageNum, limit: limitNum },
          {
            summary: summaryMode,
            includeNonCustomer:
              String(includeNonCustomer).toLowerCase() === "true",
          },
        );
        return res.json(orders);
      }

      const orders = await orderService.getOrdersByUserId(currentUserId);
      const filteredOrders = status
        ? orders.filter((order: any) => {
            const normalized = String(status).trim().toLowerCase();
            if (normalized === "open" || normalized === "abertos") {
              return ["PENDING", "PAID", "PAID_STOCK_FAILED", "SHIPPED"].includes(order.status);
            }
            if (normalized === "closed" || normalized === "fechados") {
              return ["DELIVERED", "CANCELED"].includes(order.status);
            }
            return String(order.status).toLowerCase() === normalized;
          })
        : orders;

      const total = filteredOrders.length;
      const totalPages = Math.ceil(total / limitNum);
      const start = (pageNum - 1) * limitNum;
      const data = filteredOrders.slice(start, start + limitNum);

      return res.json({
        data: summaryMode
          ? data.map((order: any) => ({
              id: order.id,
              status: order.status,
              total: order.total,
              grand_total: order.grand_total,
              created_at: order.created_at,
              recipient_phone: order.recipient_phone,
              user: {
                id: order.user?.id,
                name: order.user?.name,
                phone: order.user?.phone,
              },
              items_count: Array.isArray(order.items) ? order.items.length : 0,
            }))
          : data,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      });
    } catch (error: any) {
      logger.error("Erro ao buscar pedidos:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      const order = await orderService.getOrderById(id);
      if (!this.canAccessOrder(req, order.user_id)) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para acessar este pedido" });
      }

      res.json(order);
    } catch (error: any) {
      logger.error("Erro ao buscar pedido:", error);
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
      const currentUserId = (req as any).user?.id;
      if (!currentUserId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      if (!userId) {
        return res.status(400).json({ error: "ID do usuário é obrigatório" });
      }

      if (!(this.isAdmin(req) || currentUserId === userId)) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para acessar estes pedidos" });
      }

      const orders = await orderService.getOrdersByUserId(userId);
      res.status(200).json(orders);
    } catch (error: any) {
      logger.error("Erro ao buscar pedidos do usuário:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getPendingOrderByUserId(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const currentUserId = (req as any).user?.id;
      if (!currentUserId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      if (!userId) {
        return res.status(400).json({ error: "ID do usuário é obrigatório" });
      }

      if (!(this.isAdmin(req) || currentUserId === userId)) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para acessar este pedido" });
      }

      const pendingOrder = await orderService.getPendingOrderByUserId(userId);

      if (!pendingOrder) {
        return res
          .status(404)
          .json({ error: "Nenhum pedido pendente encontrado" });
      }

      res.status(200).json(pendingOrder);
    } catch (error: any) {
      logger.error("Erro ao buscar pedido pendente:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const currentUserId = (req as any).user?.id;
      if (!currentUserId) {
        return res.status(401).json({
          error: "Autenticação necessária para criar pedidos",
        });
      }

      if (req.body?.user_id && req.body.user_id !== currentUserId) {
        return res.status(403).json({
          error: "Você não tem permissão para criar pedidos para outro usuário",
        });
      }

      const orderPayload = {
        ...req.body,
        user_id: currentUserId,
      };

      console.log("📝 Criando pedido - resumo:", {
        user_id: orderPayload.user_id,
        itemsCount: Array.isArray(orderPayload.items)
          ? orderPayload.items.length
          : 0,
        total: orderPayload.total ?? null,
        delivery_city: orderPayload.delivery_city ?? null,
      });
      const order = await orderService.createOrder(orderPayload);

      console.log("✅ Pedido criado com sucesso:", order.id);

      // Meta Conversions API - InitiateCheckout event (non-blocking)
      const orderItems = Array.isArray(orderPayload.items) ? orderPayload.items : [];
      const checkoutTotal = orderPayload.total || orderPayload.grand_total || 0;
      metaConversionsService.sendInitiateCheckoutEvent({
        email: (req as any).user?.email,
        phone: (req as any).user?.phone,
        userId: currentUserId,
        orderId: order.id,
        value: Number(checkoutTotal),
        numItems: orderItems.length,
      }).catch((err: any) => {
        // silently fail
      });

      res.status(201).json(order);
    } catch (error: any) {
      logger.error("❌ Erro ao criar pedido:", error);
      logger.error("Stack trace:", error);

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

      if ((error as any).code === "MISSING_PRODUCTS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_PRODUCTS",
        });
      }
      if ((error as any).code === "INVALID_CUSTOMIZATIONS") {
        return res.status(400).json({
          error: error.message,
          errors: (error as any).errors || [],
          code: "INVALID_CUSTOMIZATIONS",
        });
      }
      if ((error as any).code === "MISSING_ADDITIONALS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_ADDITIONALS",
        });
      }

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
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const isAdmin = userRole?.toUpperCase() === "ADMIN";

      if (!userId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      const order = await orderService.getOrderById(id);

      if (!isAdmin) {
        if (order.user_id !== userId) {
          logger.warn(
            `⚠️ [remove] Acesso negado: usuário ${userId} tentou deletar pedido de outro usuário ${order.user_id}`,
          );
          return res.status(403).json({
            error: "Você não tem permissão para deletar este pedido",
          });
        }

        if (order.status !== "PENDING") {
          return res.status(400).json({
            error: `Apenas pedidos pendentes podem ser deletados por usuários. Status atual: ${order.status}`,
          });
        }
      }

      const result = await orderService.deleteOrder(id);
      console.log(
        `✅ [remove] Pedido ${id} deletado com sucesso por usuário ${userId}`,
      );
      res.json(result);
    } catch (error: any) {
      logger.error("Erro ao deletar pedido:", error);
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
      logger.error("Erro ao atualizar status do pedido:", error);

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
        shipping_price,
        payment_method,
        discount,
        delivery_method,
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: "ID do pedido é obrigatório" });
      }

      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      const existingOrder = await orderService.getOrderById(id);
      if (!this.canAccessOrder(req, existingOrder.user_id)) {
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
        shipping_price,
        payment_method,
        discount,
        delivery_method,
      });
      res.json(updated);
    } catch (error: any) {
      logger.error("Erro ao atualizar metadata do pedido:", error);
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

      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      const existingOrder = await orderService.getOrderById(id);

      console.log("🔍 [updateItems] Verificação de permissão:", {
        userId,
        orderUserId: existingOrder.user_id,
        orderId: id,
        hasUser: !!(req as any).user,
      });

      if (!this.canAccessOrder(req, existingOrder.user_id)) {
        logger.warn(
          "⚠️ [updateItems] Acesso negado: usuário não é dono do pedido",
        );
        return res
          .status(403)
          .json({ error: "Você não tem permissão para modificar este pedido" });
      }

      const updated = await orderService.updateOrderItems(id, items);

      // Meta Conversions API - AddToCart event (non-blocking)
      if (items && Array.isArray(items)) {
        const user = (req as any).user;
        for (const item of items) {
          metaConversionsService.sendAddToCartEvent({
            email: user?.email,
            phone: user?.phone,
            userId: userId,
            orderId: id,
            productId: item.product_id || item.id,
            productName: item.name,
            value: Number(item.price || 0),
            quantity: item.quantity || 1,
          }).catch((err: any) => {
            // silently fail
          });
        }
      }

      res.json(updated);
    } catch (error: any) {
      logger.error("Erro ao atualizar itens do pedido:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes("não encontrado")) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes("pendentes")) {
        return res.status(403).json({ error: error.message });
      }

      if ((error as any).code === "MISSING_PRODUCTS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_PRODUCTS",
        });
      }
      if ((error as any).code === "INVALID_CUSTOMIZATIONS") {
        return res.status(400).json({
          error: error.message,
          errors: (error as any).errors || [],
          code: "INVALID_CUSTOMIZATIONS",
        });
      }
      if ((error as any).code === "MISSING_ADDITIONALS") {
        return res.status(404).json({
          error: error.message,
          missing: (error as any).missing || [],
          code: "MISSING_ADDITIONALS",
        });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getPendingOrder(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      if (!id) {
        return res.status(400).json({ error: "ID do usuário é obrigatório" });
      }

      if (!userId) {
        return res.status(401).json({ error: "Autenticação necessária" });
      }

      if (!(this.isAdmin(req) || userId === id)) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para acessar este pedido" });
      }

      const pendingOrder = await orderService.getPendingOrder(id);

      if (!pendingOrder) {
        return res.status(200).send();
      }

      res.status(200).json(pendingOrder);
    } catch (error: any) {
      logger.error("Erro ao buscar pedido pendente:", error);

      if (error.message.includes("obrigatório")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async cancelOrder(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

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
      logger.error("Erro ao cancelar pedido:", error);

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

  async removeAllCanceledOrders(req: Request, res: Response) {
    try {
      const result = await orderService.deleteAllCanceledOrders();
      res.json(result);
    } catch (error: any) {
      logger.error("Erro ao deletar pedidos cancelados:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async manualStockDecrement(req: Request, res: Response) {
    try {
      const { orderId, orderItemId } = req.params;

      if (!orderId || !orderItemId) {
        return res.status(400).json({ error: "IDs são obrigatórios" });
      }

      const result = await orderService.retryItemStockDecrement(orderId, orderItemId);
      
      res.json({
        success: true,
        message: "Estoque decrementado com sucesso",
        data: result,
      });
    } catch (error: any) {
      logger.error("Erro ao decrementar estoque manualmente:", error);

      if (error.message.includes("não encontrado")) {
        return res.status(404).json({ error: error.message });
      }

      if (error.message.includes("Estoque insuficiente")) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: error.message || "Erro interno do servidor" });
    }
  }
}

export default new OrderController();
