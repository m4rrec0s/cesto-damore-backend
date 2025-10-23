"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const prismaRetry_1 = require("../database/prismaRetry");
class ReportService {
    // Gera relatório completo de estoque
    async getStockReport(threshold = 5) {
        const lowStockItems = [];
        // 1) Produtos com estoque baixo
        const products = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.product.findMany({
            where: { stock_quantity: { lte: threshold } },
            select: { id: true, name: true, stock_quantity: true },
        }));
        products.forEach((p) => lowStockItems.push({
            id: p.id,
            name: p.name,
            type: "product",
            current_stock: p.stock_quantity || 0,
            threshold,
        }));
        // 2) Adicionais (items) com estoque baixo
        const additionals = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.findMany({
            where: { stock_quantity: { lte: threshold } },
            select: { id: true, name: true, stock_quantity: true },
        }));
        for (const a of additionals) {
            lowStockItems.push({
                id: a.id,
                name: a.name,
                type: "additional",
                current_stock: a.stock_quantity || 0,
                threshold,
            });
        }
        // Totais
        const totalProducts = await prisma_1.default.product.count();
        const totalAdditionals = await prisma_1.default.item.count();
        const totalColors = 0;
        const productsOutOfStock = await prisma_1.default.product.count({
            where: { stock_quantity: 0 },
        });
        // Additionals out of stock
        const additionalsOutOfStock = await prisma_1.default.item.count({
            where: { stock_quantity: 0 },
        });
        const colorsOutOfStock = 0;
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
    // Retorna lista de itens críticos (estoque = 0)
    async getCriticalStock() {
        const criticalItems = [];
        const products = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.product.findMany({
            where: { stock_quantity: 0 },
            select: { id: true, name: true },
        }));
        for (const p of products) {
            criticalItems.push({
                id: p.id,
                name: p.name,
                type: "product",
                current_stock: 0,
                threshold: 0,
            });
        }
        const additionals = (await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.findMany({
            where: { stock_quantity: 0 },
            select: { id: true, name: true },
        })));
        for (const a of additionals) {
            criticalItems.push({
                id: a.id,
                name: a.name,
                type: "additional",
                current_stock: 0,
                threshold: 0,
            });
        }
        return criticalItems;
    }
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
