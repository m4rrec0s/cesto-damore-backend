"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class ProductComponentService {
    /**
     * Adiciona item como componente de um produto
     */
    async addComponent(data) {
        // Validações
        if (!data.product_id || !data.item_id) {
            throw new Error("Product ID e Item ID são obrigatórios");
        }
        if (data.quantity <= 0) {
            throw new Error("Quantidade deve ser maior que zero");
        }
        // Verificar se produto existe
        const product = await prisma_1.default.product.findUnique({
            where: { id: data.product_id },
        });
        if (!product) {
            throw new Error("Produto não encontrado");
        }
        // Verificar se item existe
        const item = await prisma_1.default.item.findUnique({
            where: { id: data.item_id },
        });
        if (!item) {
            throw new Error("Item não encontrado");
        }
        // Verificar se já existe esse componente
        const existing = await prisma_1.default.productComponent.findUnique({
            where: {
                product_id_item_id: {
                    product_id: data.product_id,
                    item_id: data.item_id,
                },
            },
        });
        if (existing) {
            throw new Error("Este item já foi adicionado ao produto");
        }
        return prisma_1.default.productComponent.create({
            data: {
                product_id: data.product_id,
                item_id: data.item_id,
                quantity: data.quantity,
            },
            include: {
                item: {
                    include: {
                        customizations: true,
                    },
                },
            },
        });
    }
    /**
     * Atualiza quantidade de um componente
     */
    async updateComponent(componentId, data) {
        if (data.quantity <= 0) {
            throw new Error("Quantidade deve ser maior que zero");
        }
        const component = await prisma_1.default.productComponent.findUnique({
            where: { id: componentId },
        });
        if (!component) {
            throw new Error("Componente não encontrado");
        }
        return prisma_1.default.productComponent.update({
            where: { id: componentId },
            data: { quantity: data.quantity },
            include: {
                item: true,
            },
        });
    }
    /**
     * Remove componente de um produto
     */
    async removeComponent(componentId) {
        const component = await prisma_1.default.productComponent.findUnique({
            where: { id: componentId },
        });
        if (!component) {
            throw new Error("Componente não encontrado");
        }
        return prisma_1.default.productComponent.delete({
            where: { id: componentId },
        });
    }
    /**
     * Lista componentes de um produto
     */
    async getProductComponents(productId) {
        return prisma_1.default.productComponent.findMany({
            where: { product_id: productId },
            include: {
                item: {
                    include: {
                        customizations: true,
                    },
                },
            },
            orderBy: { created_at: "asc" },
        });
    }
    /**
     * Calcula estoque disponível do produto baseado nos componentes
     */
    async calculateProductStock(productId) {
        const components = await prisma_1.default.productComponent.findMany({
            where: { product_id: productId },
            include: {
                item: {
                    select: {
                        stock_quantity: true,
                    },
                },
            },
        });
        if (components.length === 0) {
            return 0;
        }
        // Fórmula: MIN(item1.stock / qty1, item2.stock / qty2, ..., itemN.stock / qtyN)
        const availableQuantities = components.map((component) => {
            const stock = component.item.stock_quantity ?? 0;
            return Math.floor(stock / component.quantity);
        });
        return Math.min(...availableQuantities);
    }
    /**
     * Atualiza estoque do produto baseado nos componentes
     */
    async updateProductStock(productId) {
        const availableStock = await this.calculateProductStock(productId);
        await prisma_1.default.product.update({
            where: { id: productId },
            data: { stock_quantity: availableStock },
        });
        return availableStock;
    }
    /**
     * Decrementa estoque de todos os itens componentes de um produto
     */
    async decrementComponentsStock(productId, productQuantity) {
        const components = await this.getProductComponents(productId);
        for (const component of components) {
            const itemQuantityNeeded = component.quantity * productQuantity;
            // Verificar se tem estoque suficiente
            const stock = component.item.stock_quantity ?? 0;
            if (stock < itemQuantityNeeded) {
                throw new Error(`Estoque insuficiente para ${component.item.name}. ` +
                    `Disponível: ${component.item.stock_quantity}, ` +
                    `Necessário: ${itemQuantityNeeded}`);
            }
            // Decrementar estoque do item
            await prisma_1.default.item.update({
                where: { id: component.item_id },
                data: {
                    stock_quantity: {
                        decrement: itemQuantityNeeded,
                    },
                },
            });
        }
        // Atualizar estoque do produto
        await this.updateProductStock(productId);
    }
    /**
     * Valida se há estoque suficiente para os componentes
     */
    async validateComponentsStock(productId, productQuantity) {
        const components = await this.getProductComponents(productId);
        const errors = [];
        for (const component of components) {
            const itemQuantityNeeded = component.quantity * productQuantity;
            if (component.item.stock_quantity < itemQuantityNeeded) {
                errors.push(`${component.item.name}: estoque insuficiente. ` +
                    `Disponível: ${component.item.stock_quantity}, ` +
                    `Necessário: ${itemQuantityNeeded}`);
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
    /**
     * Busca produtos que usam um item específico
     */
    async getProductsUsingItem(itemId) {
        const components = await prisma_1.default.productComponent.findMany({
            where: { item_id: itemId },
            include: {
                product: {
                    include: {
                        type: true,
                        categories: {
                            include: {
                                category: true,
                            },
                        },
                    },
                },
            },
        });
        return components.map((c) => ({
            ...c.product,
            component_quantity: c.quantity,
        }));
    }
}
exports.default = new ProductComponentService();
