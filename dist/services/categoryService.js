"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class CategoryService {
    async getAllCategories() {
        try {
            return await prisma_1.default.category.findMany({ include: { products: true } });
        }
        catch (error) {
            throw new Error(`Erro ao buscar categorias: ${error.message}`);
        }
    }
    async getCategoryById(id) {
        if (!id) {
            throw new Error("ID da categoria é obrigatório");
        }
        try {
            const category = await prisma_1.default.category.findUnique({
                where: { id },
                include: { products: true },
            });
            if (!category) {
                throw new Error("Categoria não encontrada");
            }
            return category;
        }
        catch (error) {
            if (error.message.includes("não encontrada")) {
                throw error;
            }
            throw new Error(`Erro ao buscar categoria: ${error.message}`);
        }
    }
    async createCategory(data) {
        // Validações de campos obrigatórios
        if (!data.name || data.name.trim() === "") {
            throw new Error("Nome da categoria é obrigatório");
        }
        try {
            // Verifica se já existe uma categoria com o mesmo nome
            const existingCategory = await prisma_1.default.category.findFirst({
                where: { name: data.name.trim() },
            });
            if (existingCategory) {
                throw new Error("Já existe uma categoria com este nome");
            }
            return await prisma_1.default.category.create({
                data: {
                    ...data,
                    name: data.name.trim(),
                },
            });
        }
        catch (error) {
            if (error.message.includes("obrigatório") ||
                error.message.includes("Já existe")) {
                throw error;
            }
            throw new Error(`Erro ao criar categoria: ${error.message}`);
        }
    }
    async updateCategory(id, data) {
        if (!id) {
            throw new Error("ID da categoria é obrigatório");
        }
        // Verifica se a categoria existe
        await this.getCategoryById(id);
        // Validação do nome se fornecido
        if (data.name !== undefined) {
            if (!data.name || data.name.trim() === "") {
                throw new Error("Nome da categoria não pode estar vazio");
            }
            // Verifica se já existe outra categoria com o mesmo nome
            const existingCategory = await prisma_1.default.category.findFirst({
                where: {
                    name: data.name.trim(),
                    id: { not: id },
                },
            });
            if (existingCategory) {
                throw new Error("Já existe uma categoria com este nome");
            }
        }
        try {
            const updateData = { ...data };
            if (updateData.name) {
                updateData.name = updateData.name.trim();
            }
            return await prisma_1.default.category.update({
                where: { id },
                data: updateData,
                include: { products: true },
            });
        }
        catch (error) {
            if (error.message.includes("não encontrada") ||
                error.message.includes("obrigatório") ||
                error.message.includes("Já existe")) {
                throw error;
            }
            throw new Error(`Erro ao atualizar categoria: ${error.message}`);
        }
    }
    async deleteCategory(id) {
        if (!id) {
            throw new Error("ID da categoria é obrigatório");
        }
        // Verifica se a categoria existe
        await this.getCategoryById(id);
        try {
            // Verifica se a categoria tem produtos
            const products = await prisma_1.default.product.count({
                where: { category_id: id },
            });
            if (products > 0) {
                throw new Error("Não é possível deletar categoria que possui produtos");
            }
            await prisma_1.default.category.delete({ where: { id } });
            return { message: "Categoria deletada com sucesso" };
        }
        catch (error) {
            if (error.message.includes("Não é possível deletar") ||
                error.message.includes("não encontrada")) {
                throw error;
            }
            throw new Error(`Erro ao deletar categoria: ${error.message}`);
        }
    }
    // Métodos de compatibilidade com o código existente
    async list() {
        return this.getAllCategories();
    }
    async getById(id) {
        try {
            return await this.getCategoryById(id);
        }
        catch (error) {
            if (error.message.includes("não encontrada")) {
                return null;
            }
            throw error;
        }
    }
    async create(data) {
        return this.createCategory(data);
    }
    async update(id, data) {
        return this.updateCategory(id, data);
    }
    async remove(id) {
        return this.deleteCategory(id);
    }
}
exports.default = new CategoryService();
