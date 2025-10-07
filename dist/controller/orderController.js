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
    async create(req, res) {
        try {
            const order = await orderService_1.default.createOrder(req.body);
            res.status(201).json(order);
        }
        catch (error) {
            console.error("Erro ao criar pedido:", error);
            if (error.message.includes("obrigatório") ||
                error.message.includes("não encontrado") ||
                error.message.includes("deve ser maior")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
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
            if (error.message.includes("Pedido não encontrado")) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
}
exports.default = new OrderController();
