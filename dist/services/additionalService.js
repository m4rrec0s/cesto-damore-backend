"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const localStorage_1 = require("../config/localStorage");
const prisma_1 = __importDefault(require("../database/prisma"));
const prismaRetry_1 = require("../database/prismaRetry");
class AdditionalService {
    async getAllAdditionals(includeProducts = false) {
        try {
            const results = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.findMany({
                include: {
                    ...(includeProducts
                        ? {
                            additionals: {
                                where: { is_active: true },
                                include: { product: { select: { id: true, name: true } } },
                            },
                        }
                        : {}),
                },
            }));
            return results.map((r) => ({
                id: r.id,
                name: r.name,
                description: r.description,
                price: r.base_price,
                discount: r.discount ?? null,
                image_url: r.image_url,
                stock_quantity: r.stock_quantity,
                created_at: r.created_at,
                updated_at: r.updated_at,
                compatible_products: r.additionals?.map((p) => ({
                    product_id: p.product.id,
                    product_name: p.product.name,
                    custom_price: p.custom_price,
                    is_active: p.is_active,
                })) || undefined,
            }));
        }
        catch (error) {
            throw new Error(`Erro ao buscar adicionais: ${error.message}`);
        }
    }
    async getAdditionalById(id, includeProducts = false) {
        if (!id) {
            throw new Error("ID do adicional é obrigatório");
        }
        try {
            const r = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.findUnique({
                where: { id },
                include: {
                    additionals: includeProducts
                        ? { include: { product: { select: { id: true, name: true } } } }
                        : false,
                },
            }));
            if (!r)
                throw new Error("Adicional não encontrado");
            return {
                id: r.id,
                name: r.name,
                description: r.description,
                price: r.base_price,
                discount: r.discount ?? null,
                image_url: r.image_url,
                stock_quantity: r.stock_quantity,
                created_at: r.created_at,
                updated_at: r.updated_at,
                compatible_products: r.additionals?.map((p) => ({
                    product_id: p.product.id,
                    product_name: p.product.name,
                    custom_price: p.custom_price,
                    is_active: p.is_active,
                })) || undefined,
            };
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                throw error;
            }
            throw new Error(`Erro ao buscar adicional: ${error.message}`);
        }
    }
    async createAdditional(data) {
        if (!data.name || data.name.trim() === "") {
            throw new Error("Nome do adicional é obrigatório");
        }
        if (!data.price || data.price <= 0) {
            throw new Error("Preço do adicional é obrigatório e deve ser maior que zero");
        }
        try {
            const payload = {
                name: data.name,
                description: data.description,
                base_price: this.normalizePrice(data.price),
                discount: this.normalizeDiscount(data.discount),
                image_url: data.image_url,
                stock_quantity: data.stock_quantity || 0,
            };
            const r = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.create({ data: payload }));
            if (data.compatible_products && data.compatible_products.length > 0) {
                const normalizedProducts = this.normalizeCompatibleProducts(data.compatible_products);
                await this.linkToProducts(r.id, normalizedProducts);
            }
            // cores legadas ignoradas até que o schema suporte
            return await this.getAdditionalById(r.id, true);
        }
        catch (error) {
            if (error.message.includes("obrigatório") ||
                error.message.includes("inválido")) {
                throw error;
            }
            throw new Error(`Erro ao criar adicional: ${error.message}`);
        }
    }
    async updateAdditional(id, data) {
        if (!id) {
            throw new Error("ID do adicional é obrigatório");
        }
        await this.getAdditionalById(id);
        try {
            const payload = {};
            if (data.name !== undefined)
                payload.name = data.name;
            if (data.description !== undefined)
                payload.description = data.description;
            if (data.price !== undefined)
                payload.base_price = this.normalizePrice(data.price);
            if (data.discount !== undefined)
                payload.discount = this.normalizeDiscount(data.discount);
            if (data.image_url !== undefined)
                payload.image_url = data.image_url;
            if (data.stock_quantity !== undefined)
                payload.stock_quantity = data.stock_quantity;
            const r = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.update({ where: { id }, data: payload }));
            if (data.compatible_products !== undefined) {
                await (0, prismaRetry_1.withRetry)(() => prisma_1.default.productAdditional.deleteMany({ where: { additional_id: id } }));
                if (data.compatible_products.length > 0) {
                    const normalizedProducts = this.normalizeCompatibleProducts(data.compatible_products);
                    await this.linkToProducts(id, normalizedProducts);
                }
            }
            return await this.getAdditionalById(id, true);
        }
        catch (error) {
            if (error.message.includes("não encontrado") ||
                error.message.includes("obrigatório")) {
                throw error;
            }
            throw new Error(`Erro ao atualizar adicional: ${error.message}`);
        }
    }
    async deleteAdditional(id) {
        if (!id) {
            throw new Error("ID do adicional é obrigatório");
        }
        const additional = await this.getAdditionalById(id);
        if (additional.image_url) {
            await (0, localStorage_1.deleteAdditionalImage)(additional.image_url);
        }
        try {
            await prisma_1.default.productAdditional.deleteMany({
                where: { additional_id: id },
            });
            await prisma_1.default.item.delete({ where: { id } });
            return { message: "Adicional deletado com sucesso" };
        }
        catch (error) {
            throw new Error(`Erro ao deletar adicional: ${error.message}`);
        }
    }
    async linkToProduct(additionalId, productId, customPrice) {
        if (!additionalId) {
            throw new Error("ID do adicional é obrigatório");
        }
        if (!productId) {
            throw new Error("ID do produto é obrigatório");
        }
        try {
            // Verifica se o item existe
            await this.getAdditionalById(additionalId);
            // Verifica se o produto existe
            const product = await prisma_1.default.product.findUnique({
                where: { id: productId },
                select: { id: true },
            });
            if (!product) {
                throw new Error("Produto não encontrado");
            }
            // Usar upsert para criar ou atualizar o vínculo
            return await prisma_1.default.productAdditional.upsert({
                where: {
                    product_id_additional_id: {
                        product_id: productId,
                        additional_id: additionalId,
                    },
                },
                update: {
                    custom_price: customPrice || null,
                },
                create: {
                    additional_id: additionalId,
                    product_id: productId,
                    custom_price: customPrice || null,
                },
            });
        }
        catch (error) {
            if (error.message.includes("não encontrado") ||
                error.message.includes("obrigatório")) {
                throw error;
            }
            throw new Error(`Erro ao vincular adicional ao produto: ${error.message}`);
        }
    }
    async updateProductLink(additionalId, productId, customPrice) {
        if (!additionalId) {
            throw new Error("ID do adicional é obrigatório");
        }
        if (!productId) {
            throw new Error("ID do produto é obrigatório");
        }
        try {
            return await prisma_1.default.productAdditional.update({
                where: {
                    product_id_additional_id: {
                        product_id: productId,
                        additional_id: additionalId,
                    },
                },
                data: {
                    custom_price: customPrice || null,
                    updated_at: new Date(),
                },
            });
        }
        catch (error) {
            throw new Error(`Erro ao atualizar vínculo do adicional: ${error.message}`);
        }
    }
    async linkToProducts(additionalId, products) {
        const validProducts = await prisma_1.default.product.findMany({
            where: { id: { in: products.map((p) => p.product_id) } },
            select: { id: true },
        });
        const validProductIds = new Set(validProducts.map((p) => p.id));
        const dataToInsert = products
            .filter((p) => validProductIds.has(p.product_id))
            .map((p) => ({
            product_id: p.product_id,
            additional_id: additionalId,
            custom_price: p.custom_price || null,
        }));
        if (dataToInsert.length > 0) {
            await prisma_1.default.productAdditional.createMany({
                data: dataToInsert,
                skipDuplicates: true,
            });
        }
    }
    async unlinkFromProduct(additionalId, productId) {
        if (!additionalId)
            throw new Error("ID do adicional é obrigatório");
        if (!productId)
            throw new Error("ID do produto é obrigatório");
        try {
            const existingLink = await prisma_1.default.productAdditional.findUnique({
                where: {
                    product_id_additional_id: {
                        product_id: productId,
                        additional_id: additionalId,
                    },
                },
            });
            if (!existingLink)
                throw new Error("Vínculo entre produto e adicional não encontrado");
            await prisma_1.default.productAdditional.delete({
                where: {
                    product_id_additional_id: {
                        product_id: productId,
                        additional_id: additionalId,
                    },
                },
            });
            return { message: "Adicional desvinculado do produto com sucesso" };
        }
        catch (error) {
            throw new Error(`Erro ao desvincular adicional do produto: ${error.message}`);
        }
    }
    // Método para buscar o preço correto do adicional
    async getAdditionalPrice(additionalId, productId) {
        if (!additionalId) {
            throw new Error("ID do adicional é obrigatório");
        }
        try {
            // Busca o item unificado
            const item = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.item.findUnique({
                where: { id: additionalId },
                select: { base_price: true },
            }));
            if (!item)
                throw new Error("Adicional não encontrado");
            // Se tem produto específico, busca o preço customizado no vínculo
            if (productId) {
                const productAdditional = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.productAdditional.findUnique({
                    where: {
                        product_id_additional_id: {
                            product_id: productId,
                            additional_id: additionalId,
                        },
                    },
                    select: { custom_price: true, is_active: true },
                }));
                if (productAdditional?.is_active &&
                    productAdditional.custom_price !== null) {
                    return productAdditional.custom_price;
                }
            }
            return item.base_price;
        }
        catch (error) {
            throw new Error(`Erro ao buscar preço do adicional: ${error.message}`);
        }
    }
    // Busca todos os adicionais vinculados a um produto
    async getAdditionalsByProduct(productId) {
        if (!productId)
            throw new Error("ID do produto é obrigatório");
        try {
            const relations = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.productAdditional.findMany({
                where: { product_id: productId, is_active: true },
                include: {
                    additional: {
                        include: {
                            customizations: true, // Incluir customizações dos adicionais
                        },
                    },
                    product: { select: { id: true, name: true } },
                },
            }));
            return relations.map((r) => ({
                id: r.additional.id,
                name: r.additional.name,
                description: r.additional.description,
                price: r.custom_price ?? r.additional.base_price,
                discount: r.additional.discount ?? null,
                image_url: r.additional.image_url,
                stock_quantity: r.additional.stock_quantity,
                created_at: r.additional.created_at,
                updated_at: r.additional.updated_at,
                allows_customization: r.additional.allows_customization,
                customizations: r.additional.customizations || [],
                compatible_products: [
                    {
                        product_id: productId,
                        product_name: r.product?.name,
                        custom_price: r.custom_price,
                        is_active: r.is_active,
                    },
                ],
            }));
        }
        catch (error) {
            throw new Error(`Erro ao buscar adicionais do produto: ${error.message}`);
        }
    }
    // Normaliza entrada de produtos compatíveis para o formato esperado
    normalizeCompatibleProducts(products) {
        if (!products)
            return [];
        // Se for array de strings
        if (Array.isArray(products) &&
            products.length > 0 &&
            typeof products[0] === "string") {
            return products.map((p) => ({
                product_id: p,
                custom_price: null,
            }));
        }
        // Caso já seja array de objetos
        return products.map((p) => ({
            product_id: p.product_id,
            custom_price: p.custom_price ?? null,
        }));
    }
    // cores legadas removidas — não há suporte a cores no novo modelo
    normalizePrice(price) {
        if (typeof price === "string") {
            let cleanPrice = price;
            const pointCount = (cleanPrice.match(/\./g) || []).length;
            const commaCount = (cleanPrice.match(/,/g) || []).length;
            if (commaCount === 1 && pointCount === 0) {
                cleanPrice = cleanPrice.replace(",", ".");
            }
            else if (commaCount === 1 && pointCount >= 1) {
                cleanPrice = cleanPrice.replace(/\./g, "").replace(",", ".");
            }
            const normalizedPrice = parseFloat(cleanPrice);
            if (isNaN(normalizedPrice) || normalizedPrice <= 0) {
                throw new Error("Preço inválido: " + cleanPrice);
            }
            return normalizedPrice;
        }
        if (typeof price === "number" && price > 0) {
            return price;
        }
        throw new Error("Preço deve ser um número positivo");
    }
    normalizeDiscount(discount) {
        // Se for null ou undefined, retorna null
        if (discount === null || discount === undefined || discount === "") {
            return null;
        }
        // Se for string, converte para número
        if (typeof discount === "string") {
            const parsed = parseFloat(discount);
            if (isNaN(parsed)) {
                return null;
            }
            // Garante que está entre 0 e 100
            return Math.max(0, Math.min(100, parsed));
        }
        // Se for número, garante que está entre 0 e 100
        if (typeof discount === "number") {
            return Math.max(0, Math.min(100, discount));
        }
        return null;
    }
}
exports.default = new AdditionalService();
