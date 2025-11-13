"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class ItemService {
    /**
     * Lista todos os itens com paginação
     */
    async listItems(params) {
        const page = params?.page || 1;
        const perPage = params?.perPage || 15;
        const search = params?.search;
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
            ];
        }
        const [items, total] = await Promise.all([
            prisma_1.default.item.findMany({
                where,
                skip: (page - 1) * perPage,
                take: perPage,
                include: {
                    additionals: {
                        select: {
                            custom_price: true,
                            is_active: true,
                            product: { select: { id: true, name: true, image_url: true } },
                        },
                    },
                    customizations: {
                        select: {
                            id: true,
                            name: true,
                            type: true,
                            isRequired: true,
                            price: true,
                        },
                    },
                    components: {
                        select: {
                            product_id: true,
                            quantity: true,
                        },
                    },
                },
                orderBy: { created_at: "desc" },
            }),
            prisma_1.default.item.count({ where }),
        ]);
        return {
            items,
            pagination: {
                page,
                perPage,
                total,
                totalPages: Math.ceil(total / perPage),
            },
        };
    }
    /**
     * Busca item por ID
     */
    async getItemById(itemId) {
        const item = await prisma_1.default.item.findUnique({
            where: { id: itemId },
            include: {
                additionals: true,
                customizations: {
                    orderBy: { created_at: "asc" },
                },
                components: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                image_url: true,
                            },
                        },
                    },
                },
            },
        });
        if (!item) {
            throw new Error("Item não encontrado");
        }
        return item;
    }
    async getItemsByProductId(productId) {
        return prisma_1.default.item.findMany({
            where: {
                components: {
                    some: {
                        product_id: productId,
                    },
                },
            },
            include: {
                customizations: {
                    orderBy: { created_at: "asc" },
                },
                additionals: {
                    select: {
                        custom_price: true,
                        is_active: true,
                        product: { select: { id: true, name: true, image_url: true } },
                    },
                },
                components: {
                    select: {
                        product_id: true,
                        quantity: true,
                    },
                },
                personalizations: true,
            },
        });
    }
    /**
     * Cria novo item
     */
    async createItem(data) {
        // Validações
        if (!data.name || data.name.trim() === "") {
            throw new Error("Nome do item é obrigatório");
        }
        if (data.base_price < 0) {
            throw new Error("Preço base não pode ser negativo");
        }
        if (data.stock_quantity < 0) {
            throw new Error("Quantidade em estoque não pode ser negativa");
        }
        return prisma_1.default.item.create({
            data: {
                name: data.name,
                description: data.description,
                stock_quantity: data.stock_quantity,
                base_price: data.base_price,
                image_url: data.image_url,
                allows_customization: data.allows_customization ?? false,
            },
            include: {
                additionals: true,
                customizations: true,
            },
        });
    }
    /**
     * Atualiza item
     */
    async updateItem(itemId, data) {
        // Verificar se item existe
        await this.getItemById(itemId);
        // Validações
        if (data.base_price !== undefined && data.base_price < 0) {
            throw new Error("Preço base não pode ser negativo");
        }
        if (data.stock_quantity !== undefined && data.stock_quantity < 0) {
            throw new Error("Quantidade em estoque não pode ser negativa");
        }
        return prisma_1.default.item.update({
            where: { id: itemId },
            data,
            include: {
                additionals: true,
                customizations: true,
            },
        });
    }
    /**
     * Deleta item
     */
    async deleteItem(itemId) {
        // Verificar se item existe
        await this.getItemById(itemId);
        // Verificar se item está sendo usado em algum produto
        const componentsCount = await prisma_1.default.productComponent.count({
            where: { item_id: itemId },
        });
        if (componentsCount > 0) {
            throw new Error("Não é possível deletar item que está sendo usado em produtos");
        }
        return prisma_1.default.item.delete({
            where: { id: itemId },
        });
    }
    /**
     * Atualiza estoque do item
     */
    async updateStock(itemId, quantity) {
        if (quantity < 0) {
            throw new Error("Quantidade não pode ser negativa");
        }
        return prisma_1.default.item.update({
            where: { id: itemId },
            data: { stock_quantity: quantity },
        });
    }
    /**
     * Decrementa estoque do item
     */
    async decrementStock(itemId, quantity) {
        const item = await this.getItemById(itemId);
        if (item.stock_quantity < quantity) {
            throw new Error(`Estoque insuficiente para ${item.name}. Disponível: ${item.stock_quantity}, Solicitado: ${quantity}`);
        }
        return prisma_1.default.item.update({
            where: { id: itemId },
            data: {
                stock_quantity: {
                    decrement: quantity,
                },
            },
        });
    }
    /**
     * Busca itens que podem ser adicionados a um produto
     */
    async getAvailableItems() {
        return prisma_1.default.item.findMany({
            where: {
                stock_quantity: {
                    gt: 0,
                },
            },
            include: {
                additionals: {
                    select: {
                        custom_price: true,
                        is_active: true,
                        product: { select: { id: true, name: true, image_url: true } },
                    },
                },
            },
            orderBy: { name: "asc" },
        });
    }
    /**
     * Busca itens com customizações
     */
    async getItemsWithCustomizations() {
        return prisma_1.default.item.findMany({
            where: {
                allows_customization: true,
            },
            include: {
                customizations: {
                    orderBy: { created_at: "asc" },
                },
            },
            orderBy: { name: "asc" },
        });
    }
}
exports.default = new ItemService();
