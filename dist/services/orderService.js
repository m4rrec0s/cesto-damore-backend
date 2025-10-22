"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const stockService_1 = __importDefault(require("./stockService"));
const whatsappService_1 = __importDefault(require("./whatsappService"));
const productComponentService_1 = __importDefault(require("./productComponentService"));
const ORDER_STATUSES = [
    "PENDING",
    "PAID",
    "SHIPPED",
    "DELIVERED",
    "CANCELED",
];
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
    normalizeStatus(status) {
        const normalized = status?.trim().toUpperCase();
        if (!ORDER_STATUSES.includes(normalized)) {
            throw new Error(`Status inválido. Utilize um dos seguintes: ${ORDER_STATUSES.join(", ")}`);
        }
        return normalized;
    }
    buildStatusWhere(filter) {
        if (!filter?.status)
            return undefined;
        const normalized = filter.status.trim().toLowerCase();
        if (normalized === "open" || normalized === "abertos") {
            return {
                in: ["PENDING", "PAID", "SHIPPED"],
            };
        }
        if (normalized === "closed" || normalized === "fechados") {
            return {
                in: ["DELIVERED", "CANCELED"],
            };
        }
        return {
            equals: this.normalizeStatus(filter.status),
        };
    }
    async getAllOrders(filter) {
        try {
            return await prisma_1.default.order.findMany({
                include: {
                    items: {
                        include: {
                            additionals: {
                                include: {
                                    additional: true,
                                },
                            },
                            product: true,
                            customizations: true,
                        },
                    },
                    user: true,
                    payment: true,
                },
                where: {
                    status: this.buildStatusWhere(filter),
                },
                orderBy: {
                    created_at: "desc",
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
        // Validar recipient_phone
        if (!data.recipient_phone || data.recipient_phone.trim() === "") {
            throw new Error("Número do destinatário é obrigatório");
        }
        // Validar formato do telefone (deve conter apenas números e ter entre 10 e 11 dígitos)
        const phoneDigits = data.recipient_phone.replace(/\D/g, "");
        if (phoneDigits.length < 10 || phoneDigits.length > 11) {
            throw new Error("Número do destinatário deve ter entre 10 e 11 dígitos");
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
                include: {
                    components: {
                        include: {
                            item: true,
                        },
                    },
                },
            });
            if (products.length !== productIds.length) {
                throw new Error("Um ou mais produtos não foram encontrados");
            }
            // ========== VALIDAR ESTOQUE DOS PRODUCT COMPONENTS ==========
            console.log("🔍 Validando estoque dos componentes dos produtos...");
            for (const orderItem of data.items) {
                const product = products.find((p) => p.id === orderItem.product_id);
                if (product && product.components.length > 0) {
                    const validation = await productComponentService_1.default.validateComponentsStock(product.id, orderItem.quantity);
                    if (!validation.valid) {
                        throw new Error(`Estoque insuficiente para ${product.name}:\n${validation.errors.join("\n")}`);
                    }
                }
            }
            console.log("✅ Estoque dos componentes validado!");
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
            // ========== VALIDAR E DECREMENTAR ESTOQUE ==========
            console.log("🔍 Validando estoque antes de criar pedido...");
            const stockValidation = await stockService_1.default.validateOrderStock(items);
            if (!stockValidation.valid) {
                throw new Error(`Estoque insuficiente:\n${stockValidation.errors.join("\n")}`);
            }
            console.log("✅ Estoque validado! Criando pedido...");
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
                    recipient_phone: orderData.recipient_phone,
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
            // ========== DECREMENTAR ESTOQUE ==========
            console.log("📦 Decrementando estoque...");
            try {
                await stockService_1.default.decrementOrderStock(items);
                console.log("✅ Estoque decrementado com sucesso!");
            }
            catch (stockError) {
                console.error("❌ Erro ao decrementar estoque:", stockError);
                // Log o erro mas não falha o pedido, pois já foi criado
                // Idealmente, deveria ter uma transação para reverter
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
    async updateOrderStatus(id, newStatus, options = {}) {
        if (!id) {
            throw new Error("ID do pedido é obrigatório");
        }
        const normalizedStatus = this.normalizeStatus(newStatus);
        const current = await prisma_1.default.order.findUnique({
            where: { id },
            select: { status: true },
        });
        if (!current) {
            throw new Error("Pedido não encontrado");
        }
        // Se status não mudou, apenas retorna o pedido completo
        if (current.status === normalizedStatus) {
            return prisma_1.default.order.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            additionals: {
                                include: {
                                    additional: true,
                                },
                            },
                            product: true,
                            customizations: true,
                        },
                    },
                    user: true,
                    payment: true,
                },
            });
        }
        const updated = await prisma_1.default.order.update({
            where: { id },
            data: {
                status: normalizedStatus,
            },
            include: {
                items: {
                    include: {
                        additionals: {
                            include: {
                                additional: true,
                            },
                        },
                        product: true,
                        customizations: true,
                    },
                },
                user: true,
                payment: true,
            },
        });
        if (options.notifyCustomer !== false) {
            try {
                // Buscar customizações com google_drive_url se existir
                let driveLink;
                try {
                    const customizationWithDrive = await prisma_1.default.orderItemCustomization.findFirst({
                        where: {
                            order_item_id: {
                                in: updated.items.map((item) => item.id),
                            },
                            google_drive_url: {
                                not: null,
                            },
                        },
                        select: {
                            google_drive_url: true,
                        },
                    });
                    driveLink = customizationWithDrive?.google_drive_url || undefined;
                }
                catch (error) {
                    // Ignorar se a coluna ainda não existir
                    console.log("⚠️ Campo google_drive_url ainda não existe na tabela");
                }
                const totalAmount = typeof updated.grand_total === "number"
                    ? updated.grand_total
                    : updated.total;
                await whatsappService_1.default.sendOrderStatusUpdateNotification({
                    orderId: updated.id,
                    orderNumber: updated.id.substring(0, 8).toUpperCase(),
                    totalAmount,
                    paymentMethod: updated.payment_method ||
                        updated.payment?.payment_method ||
                        "Não informado",
                    items: updated.items.map((item) => ({
                        name: item.product.name,
                        quantity: item.quantity,
                        price: item.price,
                    })),
                    customer: {
                        name: updated.user.name,
                        email: updated.user.email,
                        phone: updated.user.phone || undefined,
                    },
                    delivery: updated.delivery_address
                        ? {
                            address: updated.delivery_address,
                            date: updated.delivery_date || undefined,
                        }
                        : undefined,
                    googleDriveUrl: driveLink || undefined,
                }, normalizedStatus);
            }
            catch (error) {
                console.error("⚠️ Erro ao enviar notificação de atualização de pedido:", error.message);
            }
        }
        return updated;
    }
}
exports.default = new OrderService();
