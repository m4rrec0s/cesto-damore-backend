"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const ACCEPTED_CITIES = {
    "campina grande": { pix: 0, card: 10 },
    queimadas: { pix: 15, card: 25 },
    galante: { pix: 15, card: 25 },
    puxinana: { pix: 15, card: 25 },
    "sao jose da mata": { pix: 15, card: 25 },
};
function normalizeText(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}
class OrderService {
    async getAllOrders() {
        try {
            return await prisma_1.default.order.findMany({
                include: {
                    items: { include: { additionals: true, product: true } },
                    user: true,
                },
            });
        }
        catch (error) {
            throw new Error(`Erro ao buscar pedidos: ${error.message}`);
        }
    }
    async getOrderById(id) {
        if (!id) {
            throw new Error("ID do pedido é obrigatório");
        }
        try {
            const order = await prisma_1.default.order.findUnique({
                where: { id },
                include: {
                    items: { include: { additionals: true, product: true } },
                    user: true,
                },
            });
            if (!order) {
                throw new Error("Pedido não encontrado");
            }
            return order;
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                throw error;
            }
            throw new Error(`Erro ao buscar pedido: ${error.message}`);
        }
    }
    async createOrder(data) {
        if (!data.user_id || data.user_id.trim() === "") {
            throw new Error("ID do usuário é obrigatório");
        }
        if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
            throw new Error("Pelo menos um item é obrigatório");
        }
        const paymentMethod = normalizeText(data.payment_method);
        if (paymentMethod !== "pix" && paymentMethod !== "card") {
            throw new Error("Forma de pagamento inválida. Utilize pix ou card");
        }
        if (!data.delivery_city || !data.delivery_state) {
            throw new Error("Cidade e estado de entrega são obrigatórios");
        }
        const normalizedCity = normalizeText(data.delivery_city);
        const shippingRules = ACCEPTED_CITIES[normalizedCity];
        if (!shippingRules) {
            throw new Error("Ainda não fazemos entrega nesse endereço");
        }
        const normalizedState = normalizeText(data.delivery_state);
        if (normalizedState !== "pb" && normalizedState !== "paraiba") {
            throw new Error("Atualmente só entregamos na Paraíba (PB)");
        }
        for (let i = 0; i < data.items.length; i++) {
            const item = data.items[i];
            if (!item.product_id || item.product_id.trim() === "") {
                throw new Error(`Item ${i + 1}: ID do produto é obrigatório`);
            }
            if (!item.quantity || item.quantity <= 0) {
                throw new Error(`Item ${i + 1}: Quantidade deve ser maior que zero`);
            }
            if (!item.price || item.price <= 0) {
                throw new Error(`Item ${i + 1}: Preço deve ser maior que zero`);
            }
            if (Array.isArray(item.additionals)) {
                for (let j = 0; j < item.additionals.length; j++) {
                    const additional = item.additionals[j];
                    if (!additional.additional_id ||
                        additional.additional_id.trim() === "") {
                        throw new Error(`Item ${i + 1}: adicional ${j + 1} precisa de um ID válido`);
                    }
                    if (!additional.quantity || additional.quantity <= 0) {
                        throw new Error(`Item ${i + 1}: adicional ${j + 1} deve possuir quantidade maior que zero`);
                    }
                    if (additional.price === undefined || additional.price < 0) {
                        throw new Error(`Item ${i + 1}: adicional ${j + 1} deve possuir preço válido`);
                    }
                }
            }
        }
        try {
            const user = await prisma_1.default.user.findUnique({
                where: { id: data.user_id },
            });
            if (!user) {
                throw new Error("Usuário não encontrado");
            }
            const productIds = data.items.map((item) => item.product_id);
            const products = await prisma_1.default.product.findMany({
                where: { id: { in: productIds } },
            });
            if (products.length !== productIds.length) {
                throw new Error("Um ou mais produtos não foram encontrados");
            }
            const additionalsIds = data.items
                .flatMap((item) => item.additionals?.map((ad) => ad.additional_id) || [])
                .filter(Boolean);
            if (additionalsIds.length > 0) {
                const additionals = await prisma_1.default.additional.findMany({
                    where: { id: { in: additionalsIds } },
                });
                if (additionals.length !== additionalsIds.length) {
                    throw new Error("Um ou mais adicionais não foram encontrados");
                }
            }
            const itemsTotal = data.items.reduce((sum, item) => {
                const baseTotal = item.price * item.quantity;
                const additionalsTotal = (item.additionals || []).reduce((acc, additional) => acc + additional.price * additional.quantity, 0);
                return sum + baseTotal + additionalsTotal;
            }, 0);
            if (itemsTotal <= 0) {
                throw new Error("Total dos itens deve ser maior que zero");
            }
            const discount = data.discount && data.discount > 0 ? data.discount : 0;
            if (discount < 0) {
                throw new Error("Desconto não pode ser negativo");
            }
            if (discount > itemsTotal) {
                throw new Error("Desconto não pode ser maior que o total dos itens");
            }
            const shipping_price = shippingRules[paymentMethod];
            const total = parseFloat(itemsTotal.toFixed(2));
            const grand_total = parseFloat((total - discount + shipping_price).toFixed(2));
            if (grand_total <= 0) {
                throw new Error("Valor final do pedido deve ser maior que zero");
            }
            const { items, ...orderData } = data;
            const created = await prisma_1.default.order.create({
                data: {
                    user_id: orderData.user_id,
                    discount,
                    total,
                    delivery_address: orderData.delivery_address,
                    delivery_date: orderData.delivery_date,
                    shipping_price,
                    payment_method: paymentMethod,
                    grand_total,
                },
            });
            for (const item of items) {
                const orderItem = await prisma_1.default.orderItem.create({
                    data: {
                        order_id: created.id,
                        product_id: item.product_id,
                        quantity: item.quantity,
                        price: item.price,
                    },
                });
                if (Array.isArray(item.additionals) && item.additionals.length > 0) {
                    for (const additional of item.additionals) {
                        await prisma_1.default.orderItemAdditional.create({
                            data: {
                                order_item_id: orderItem.id,
                                additional_id: additional.additional_id,
                                quantity: additional.quantity,
                                price: additional.price,
                            },
                        });
                    }
                }
            }
            return await this.getOrderById(created.id);
        }
        catch (error) {
            if (error.message.includes("obrigatório") ||
                error.message.includes("não encontrado") ||
                error.message.includes("deve ser maior") ||
                error.message.includes("inválida") ||
                error.message.includes("negativo")) {
                throw error;
            }
            throw new Error(`Erro ao criar pedido: ${error.message}`);
        }
    }
    async deleteOrder(id) {
        if (!id) {
            throw new Error("ID do pedido é obrigatório");
        }
        // Verifica se o pedido existe
        await this.getOrderById(id);
        try {
            // Remove em cascata: adicionais dos itens, itens e pedido
            const items = await prisma_1.default.orderItem.findMany({
                where: { order_id: id },
            });
            for (const item of items) {
                await prisma_1.default.orderItemAdditional.deleteMany({
                    where: { order_item_id: item.id },
                });
            }
            await prisma_1.default.orderItem.deleteMany({ where: { order_id: id } });
            await prisma_1.default.order.delete({ where: { id } });
            return { message: "Pedido deletado com sucesso" };
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                throw error;
            }
            throw new Error(`Erro ao deletar pedido: ${error.message}`);
        }
    }
    // Métodos de compatibilidade com o código existente
    async list() {
        return this.getAllOrders();
    }
    async getById(id) {
        try {
            return await this.getOrderById(id);
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                return null;
            }
            throw error;
        }
    }
    async create(data) {
        return this.createOrder(data);
    }
    async remove(id) {
        return this.deleteOrder(id);
    }
}
exports.default = new OrderService();
