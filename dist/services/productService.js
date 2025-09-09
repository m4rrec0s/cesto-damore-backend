"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productService = void 0;
const prisma_1 = __importDefault(require("../database/prisma"));
exports.productService = {
    async list() {
        return prisma_1.default.product.findMany({
            include: {
                additionals: { include: { additional: true } },
                category: true,
                type: true
            },
        });
    },
    async getById(id) {
        return prisma_1.default.product.findUnique({
            where: { id },
            include: {
                additionals: { include: { additional: true } },
                category: true,
                type: true
            },
        });
    },
    async create(data) {
        const { additionals, ...rest } = data;
        const normalized = { ...rest };
        if (normalized.price !== undefined) {
            if (typeof normalized.price === "string") {
                // Remove pontos de milhar e substitui vírgula por ponto
                const cleanPrice = normalized.price.replace(/\./g, "").replace(/,/g, ".");
                normalized.price = parseFloat(cleanPrice);
                if (isNaN(normalized.price)) {
                    throw new Error("Preço inválido");
                }
            }
        }
        if (normalized.stock_quantity !== undefined) {
            if (typeof normalized.stock_quantity === "string") {
                normalized.stock_quantity = parseInt(normalized.stock_quantity, 10);
            }
        }
        if (normalized.is_active !== undefined) {
            if (typeof normalized.is_active === "string") {
                normalized.is_active = ["true", "1", "on", "yes"].includes(normalized.is_active.toLowerCase());
            }
        }
        else {
            // default ativo se não informado
            normalized.is_active = true;
        }
        const created = await prisma_1.default.product.create({ data: { ...normalized } });
        if (Array.isArray(additionals) && additionals.length) {
            await Promise.all(additionals.map((addId) => prisma_1.default.productAdditional.create({
                data: { product_id: created.id, additional_id: addId },
            })));
        }
        return this.getById(created.id);
    },
    async update(id, data) {
        const { additionals, ...rest } = data;
        const normalized = { ...rest };
        if (normalized.price !== undefined) {
            if (typeof normalized.price === "string") {
                // Remove pontos de milhar e substitui vírgula por ponto
                const cleanPrice = normalized.price.replace(/\./g, "").replace(/,/g, ".");
                normalized.price = parseFloat(cleanPrice);
                if (isNaN(normalized.price)) {
                    throw new Error("Preço inválido");
                }
            }
        }
        if (normalized.stock_quantity !== undefined) {
            if (typeof normalized.stock_quantity === "string") {
                normalized.stock_quantity = parseInt(normalized.stock_quantity, 10);
            }
        }
        if (normalized.is_active !== undefined) {
            if (typeof normalized.is_active === "string") {
                normalized.is_active = ["true", "1", "on", "yes"].includes(normalized.is_active.toLowerCase());
            }
        }
        const updated = await prisma_1.default.product.update({
            where: { id },
            data: { ...normalized },
        });
        if (Array.isArray(additionals)) {
            // replace associations
            await prisma_1.default.productAdditional.deleteMany({ where: { product_id: id } });
            await Promise.all(additionals.map((addId) => prisma_1.default.productAdditional.create({
                data: { product_id: id, additional_id: addId },
            })));
        }
        return this.getById(id);
    },
    async remove(id) {
        await prisma_1.default.productAdditional.deleteMany({ where: { product_id: id } });
        return prisma_1.default.product.delete({ where: { id } });
    },
    async linkAdditional(productId, additionalId) {
        return prisma_1.default.productAdditional.create({
            data: { product_id: productId, additional_id: additionalId },
        });
    },
    async unlinkAdditional(productId, additionalId) {
        return prisma_1.default.productAdditional.delete({
            where: {
                product_id_additional_id: {
                    product_id: productId,
                    additional_id: additionalId,
                },
            },
        });
    },
};
exports.default = exports.productService;
