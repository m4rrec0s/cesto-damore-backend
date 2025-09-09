import prisma from "../database/prisma";

class TypeService {
  async getAllTypes() {
    try {
      return await prisma.productType.findMany({ include: { products: true } });
    } catch (error: any) {
      throw new Error(`Erro ao buscar tipos: ${error.message}`);
    }
  }

  async getTypeById(id: string) {
    if (!id) {
      throw new Error("ID do tipo é obrigatório");
    }

    try {
      const type = await prisma.productType.findUnique({
        where: { id },
        include: { products: true },
      });

      if (!type) {
        throw new Error("Tipo não encontrado");
      }

      return type;
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      throw new Error(`Erro ao buscar tipo: ${error.message}`);
    }
  }

  async createType(data: { name: string }) {
    // Validações de campos obrigatórios
    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome do tipo é obrigatório");
    }

    try {
      // Verifica se já existe um tipo com o mesmo nome
      const existingType = await prisma.productType.findFirst({
        where: { name: data.name.trim() },
      });

      if (existingType) {
        throw new Error("Já existe um tipo com este nome");
      }

      return await prisma.productType.create({
        data: {
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
      throw new Error(`Erro ao criar tipo: ${error.message}`);
    }
  }

  async updateType(id: string, data: Partial<{ name: string }>) {
    if (!id) {
      throw new Error("ID do tipo é obrigatório");
    }

    // Verifica se o tipo existe
    await this.getTypeById(id);

    // Validação do nome se fornecido
    if (data.name !== undefined) {
      if (!data.name || data.name.trim() === "") {
        throw new Error("Nome do tipo não pode estar vazio");
      }

      // Verifica se já existe outro tipo com o mesmo nome
      const existingType = await prisma.productType.findFirst({
        where: {
          name: data.name.trim(),
          id: { not: id },
        },
      });

      if (existingType) {
        throw new Error("Já existe um tipo com este nome");
      }
    }

    try {
      const updateData = { ...data };
      if (updateData.name) {
        updateData.name = updateData.name.trim();
      }

      return await prisma.productType.update({
        where: { id },
        data: updateData,
        include: { products: true },
      });
    } catch (error: any) {
      if (
        error.message.includes("não encontrado") ||
        error.message.includes("obrigatório") ||
        error.message.includes("Já existe")
      ) {
        throw error;
      }
      throw new Error(`Erro ao atualizar tipo: ${error.message}`);
    }
  }

  async deleteType(id: string) {
    if (!id) {
      throw new Error("ID do tipo é obrigatório");
    }

    // Verifica se o tipo existe
    await this.getTypeById(id);

    try {
      // Verifica se o tipo tem produtos
      const products = await prisma.product.count({ where: { type_id: id } });
      if (products > 0) {
        throw new Error("Não é possível deletar tipo que possui produtos");
      }

      await prisma.productType.delete({ where: { id } });
      return { message: "Tipo deletado com sucesso" };
    } catch (error: any) {
      if (
        error.message.includes("Não é possível deletar") ||
        error.message.includes("não encontrado")
      ) {
        throw error;
      }
      throw new Error(`Erro ao deletar tipo: ${error.message}`);
    }
  }

  // Métodos de compatibilidade com o código existente
  async list() {
    return this.getAllTypes();
  }

  async getById(id: string) {
    try {
      return await this.getTypeById(id);
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        return null;
      }
      throw error;
    }
  }

  async create(data: { name: string }) {
    return this.createType(data);
  }

  async update(id: string, data: Partial<{ name: string }>) {
    return this.updateType(id, data);
  }

  async remove(id: string) {
    return this.deleteType(id);
  }
}

export default new TypeService();
