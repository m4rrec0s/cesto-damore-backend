"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const prismaRetry_1 = require("../database/prismaRetry");
class ReportService {
    /**
     * Gera relatório completo de estoque
     */
    async getStockReport(threshold = 5) {
        const lowStockItems = [];
        // 1. Produtos com estoque baixo
        const products = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.product.findMany({
            where: {
                stock_quantity: {
                    lte: threshold,
                    not: null,
                },
            },
            select: {
                id: true,
                name: true,
                stock_quantity: true,
            },
        }));
        products.forEach((product) => {
            lowStockItems.push({
                id: product.id,
                name: product.name,
                type: "product",
                current_stock: product.stock_quantity || 0,
                threshold,
            });
        });
        // 2. Adicionais com estoque baixo (SEM cores)
        // Buscar todos os adicionais com estoque baixo
        const additionals = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.findMany({
            where: {
                stock_quantity: {
                    lte: threshold,
                    not: null,
                },
            },
            select: {
                id: true,
                name: true,
                stock_quantity: true,
                colors: {
                    select: {
                        color_id: true,
                    },
                },
            },
        }));
        // Apenas adicionar adicionais que NÃO têm cores
        // Se tem cores, o estoque é gerenciado por cor, não pelo adicional
        additionals.forEach((additional) => {
            if (!additional.colors || additional.colors.length === 0) {
                lowStockItems.push({
                    id: additional.id,
                    name: additional.name,
                    type: "additional",
                    current_stock: additional.stock_quantity || 0,
                    threshold,
                });
            }
        });
        // 3. Cores de adicionais com estoque baixo
        const colorStocks = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additionalColor.findMany({
            where: {
                stock_quantity: {
                    lte: threshold,
                },
            },
            select: {
                additional_id: true,
                color_id: true,
                stock_quantity: true,
                additional: {
                    select: {
                        name: true,
                    },
                },
                color: {
                    select: {
                        name: true,
                        hex_code: true,
                    },
                },
            },
        }));
        colorStocks.forEach((colorStock) => {
            lowStockItems.push({
                id: `${colorStock.additional_id}-${colorStock.color_id}`,
                name: colorStock.color.name,
                type: "color",
                current_stock: colorStock.stock_quantity,
                threshold,
                color_name: colorStock.color.name,
                color_hex_code: colorStock.color.hex_code,
                additional_name: colorStock.additional.name,
            });
        });
        // 4. Contar totais
        const totalProducts = await prisma_1.default.product.count();
        const totalAdditionals = await prisma_1.default.additional.count();
        const totalColors = await prisma_1.default.additionalColor.count();
        const productsOutOfStock = await prisma_1.default.product.count({
            where: { stock_quantity: 0 },
        });
        // Contar apenas adicionais SEM cores que estão sem estoque
        const additionalsWithoutColors = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.findMany({
            where: {
                stock_quantity: 0,
            },
            select: {
                id: true,
                colors: {
                    select: {
                        color_id: true,
                    },
                },
            },
        }));
        const additionalsOutOfStock = additionalsWithoutColors.filter((additional) => !additional.colors || additional.colors.length === 0).length;
        const colorsOutOfStock = await prisma_1.default.additionalColor.count({
            where: { stock_quantity: 0 },
        });
        return {
            low_stock_items: lowStockItems,
            total_products: totalProducts,
            total_additionals: totalAdditionals,
            total_colors: totalColors,
            products_out_of_stock: productsOutOfStock,
            additionals_out_of_stock: additionalsOutOfStock,
            colors_out_of_stock: colorsOutOfStock,
        };
    }
    /**
     * Retorna lista de itens críticos (estoque = 0)
     */
    async getCriticalStock() {
        const criticalItems = [];
        // Produtos sem estoque
        const products = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.product.findMany({
            where: { stock_quantity: 0 },
            select: {
                id: true,
                name: true,
                stock_quantity: true,
            },
        }));
        products.forEach((product) => {
            criticalItems.push({
                id: product.id,
                name: product.name,
                type: "product",
                current_stock: 0,
                threshold: 0,
            });
        });
        // Adicionais sem estoque (apenas os que NÃO têm cores)
        const additionals = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.findMany({
            where: { stock_quantity: 0 },
            select: {
                id: true,
                name: true,
                stock_quantity: true,
                colors: {
                    select: {
                        color_id: true,
                    },
                },
            },
        }));
        // Apenas adicionar adicionais que NÃO têm cores
        additionals.forEach((additional) => {
            if (!additional.colors || additional.colors.length === 0) {
                criticalItems.push({
                    id: additional.id,
                    name: additional.name,
                    type: "additional",
                    current_stock: 0,
                    threshold: 0,
                });
            }
        });
        // Cores sem estoque
        const colorStocks = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additionalColor.findMany({
            where: { stock_quantity: 0 },
            select: {
                additional_id: true,
                color_id: true,
                stock_quantity: true,
                additional: {
                    select: {
                        name: true,
                    },
                },
                color: {
                    select: {
                        name: true,
                        hex_code: true,
                    },
                },
            },
        }));
        colorStocks.forEach((colorStock) => {
            criticalItems.push({
                id: `${colorStock.additional_id}-${colorStock.color_id}`,
                name: colorStock.color.name,
                type: "color",
                current_stock: 0,
                threshold: 0,
                color_name: colorStock.color.name,
                color_hex_code: colorStock.color.hex_code,
                additional_name: colorStock.additional.name,
            });
        });
        return criticalItems;
    }
    /**
     * Verifica se algum item atingiu estoque crítico (necessário para notificações)
     */
    async hasItemsBelowThreshold(threshold = 3) {
        const criticalItems = await this.getCriticalStock();
        const lowStock = await this.getStockReport(threshold);
        return {
            has_critical: criticalItems.length > 0 || lowStock.low_stock_items.length > 0,
            items: [...criticalItems, ...lowStock.low_stock_items],
        };
    }
}
exports.default = new ReportService();
