"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeService = void 0;
const prisma_1 = __importDefault(require("../database/prisma"));
exports.typeService = {
    async list() {
        return prisma_1.default.productType.findMany({ include: { products: true } });
    },
    async getById(id) {
        return prisma_1.default.productType.findUnique({
            where: { id },
            include: { products: true },
        });
    },
    async create(data) {
        return prisma_1.default.productType.create({ data });
    },
    async update(id, data) {
        return prisma_1.default.productType.update({ where: { id }, data });
    },
    async remove(id) {
        // optional: prevent deletion if products exist
        const products = await prisma_1.default.product.count({ where: { type_id: id } });
        if (products > 0)
            throw new Error("Cannot delete type with products");
        return prisma_1.default.productType.delete({ where: { id } });
    },
};
