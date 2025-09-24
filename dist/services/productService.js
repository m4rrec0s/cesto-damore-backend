"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const localStorage_1 = require("../config/localStorage");
class ProductService {
    async getAllProducts(options = {}) {
        const { page = 1, perPage = 15, sort = "name", search, category_id, type_id, } = options;
        const skip = (page - 1) * perPage;
        let orderBy = { name: "asc" };
        if (sort === "updated_at") {
            orderBy = { updated_at: "desc" };
        }
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
            ];
        }
        if (category_id) {
            where.categories = {
                some: {
                    category_id: category_id,
                },
            };
        }
        if (type_id) {
            where.type_id = type_id;
        }
        try {
            const [products, total] = await Promise.all([
                prisma_1.default.product.findMany({
                    skip,
                    take: perPage,
                    orderBy,
                    where,
                    include: {
                        additionals: { include: { additional: true } },
                        categories: { include: { category: true } },
                        type: true,
                    },
                }),
                prisma_1.default.product.count({ where }),
            ]);
            return {
                products: products.map((product) => this.formatProductResponse(product)),
                pagination: {
                    page,
                    perPage,
                    total,
                    totalPages: Math.ceil(total / perPage),
                },
            };
        }
        catch (error) {
            throw new Error(`Erro ao buscar produtos: ${error.message}`);
        }
    }
    async getProductById(id) {
        if (!id) {
            throw new Error("ID do produto é obrigatório");
        }
        try {
            const product = await prisma_1.default.product.findUnique({
                where: { id },
                include: {
                    additionals: { include: { additional: true } },
                    categories: { include: { category: true } },
                    type: true,
                },
            });
            if (!product) {
                throw new Error("Produto não encontrado");
            }
            return this.formatProductResponse(product);
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                throw error;
            }
            throw new Error(`Erro ao buscar produto: ${error.message}`);
        }
    }
    async createProduct(data) {
        if (!data.name || data.name.trim() === "") {
            throw new Error("Nome do produto é obrigatório");
        }
        if (!data.price || data.price <= 0) {
            throw new Error("Preço do produto é obrigatório e deve ser maior que zero");
        }
        if (!data.type_id || data.type_id.trim() === "") {
            throw new Error("Tipo do produto é obrigatório");
        }
        if (!data.categories ||
            !Array.isArray(data.categories) ||
            data.categories.length === 0) {
            throw new Error("Ao menos uma categoria é obrigatória");
        }
        try {
            // Validar se todas as categorias existem
            await this.validateCategories(data.categories);
            const { additionals, categories, ...rest } = data;
            const normalized = { ...rest };
            normalized.price = this.normalizePrice(normalized.price);
            normalized.stock_quantity = this.normalizeStockQuantity(normalized.stock_quantity);
            normalized.is_active = this.normalizeBoolean(normalized.is_active, true);
            const created = await prisma_1.default.product.create({ data: { ...normalized } });
            // Criar as relações com as categorias
            if (categories && categories.length > 0) {
                await Promise.all(categories.map((categoryId) => prisma_1.default.productCategory.create({
                    data: { product_id: created.id, category_id: categoryId },
                })));
            }
            if (Array.isArray(additionals) && additionals.length) {
                await Promise.all(additionals.map((addId) => prisma_1.default.productAdditional.create({
                    data: { product_id: created.id, additional_id: addId },
                })));
            }
            return this.getProductById(created.id);
        }
        catch (error) {
            if (error.message.includes("obrigatório") ||
                error.message.includes("inválido")) {
                throw error;
            }
            throw new Error(`Erro ao criar produto: ${error.message}`);
        }
    }
    async updateProduct(id, data) {
        if (!id) {
            throw new Error("ID do produto é obrigatório");
        }
        // Verifica se o produto existe e obtém dados atuais
        const currentProduct = await this.getProductById(id);
        try {
            const { additionals, categories, ...rest } = data;
            const normalized = { ...rest };
            // Validar categorias se fornecidas
            if (categories &&
                Array.isArray(categories) &&
                categories.length > 0) {
                await this.validateCategories(categories);
            }
            // Normalização de tipos apenas se fornecidos
            if (normalized.price !== undefined) {
                normalized.price = this.normalizePrice(normalized.price);
            }
            if (normalized.stock_quantity !== undefined) {
                normalized.stock_quantity = this.normalizeStockQuantity(normalized.stock_quantity);
            }
            if (normalized.is_active !== undefined) {
                normalized.is_active = this.normalizeBoolean(normalized.is_active);
            }
            if (normalized.image_url &&
                currentProduct.image_url &&
                normalized.image_url !== currentProduct.image_url) {
                await (0, localStorage_1.deleteProductImage)(currentProduct.image_url);
            }
            const updated = await prisma_1.default.product.update({
                where: { id },
                data: { ...normalized },
            });
            // Atualizar categorias se fornecidas
            if (categories && Array.isArray(categories)) {
                await prisma_1.default.productCategory.deleteMany({
                    where: { product_id: id },
                });
                await Promise.all(categories.map((categoryId) => prisma_1.default.productCategory.create({
                    data: { product_id: id, category_id: categoryId },
                })));
            }
            if (Array.isArray(additionals)) {
                await prisma_1.default.productAdditional.deleteMany({
                    where: { product_id: id },
                });
                await Promise.all(additionals.map((addId) => prisma_1.default.productAdditional.create({
                    data: { product_id: id, additional_id: addId },
                })));
            }
            return this.getProductById(id);
        }
        catch (error) {
            if (error.message.includes("não encontrado") ||
                error.message.includes("obrigatório")) {
                throw error;
            }
            throw new Error(`Erro ao atualizar produto: ${error.message}`);
        }
    }
    async deleteProduct(id) {
        if (!id) {
            throw new Error("ID do produto é obrigatório");
        }
        const product = await this.getProductById(id);
        try {
            if (product.image_url) {
                await (0, localStorage_1.deleteProductImage)(product.image_url);
            }
            await prisma_1.default.productAdditional.deleteMany({ where: { product_id: id } });
            await prisma_1.default.productCategory.deleteMany({ where: { product_id: id } });
            await prisma_1.default.product.delete({ where: { id } });
            return { message: "Produto deletado com sucesso" };
        }
        catch (error) {
            throw new Error(`Erro ao deletar produto: ${error.message}`);
        }
    }
    async linkAdditional(productId, additionalId) {
        if (!productId) {
            throw new Error("ID do produto é obrigatório");
        }
        if (!additionalId) {
            throw new Error("ID do adicional é obrigatório");
        }
        try {
            await this.getProductById(productId);
            return await prisma_1.default.productAdditional.create({
                data: { product_id: productId, additional_id: additionalId },
            });
        }
        catch (error) {
            if (error.message.includes("não encontrado") ||
                error.message.includes("obrigatório")) {
                throw error;
            }
            throw new Error(`Erro ao vincular adicional: ${error.message}`);
        }
    }
    async unlinkAdditional(productId, additionalId) {
        if (!productId) {
            throw new Error("ID do produto é obrigatório");
        }
        if (!additionalId) {
            throw new Error("ID do adicional é obrigatório");
        }
        try {
            await prisma_1.default.productAdditional.delete({
                where: {
                    product_id_additional_id: {
                        product_id: productId,
                        additional_id: additionalId,
                    },
                },
            });
            return { message: "Adicional desvinculado com sucesso" };
        }
        catch (error) {
            throw new Error(`Erro ao desvincular adicional: ${error.message}`);
        }
    }
    async validateCategories(categoryIds) {
        if (!categoryIds || categoryIds.length === 0) {
            throw new Error("Lista de categorias não pode estar vazia");
        }
        const existingCategories = await prisma_1.default.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
        });
        if (existingCategories.length !== categoryIds.length) {
            const existingIds = existingCategories.map((cat) => cat.id);
            const invalidIds = categoryIds.filter((id) => !existingIds.includes(id));
            throw new Error(`Categorias não encontradas: ${invalidIds.join(", ")}`);
        }
    }
    formatProductResponse(product) {
        const { categories, ...productData } = product;
        return {
            ...productData,
            categories: categories?.map((pc) => ({
                id: pc.category.id,
                name: pc.category.name,
            })) || [],
        };
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
    normalizeStockQuantity(stock) {
        if (stock === null || stock === undefined || stock === "") {
            return null;
        }
        if (typeof stock === "string") {
            const normalized = parseInt(stock, 10);
            if (isNaN(normalized)) {
                throw new Error("Quantidade em estoque inválida");
            }
            return normalized;
        }
        if (typeof stock === "number") {
            return Math.floor(stock);
        }
        throw new Error("Quantidade em estoque deve ser um número");
    }
    normalizeBoolean(value, defaultValue) {
        if (value === null || value === undefined) {
            return defaultValue ?? false;
        }
        if (typeof value === "string") {
            return ["true", "1", "on", "yes"].includes(value.toLowerCase());
        }
        return Boolean(value);
    }
}
exports.default = new ProductService();
