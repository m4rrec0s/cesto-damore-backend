"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const prismaRetry_1 = require("../database/prismaRetry");
const whatsappService_1 = __importDefault(require("./whatsappService"));
const productComponentService_1 = __importDefault(require("./productComponentService"));
class StockService {
    /**
     * Decrementa o estoque dos produtos e adicionais de um pedido
     */
    async decrementOrderStock(orderItems) {
        try {
            for (const item of orderItems) {
                // 1. Decrementar estoque dos componentes do produto (NOVA LÓGICA)
                await this.decrementProductStock(item.product_id, item.quantity);
                // 2. Decrementar estoque dos adicionais
                if (item.additionals && item.additionals.length > 0) {
                    for (const additional of item.additionals) {
                        await this.decrementAdditionalStock(additional.additional_id, additional.quantity);
                    }
                }
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Erro ao decrementar estoque";
            throw new Error(`Erro ao decrementar estoque: ${errorMessage}`);
        }
    }
    /**
     * Decrementa estoque de um produto através dos seus componentes
     */
    async decrementProductStock(productId, quantity) {
        const product = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.product.findUnique({
            where: { id: productId },
            select: {
                id: true,
                name: true,
                stock_quantity: true,
                components: {
                    include: {
                        item: true,
                    },
                },
            },
        }));
        if (!product) {
            throw new Error(`Produto ${productId} não encontrado`);
        }
        // NOVA LÓGICA: Se o produto tem componentes, decrementar estoque dos items
        if (product.components.length > 0) {
            await productComponentService_1.default.decrementComponentsStock(productId, quantity);
            return;
        }
        // LÓGICA LEGADA: Se não tem componentes, decrementar estoque direto do produto
        if (product.stock_quantity === null) {
            console.warn(`Produto ${product.name} não possui controle de estoque`);
            return;
        }
        // Verifica se tem estoque suficiente
        if (product.stock_quantity < quantity) {
            throw new Error(`Estoque insuficiente para ${product.name}. Disponível: ${product.stock_quantity}, Solicitado: ${quantity}`);
        }
        // Decrementa estoque direto
        await (0, prismaRetry_1.withRetry)(() => prisma_1.default.product.update({
            where: { id: productId },
            data: {
                stock_quantity: {
                    decrement: quantity,
                },
            },
        }));
        // Verificar e enviar alerta se estoque ficou baixo
        const newStock = (product.stock_quantity || 0) - quantity;
        await this.checkAndNotifyLowStock(productId, product.name, newStock, "product");
    }
    /**
     * Decrementa estoque de um adicional (com ou sem cor específica)
     */
    async decrementAdditionalStock(additionalId, quantity) {
        // O schema atual unificou "additional" no modelo Item.
        // Aqui tentamos ler como Item e, caso não exista uma tabela de cores
        // (additionalColor) no schema atual, fazemos fallback para decrementar
        // o estoque total do Item.
        const item = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.findUnique({
            where: { id: additionalId },
            select: {
                id: true,
                name: true,
                stock_quantity: true,
            },
        }));
        if (!item) {
            throw new Error(`Adicional/Item ${additionalId} não encontrado`);
        }
        // Cores legadas removidas: decrementa sempre do estoque unificado do Item
        // Valida estoque total do item
        if (item.stock_quantity === null || item.stock_quantity === undefined) {
            console.warn(`Item ${item.name} não possui controle de estoque`);
            return;
        }
        if (item.stock_quantity < quantity) {
            throw new Error(`Estoque insuficiente para ${item.name}. Disponível: ${item.stock_quantity}, Solicitado: ${quantity}`);
        }
        await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.update({
            where: { id: additionalId },
            data: { stock_quantity: { decrement: quantity } },
        }));
        const newStock = (item.stock_quantity || 0) - quantity;
        await this.checkAndNotifyLowStock(additionalId, item.name, newStock, "additional");
    }
    /**
     * Verifica se o estoque ficou baixo e envia notificação WhatsApp
     */
    async checkAndNotifyLowStock(itemId, itemName, currentStock, itemType, colorInfo) {
        const CRITICAL_THRESHOLD = 0;
        const LOW_THRESHOLD = 5;
        try {
            // Estoque crítico (zerado)
            if (currentStock === CRITICAL_THRESHOLD) {
                await whatsappService_1.default.sendCriticalStockAlert(itemId, itemName, itemType, colorInfo);
            }
            // Estoque baixo (entre 1 e 5)
            else if (currentStock > 0 && currentStock <= LOW_THRESHOLD) {
                await whatsappService_1.default.sendLowStockAlert(itemId, itemName, currentStock, LOW_THRESHOLD, itemType, colorInfo);
            }
        }
        catch (error) {
            // Não interrompe o fluxo se a notificação falhar
            console.error("Erro ao enviar notificação de estoque baixo:", error);
        }
    }
    /**
     * Verifica se há estoque disponível antes de criar o pedido
     */
    async validateOrderStock(orderItems) {
        const errors = [];
        for (const item of orderItems) {
            // Validar produto
            try {
                const product = await prisma_1.default.product.findUnique({
                    where: { id: item.product_id },
                    select: { name: true, stock_quantity: true },
                });
                if (product && product.stock_quantity !== null) {
                    if (product.stock_quantity < item.quantity) {
                        errors.push(`Produto ${product.name}: estoque insuficiente (disponível: ${product.stock_quantity})`);
                    }
                }
            }
            catch (error) {
                errors.push(`Erro ao validar produto ${item.product_id}`);
            }
            // Validar adicionais
            if (item.additionals) {
                for (const additional of item.additionals) {
                    try {
                        const additionalData = await prisma_1.default.item.findUnique({
                            where: { id: additional.additional_id },
                            select: { name: true, stock_quantity: true },
                        });
                        if (!additionalData)
                            continue;
                        // Validar estoque total do item
                        if (additionalData.stock_quantity !== null &&
                            additionalData.stock_quantity < additional.quantity) {
                            errors.push(`Adicional ${additionalData.name}: estoque insuficiente (disponível: ${additionalData.stock_quantity})`);
                        }
                    }
                    catch (error) {
                        errors.push(`Erro ao validar adicional ${additional.additional_id}`);
                    }
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
}
exports.default = new StockService();
