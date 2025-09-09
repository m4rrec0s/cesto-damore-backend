"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderService = void 0;
const prisma_1 = __importDefault(require("../database/prisma"));
exports.orderService = {
    async list() {
        return prisma_1.default.order.findMany({
            include: {
                items: { include: { additionals: true, product: true } },
                user: true,
            },
        });
    },
    async getById(id) {
        return prisma_1.default.order.findUnique({
            where: { id },
            include: {
                items: { include: { additionals: true, product: true } },
                user: true,
            },
        });
    },
    async create(data) {
        const { items, ...orderData } = data;
        const created = await prisma_1.default.order.create({ data: { ...orderData } });
        for (const it of items) {
            const orderItem = await prisma_1.default.orderItem.create({
                data: {
                    order_id: created.id,
                    product_id: it.product_id,
                    quantity: it.quantity,
                    price: it.price,
                },
            });
            if (Array.isArray(it.additionals)) {
                for (const a of it.additionals) {
                    await prisma_1.default.orderItemAdditional.create({
                        data: {
                            order_item_id: orderItem.id,
                            additional_id: a.additional_id,
                            quantity: a.quantity,
                            price: a.price,
                        },
                    });
                }
            }
        }
        return this.getById(created.id);
    },
    async remove(id) {
        // cascade delete items and additionals
        const items = await prisma_1.default.orderItem.findMany({ where: { order_id: id } });
        for (const it of items) {
            await prisma_1.default.orderItemAdditional.deleteMany({
                where: { order_item_id: it.id },
            });
        }
        await prisma_1.default.orderItem.deleteMany({ where: { order_id: id } });
        return prisma_1.default.order.delete({ where: { id } });
    },
};
exports.default = exports.orderService;
