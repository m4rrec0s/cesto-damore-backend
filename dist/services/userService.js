"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = void 0;
const prisma_1 = __importDefault(require("../database/prisma"));
exports.userService = {
    async list() {
        return prisma_1.default.user.findMany();
    },
    async getById(id) {
        return prisma_1.default.user.findUnique({ where: { id } });
    },
    async create(data) {
        return prisma_1.default.user.create({ data });
    },
    async update(id, data) {
        return prisma_1.default.user.update({ where: { id }, data });
    },
    async remove(id) {
        // optional: prevent deletion if user has orders
        const orders = await prisma_1.default.order.count({ where: { user_id: id } });
        if (orders > 0)
            throw new Error("Cannot delete user with orders");
        return prisma_1.default.user.delete({ where: { id } });
    },
};
exports.default = exports.userService;
