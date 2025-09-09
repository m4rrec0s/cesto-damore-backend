"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryService = void 0;
const prisma_1 = __importDefault(require("../database/prisma"));
exports.categoryService = {
    async list() {
        return prisma_1.default.category.findMany({ include: { products: true } });
    },
    async getById(id) {
        return prisma_1.default.category.findUnique({
            where: { id },
            include: { products: true },
        });
    },
    async create(data) {
        return prisma_1.default.category.create({ data });
    },
    async update(id, data) {
        return prisma_1.default.category.update({ where: { id }, data });
    },
    async remove(id) {
        // optional: prevent deletion if products exist
        const products = await prisma_1.default.product.count({ where: { category_id: id } });
        if (products > 0)
            throw new Error("Cannot delete category with products");
        return prisma_1.default.category.delete({ where: { id } });
    },
};
exports.default = exports.categoryService;
