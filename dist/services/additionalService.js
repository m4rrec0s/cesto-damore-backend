"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.additionalService = void 0;
const prisma_1 = __importDefault(require("../database/prisma"));
function serializeCompatible(value) {
    if (!value)
        return null;
    if (Array.isArray(value))
        return value.join(",");
    return value;
}
function deserializeCompatible(value) {
    if (!value)
        return [];
    if (Array.isArray(value)) {
        return value.map((s) => String(s).trim()).filter(Boolean);
    }
    return String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
exports.additionalService = {
    async list() {
        const results = await prisma_1.default.additional.findMany({});
        return results.map((r) => ({
            ...r,
            compatible_with: deserializeCompatible(r.compatible_with),
        }));
    },
    async getById(id) {
        const r = await prisma_1.default.additional.findUnique({ where: { id } });
        if (!r)
            return null;
        const dr = r;
        return {
            ...dr,
            compatible_with: deserializeCompatible(dr.compatible_with),
        };
    },
    async create(data) {
        const stored = serializeCompatible(data.compatible_with);
        const r = await prisma_1.default.additional.create({
            data: {
                name: data.name,
                description: data.description ?? null,
                price: data.price,
                image_url: data.image_url ?? null,
                compatible_with: stored,
            },
        });
        // Se vier compatibilidades, sincroniza a tabela de junção ProductAdditional
        const compatArray = deserializeCompatible(data.compatible_with);
        if (compatArray.length) {
            // validando ids de produto existentes
            const existing = await prisma_1.default.product.findMany({
                where: { id: { in: compatArray } },
                select: { id: true },
            });
            const existingIds = existing.map((p) => p.id);
            if (existingIds.length) {
                await prisma_1.default.productAdditional.createMany({
                    data: existingIds.map((pid) => ({
                        product_id: pid,
                        additional_id: r.id,
                    })),
                    skipDuplicates: true,
                });
            }
        }
        return {
            ...r,
            compatible_with: deserializeCompatible(r.compatible_with),
        };
    },
    async update(id, data) {
        const payload = {};
        if (data.name !== undefined)
            payload.name = data.name;
        if (data.description !== undefined)
            payload.description = data.description;
        if (data.price !== undefined)
            payload.price = data.price;
        if (data.image_url !== undefined)
            payload.image_url = data.image_url;
        if (data.compatible_with !== undefined)
            payload.compatible_with = serializeCompatible(data.compatible_with);
        const r = await prisma_1.default.additional.update({ where: { id }, data: payload });
        // Se foi enviado compatible_with, sincroniza as associações na tabela de junção
        if (data.compatible_with !== undefined) {
            const compatArray = deserializeCompatible(data.compatible_with);
            // remove associações antigas
            await prisma_1.default.productAdditional.deleteMany({
                where: { additional_id: id },
            });
            if (compatArray.length) {
                const existing = await prisma_1.default.product.findMany({
                    where: { id: { in: compatArray } },
                    select: { id: true },
                });
                const existingIds = existing.map((p) => p.id);
                if (existingIds.length) {
                    await prisma_1.default.productAdditional.createMany({
                        data: existingIds.map((pid) => ({
                            product_id: pid,
                            additional_id: id,
                        })),
                        skipDuplicates: true,
                    });
                }
            }
        }
        return {
            ...r,
            compatible_with: deserializeCompatible(r.compatible_with),
        };
    },
    async remove(id) {
        // Remove associações na tabela de junção manualmente
        await prisma_1.default.productAdditional.deleteMany({ where: { additional_id: id } });
        const r = await prisma_1.default.additional.delete({ where: { id } });
        return r;
    },
    async linkToProduct(additionalId, productId) {
        return prisma_1.default.productAdditional.create({
            data: { additional_id: additionalId, product_id: productId },
        });
    },
    async unlinkFromProduct(additionalId, productId) {
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
