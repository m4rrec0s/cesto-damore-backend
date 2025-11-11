"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const orderService_1 = __importDefault(require("../services/orderService"));
class OrderController {
    async index(req, res) {
        try {
            const { status } = req.query;
            const orders = await orderService_1.default.getAllOrders(status ? { status: String(status) } : undefined);
            res.json(orders);
        }
        catch (error) {
            console.error("Erro ao buscar pedidos:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const order = await orderService_1.default.getOrderById(id);
            res.json(order);
        }
        catch (error) {
            console.error("Erro ao buscar pedido:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async getByUserId(req, res) {
        try {
            const { userId } = req.params;
            if (!userId) {
                return res.status(400).json({ error: "ID do usuário é obrigatório" });
            }
            const orders = await orderService_1.default.getOrdersByUserId(userId);
            res.status(200).json(orders);
        }
        catch (error) {
            console.error("Erro ao buscar pedidos do usuário:", error);
            if (error.message.includes("obrigatório")) {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async create(req, res) {
        try {
            const order = await orderService_1.default.createOrder(req.body);
            res.status(201).json(order);
        }
        catch (error) {
            console.error("Erro ao criar pedido:", error);
            // Erros de validação (400)
            if (error.message.includes("obrigatório") ||
                error.message.includes("não encontrado") ||
                error.message.includes("deve ser maior") ||
                error.message.includes("Estoque insuficiente") // ✅ NOVO: Erro de estoque também retorna 400
            ) {
                return res.status(400).json({
                    error: error.message,
                    code: error.message.includes("Estoque insuficiente")
                        ? "INSUFFICIENT_STOCK"
                        : "VALIDATION_ERROR",
                });
            }
            // Erro genérico (500)
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async remove(req, res) {
        try {
            const { id } = req.params;
            const result = await orderService_1.default.deleteOrder(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar pedido:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async updateStatus(req, res) {
        try {
            const { id } = req.params;
            const { status, notifyCustomer = true } = req.body;
            if (!status) {
                return res
                    .status(400)
                    .json({ error: "Status do pedido é obrigatório" });
            }
            const updated = await orderService_1.default.updateOrderStatus(id, status, {
                notifyCustomer,
            });
            res.json(updated);
        }
        catch (error) {
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
    async getPendingOrder(req, res) {
        try {
            const { userId } = req.params;
            if (!userId) {
                return res.status(400).json({ error: "ID do usuário é obrigatório" });
            }
            const pendingOrder = await orderService_1.default.getPendingOrder(userId);
            if (!pendingOrder) {
                return res
                    .status(404)
                    .json({ error: "Nenhum pedido pendente encontrado" });
            }
            res.status(200).json(pendingOrder);
        }
        catch (error) {
            console.error("Erro ao buscar pedido pendente:", error);
            if (error.message.includes("obrigatório")) {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async cancelOrder(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user?.id; // Do middleware de autenticação
            if (!id) {
                return res.status(400).json({ error: "ID do pedido é obrigatório" });
            }
            const canceledOrder = await orderService_1.default.cancelOrder(id, userId);
            res.status(200).json({
                success: true,
                message: "Pedido cancelado com sucesso",
                order: canceledOrder,
            });
        }
        catch (error) {
            console.error("Erro ao cancelar pedido:", error);
            if (error.message.includes("não encontrado")) {
                return res.status(404).json({ error: error.message });
            }
            if (error.message.includes("não tem permissão") ||
                error.message.includes("Apenas pedidos")) {
                return res.status(403).json({ error: error.message });
            }
            if (error.message.includes("obrigatório")) {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
}
exports.default = new OrderController();
