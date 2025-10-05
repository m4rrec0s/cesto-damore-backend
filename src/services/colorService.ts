import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";

interface CreateColorInput {
  name: string;
  hex_code: string;
}

interface UpdateColorInput {
  name?: string;
  hex_code?: string;
}

class ColorService {
  async getAllColors() {
    try {
      return await withRetry(() =>
        prisma.colors.findMany({
          orderBy: { name: "asc" },
        })
      );
    } catch (error: any) {
      throw new Error(`Erro ao buscar cores: ${error.message}`);
    }
  }

  async getColorById(id: string) {
    if (!id) {
      throw new Error("ID da cor é obrigatório");
    }

    try {
      const color = await withRetry(() =>
        prisma.colors.findUnique({
          where: { id },
        })
      );

      if (!color) {
        throw new Error("Cor não encontrada");
      }

      return color;
    } catch (error: any) {
      if (error.message.includes("não encontrada")) {
        throw error;
      }
      throw new Error(`Erro ao buscar cor: ${error.message}`);
    }
  }

  async createColor(data: CreateColorInput) {
    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome da cor é obrigatório");
    }
    if (!data.hex_code || !this.isValidHexCode(data.hex_code)) {
      throw new Error("Código hexadecimal inválido");
    }

    try {
      // Verifica se já existe uma cor com este hex_code
      const existing = await prisma.colors.findUnique({
        where: { hex_code: data.hex_code.toUpperCase() },
      });

      if (existing) {
        throw new Error("Já existe uma cor com este código hexadecimal");
      }

      return await withRetry(() =>
        prisma.colors.create({
          data: {
            name: data.name.trim(),
            hex_code: data.hex_code.toUpperCase(),
          },
        })
      );
    } catch (error: any) {
      throw new Error(`Erro ao criar cor: ${error.message}`);
    }
  }

  async updateColor(id: string, data: UpdateColorInput) {
    if (!id) {
      throw new Error("ID da cor é obrigatório");
    }

    // Verifica se existe
    await this.getColorById(id);

    try {
      const updateData: any = {};

      if (data.name !== undefined) updateData.name = data.name.trim();
      if (data.hex_code !== undefined) {
        if (!this.isValidHexCode(data.hex_code)) {
          throw new Error("Código hexadecimal inválido");
        }
        updateData.hex_code = data.hex_code.toUpperCase();
      }

      return await withRetry(() =>
        prisma.colors.update({
          where: { id },
          data: updateData,
        })
      );
    } catch (error: any) {
      throw new Error(`Erro ao atualizar cor: ${error.message}`);
    }
  }

  async deleteColor(id: string) {
    if (!id) {
      throw new Error("ID da cor é obrigatório");
    }

    await this.getColorById(id);

    try {
      await withRetry(() =>
        prisma.colors.delete({
          where: { id },
        })
      );

      return { message: "Cor deletada com sucesso" };
    } catch (error: any) {
      throw new Error(`Erro ao deletar cor: ${error.message}`);
    }
  }

  private isValidHexCode(hex: string): boolean {
    const hexPattern = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexPattern.test(hex);
  }
}

export default new ColorService();
