import prisma from "../database/prisma";
import { Additional as AdditionalModel } from "../models/Addtional";

// DB shape for Additional as stored by Prisma
interface DBAdditional {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  compatible_with: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ServiceAdditional extends Omit<DBAdditional, "compatible_with"> {
  compatible_with: string[];
}

type CreateAdditionalInput = {
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  compatible_with?: string[] | string | null;
};

type UpdateAdditionalInput = Partial<CreateAdditionalInput>;

class AdditionalService {
  async getAllAdditionals(): Promise<ServiceAdditional[]> {
    try {
      const results = await prisma.additional.findMany({});
      return results.map((r: DBAdditional) => ({
        ...r,
        compatible_with: this.deserializeCompatible(r.compatible_with),
      }));
    } catch (error: any) {
      throw new Error(`Erro ao buscar adicionais: ${error.message}`);
    }
  }

  async getAdditionalById(id: string): Promise<ServiceAdditional> {
    if (!id) {
      throw new Error("ID do adicional é obrigatório");
    }

    try {
      const r = await prisma.additional.findUnique({ where: { id } });
      if (!r) {
        throw new Error("Adicional não encontrado");
      }

      return {
        ...r,
        compatible_with: this.deserializeCompatible(r.compatible_with),
      } as ServiceAdditional;
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      throw new Error(`Erro ao buscar adicional: ${error.message}`);
    }
  }

  async createAdditional(
    data: CreateAdditionalInput
  ): Promise<ServiceAdditional> {
    // Validações de campos obrigatórios
    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome do adicional é obrigatório");
    }
    if (!data.price || data.price <= 0) {
      throw new Error(
        "Preço do adicional é obrigatório e deve ser maior que zero"
      );
    }

    try {
      const payload: any = {
        name: data.name,
        description: data.description,
        price: this.normalizePrice(data.price),
        image_url: data.image_url,
        compatible_with: this.serializeCompatible(data.compatible_with),
      };

      const r = await prisma.additional.create({ data: payload });

      // Se foi enviado compatible_with, cria as associações na tabela de junção
      if (data.compatible_with) {
        const compatArray = this.deserializeCompatible(data.compatible_with);
        if (compatArray.length) {
          const existing = await prisma.product.findMany({
            where: { id: { in: compatArray } },
            select: { id: true },
          });
          const existingIds = existing.map((p: { id: string }) => p.id);
          if (existingIds.length) {
            await prisma.productAdditional.createMany({
              data: existingIds.map((pid: string) => ({
                product_id: pid,
                additional_id: r.id,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      return {
        ...r,
        compatible_with: this.deserializeCompatible(r.compatible_with),
      } as ServiceAdditional;
    } catch (error: any) {
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido")
      ) {
        throw error;
      }
      throw new Error(`Erro ao criar adicional: ${error.message}`);
    }
  }

  async updateAdditional(
    id: string,
    data: UpdateAdditionalInput
  ): Promise<ServiceAdditional> {
    if (!id) {
      throw new Error("ID do adicional é obrigatório");
    }

    // Verifica se o adicional existe
    await this.getAdditionalById(id);

    try {
      const payload: any = {};
      if (data.name !== undefined) payload.name = data.name;
      if (data.description !== undefined)
        payload.description = data.description;
      if (data.price !== undefined)
        payload.price = this.normalizePrice(data.price);
      if (data.image_url !== undefined) payload.image_url = data.image_url;
      if (data.compatible_with !== undefined) {
        payload.compatible_with = this.serializeCompatible(
          data.compatible_with
        );
      }

      const r = await prisma.additional.update({
        where: { id },
        data: payload,
      });

      // Se foi enviado compatible_with, sincroniza as associações na tabela de junção
      if (data.compatible_with !== undefined) {
        const compatArray = this.deserializeCompatible(data.compatible_with);
        // remove associações antigas
        await prisma.productAdditional.deleteMany({
          where: { additional_id: id },
        });
        if (compatArray.length) {
          const existing = await prisma.product.findMany({
            where: { id: { in: compatArray } },
            select: { id: true },
          });
          const existingIds = existing.map((p: { id: string }) => p.id);
          if (existingIds.length) {
            await prisma.productAdditional.createMany({
              data: existingIds.map((pid: string) => ({
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
        compatible_with: this.deserializeCompatible(r.compatible_with),
      } as ServiceAdditional;
    } catch (error: any) {
      if (
        error.message.includes("não encontrado") ||
        error.message.includes("obrigatório")
      ) {
        throw error;
      }
      throw new Error(`Erro ao atualizar adicional: ${error.message}`);
    }
  }

  async deleteAdditional(id: string) {
    if (!id) {
      throw new Error("ID do adicional é obrigatório");
    }

    // Verifica se o adicional existe
    await this.getAdditionalById(id);

    try {
      // Remove associações na tabela de junção manualmente
      await prisma.productAdditional.deleteMany({
        where: { additional_id: id },
      });
      await prisma.additional.delete({ where: { id } });
      return { message: "Adicional deletado com sucesso" };
    } catch (error: any) {
      throw new Error(`Erro ao deletar adicional: ${error.message}`);
    }
  }

  async linkToProduct(additionalId: string, productId: string) {
    if (!additionalId) {
      throw new Error("ID do adicional é obrigatório");
    }
    if (!productId) {
      throw new Error("ID do produto é obrigatório");
    }

    try {
      // Verifica se o adicional existe
      await this.getAdditionalById(additionalId);

      return await prisma.productAdditional.create({
        data: { additional_id: additionalId, product_id: productId },
      });
    } catch (error: any) {
      if (
        error.message.includes("não encontrado") ||
        error.message.includes("obrigatório")
      ) {
        throw error;
      }
      throw new Error(
        `Erro ao vincular adicional ao produto: ${error.message}`
      );
    }
  }

  async unlinkFromProduct(additionalId: string, productId: string) {
    if (!additionalId) {
      throw new Error("ID do adicional é obrigatório");
    }
    if (!productId) {
      throw new Error("ID do produto é obrigatório");
    }

    try {
      await prisma.productAdditional.delete({
        where: {
          product_id_additional_id: {
            product_id: productId,
            additional_id: additionalId,
          },
        },
      });
      return { message: "Adicional desvinculado do produto com sucesso" };
    } catch (error: any) {
      throw new Error(
        `Erro ao desvincular adicional do produto: ${error.message}`
      );
    }
  }

  // Métodos privados de serialização/deserialização
  private serializeCompatible(value?: string[] | string | null): string | null {
    if (!value) return null;
    if (Array.isArray(value)) return value.join(",");
    return value;
  }

  private deserializeCompatible(value?: string[] | string | null): string[] {
    if (!value) return [] as string[];
    if (Array.isArray(value)) {
      return value.map((s) => String(s).trim()).filter(Boolean);
    }
    return String(value)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private normalizePrice(price: any): number {
    if (typeof price === "string") {
      let cleanPrice = price;
      const pointCount = (cleanPrice.match(/\./g) || []).length;
      const commaCount = (cleanPrice.match(/,/g) || []).length;

      if (commaCount === 1 && pointCount === 0) {
        cleanPrice = cleanPrice.replace(",", ".");
      } else if (commaCount === 1 && pointCount >= 1) {
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

export default new AdditionalService();
export type Additional = AdditionalModel;
