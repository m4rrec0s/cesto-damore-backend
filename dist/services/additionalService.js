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
            const results = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.findMany({
                include: {
                    colors: {
                        include: {
                            color: true,
                        },
                    },
                    ...(includeProducts
                        ? {
                            products: {
                                include: {
                                    product: {
                                        select: { id: true, name: true },
                                    },
                                },
                                where: { is_active: true },
                            },
                        }
                        : {}),
                },
            }));
            return results.map((r) => ({
                ...r,
                colors: r.colors?.map((c) => ({
                    color_id: c.color.id,
                    color_name: c.color.name,
                    color_hex_code: c.color.hex_code,
                    stock_quantity: c.stock_quantity,
                })),
                compatible_products: r.products?.map((p) => ({
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
            const r = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.findUnique({
                where: { id },
                include: {
                    colors: {
                        include: {
                            color: true,
                        },
                    },
                    ...(includeProducts
                        ? {
                            products: {
                                include: {
                                    product: {
                                        select: { id: true, name: true },
                                    },
                                },
                                where: { is_active: true },
                            },
                        }
                        : {}),
                },
            }));
            if (!r) {
                throw new Error("Adicional não encontrado");
            }
            return {
                ...r,
                colors: r.colors?.map((c) => ({
                    color_id: c.color.id,
                    color_name: c.color.name,
                    color_hex_code: c.color.hex_code,
                    stock_quantity: c.stock_quantity,
                })),
                compatible_products: r.products?.map((p) => ({
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
                price: this.normalizePrice(data.price),
                discount: data.discount || 0,
                image_url: data.image_url,
                stock_quantity: data.stock_quantity || 0,
            };
            const r = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.create({ data: payload }));
            // Vincular cores se fornecido
            if (data.colors && data.colors.length > 0) {
                await this.linkColors(r.id, data.colors);
            }
            // Vincular aos produtos se fornecido
            if (data.compatible_products && data.compatible_products.length > 0) {
                const normalizedProducts = this.normalizeCompatibleProducts(data.compatible_products);
                await this.linkToProducts(r.id, normalizedProducts);
            }
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
                payload.price = this.normalizePrice(data.price);
            if (data.discount !== undefined)
                payload.discount = data.discount;
            if (data.image_url !== undefined)
                payload.image_url = data.image_url;
            if (data.stock_quantity !== undefined)
                payload.stock_quantity = data.stock_quantity;
            const r = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additional.update({
                where: { id },
                data: payload,
            }));
            // Atualizar cores se fornecido
            if (data.colors !== undefined) {
                // Remove todas as cores atuais
                await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additionalColor.deleteMany({
                    where: { additional_id: id },
                }));
                // Adiciona as novas cores
                if (data.colors.length > 0) {
                    await this.linkColors(id, data.colors);
                }
            }
            if (data.compatible_products !== undefined) {
                await (0, prismaRetry_1.withRetry)(() => prisma_1.default.productAdditional.deleteMany({
                    where: { additional_id: id },
                }));
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
            await prisma_1.default.additional.delete({ where: { id } });
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
            // Verifica se o adicional existe
            await this.getAdditionalById(additionalId);
            // Verifica se o produto existe
            const product = await prisma_1.default.product.findUnique({
                where: { id: productId },
                select: { id: true },
            });
            if (!product) {
                throw new Error("Produto não encontrado");
            }
            return await prisma_1.default.productAdditional.create({
                data: {
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
        if (!additionalId) {
            throw new Error("ID do adicional é obrigatório");
        }
        if (!productId) {
            throw new Error("ID do produto é obrigatório");
        }
        try {
            // Primeiro verifica se o vínculo existe
            const existingLink = await prisma_1.default.productAdditional.findUnique({
                where: {
                    product_id_additional_id: {
                        product_id: productId,
                        additional_id: additionalId,
                    },
                },
            });
            if (!existingLink) {
                throw new Error("Vínculo entre produto e adicional não encontrado");
            }
            // Se existe, então remove
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
            const additional = await prisma_1.default.additional.findUnique({
                where: { id: additionalId },
                select: { price: true },
            });
            if (!additional) {
                throw new Error("Adicional não encontrado");
            }
            // Se tem produto específico, busca o preço customizado
            if (productId) {
                const productAdditional = await prisma_1.default.productAdditional.findUnique({
                    where: {
                        product_id_additional_id: {
                            product_id: productId,
                            additional_id: additionalId,
                        },
                    },
                    select: { custom_price: true, is_active: true },
                });
                // Se existe vínculo ativo e tem preço customizado, usa ele
                if (productAdditional?.is_active &&
                    productAdditional.custom_price !== null) {
                    return productAdditional.custom_price;
                }
            }
            // Caso contrário, usa o preço base
            return additional.price;
        }
        catch (error) {
            throw new Error(`Erro ao buscar preço do adicional: ${error.message}`);
        }
    }
    // Método para buscar adicionais compatíveis com um produto
    async getAdditionalsByProduct(productId) {
        if (!productId) {
            throw new Error("ID do produto é obrigatório");
        }
        try {
            const results = await prisma_1.default.additional.findMany({
                where: {
                    products: {
                        some: {
                            product_id: productId,
                            is_active: true,
                        },
                    },
                },
                include: {
                    products: {
                        where: { product_id: productId },
                        select: {
                            custom_price: true,
                            is_active: true,
                            product: {
                                select: { id: true, name: true },
                            },
                        },
                    },
                },
            });
            return results.map((r) => ({
                ...r,
                compatible_products: r.products.map((p) => ({
                    product_id: p.product.id,
                    product_name: p.product.name,
                    custom_price: p.custom_price,
                    is_active: p.is_active,
                })),
            }));
        }
        catch (error) {
            throw new Error(`Erro ao buscar adicionais do produto: ${error.message}`);
        }
    }
    // Função helper para normalizar compatible_products
    normalizeCompatibleProducts(products) {
        if (!products || products.length === 0)
            return [];
        // Se o primeiro elemento é string, todo o array é de strings
        if (typeof products[0] === "string") {
            return products.map((productId) => ({
                product_id: productId,
                custom_price: null,
            }));
        }
        // Caso contrário, já está no formato correto
        return products;
    }
    // Método para vincular cores ao adicional
    async linkColors(additionalId, colors) {
        // Verificar se as cores existem
        const validColors = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.colors.findMany({
            where: { id: { in: colors.map((c) => c.color_id) } },
            select: { id: true },
        }));
        const validColorIds = new Set(validColors.map((c) => c.id));
        const dataToInsert = colors
            .filter((c) => validColorIds.has(c.color_id))
            .map((c) => ({
            additional_id: additionalId,
            color_id: c.color_id,
            stock_quantity: c.stock_quantity || 0,
        }));
        if (dataToInsert.length > 0) {
            await (0, prismaRetry_1.withRetry)(() => prisma_1.default.additionalColor.createMany({
                data: dataToInsert,
                skipDuplicates: true,
            }));
        }
    }
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
}
exports.default = new AdditionalService();
