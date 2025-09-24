import prisma from "../database/prisma";
import { CreateCategoryInput } from "../models/Category";

class CategoryService {
  async getAllCategories() {
    try {
      return await prisma.category.findMany({ include: { products: true } });
    } catch (error: any) {
      throw new Error(`Erro ao buscar categorias: ${error.message}`);
    }
  }

  async getCategoryById(id: string) {
    if (!id) {
      throw new Error("ID da categoria é obrigatório");
    }

    try {
      const category = await prisma.category.findUnique({
        where: { id },
        include: { products: true },
      });

      if (!category) {
        throw new Error("Categoria não encontrada");
      }

      return category;
    } catch (error: any) {
      if (error.message.includes("não encontrada")) {
        throw error;
      }
      throw new Error(`Erro ao buscar categoria: ${error.message}`);
    }
  }

  async createCategory(data: CreateCategoryInput) {
    // Validações de campos obrigatórios
    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome da categoria é obrigatório");
    }

    try {
      // Verifica se já existe uma categoria com o mesmo nome
      const existingCategory = await prisma.category.findFirst({
        where: { name: data.name.trim() },
      });

      if (existingCategory) {
        throw new Error("Já existe uma categoria com este nome");
      }

      return await prisma.category.create({
        data: {
          ...data,
          name: data.name.trim(),
        },
      });
    } catch (error: any) {
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("Já existe")
      ) {
        throw error;
      }
      throw new Error(`Erro ao criar categoria: ${error.message}`);
    }
  }

  async updateCategory(id: string, data: Partial<CreateCategoryInput>) {
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
      const existingCategory = await prisma.category.findFirst({
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

      return await prisma.category.update({
        where: { id },
        data: updateData,
        include: { products: true },
      });
    } catch (error: any) {
      if (
        error.message.includes("não encontrada") ||
        error.message.includes("obrigatório") ||
        error.message.includes("Já existe")
      ) {
        throw error;
      }
      throw new Error(`Erro ao atualizar categoria: ${error.message}`);
    }
  }

  async deleteCategory(id: string) {
    if (!id) {
      throw new Error("ID da categoria é obrigatório");
    }

    // Verifica se a categoria existe
    await this.getCategoryById(id);

    try {
      // Verifica se a categoria tem produtos
      const products = await prisma.product.count({
        where: { categories: { some: { category_id: id } } },
      });
      if (products > 0) {
        throw new Error("Não é possível deletar categoria que possui produtos");
      }

      await prisma.category.delete({ where: { id } });
      return { message: "Categoria deletada com sucesso" };
    } catch (error: any) {
      if (
        error.message.includes("Não é possível deletar") ||
        error.message.includes("não encontrada")
      ) {
        throw error;
      }
      throw new Error(`Erro ao deletar categoria: ${error.message}`);
    }
  }

  // Métodos de compatibilidade com o código existente
  async list() {
    return this.getAllCategories();
  }

  async getById(id: string) {
    try {
      return await this.getCategoryById(id);
    } catch (error: any) {
      if (error.message.includes("não encontrada")) {
        return null;
      }
      throw error;
    }
  }

  async create(data: CreateCategoryInput) {
    return this.createCategory(data);
  }

  async update(id: string, data: Partial<CreateCategoryInput>) {
    return this.updateCategory(id, data);
  }

  async remove(id: string) {
    return this.deleteCategory(id);
  }
}

export default new CategoryService();
