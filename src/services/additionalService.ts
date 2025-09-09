import prisma from "../database/prisma";
import { Additional as AdditionalModel } from "../models/Addtional";

// DB shape for Additional as stored by Prisma
interface DBAdditional {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ServiceAdditional extends DBAdditional {
  compatible_products?: Array<{
    product_id: string;
    product_name: string;
    custom_price: number | null;
    is_active: boolean;
  }>;
}

type CreateAdditionalInput = {
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  compatible_products?: Array<{
    product_id: string;
    custom_price?: number | null;
  }>;
};

type UpdateAdditionalInput = Partial<CreateAdditionalInput>;

class AdditionalService {
  async getAllAdditionals(
    includeProducts = false
  ): Promise<ServiceAdditional[]> {
    try {
      const results = await prisma.additional.findMany({
        include: includeProducts
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
          : undefined,
      });

      return results.map((r: any) => ({
        ...r,
        compatible_products:
          r.products?.map((p: any) => ({
            product_id: p.product.id,
            product_name: p.product.name,
            custom_price: p.custom_price,
            is_active: p.is_active,
          })) || undefined,
      }));
    } catch (error: any) {
      throw new Error(`Erro ao buscar adicionais: ${error.message}`);
    }
  }

  async getAdditionalById(
    id: string,
    includeProducts = false
  ): Promise<ServiceAdditional> {
    if (!id) {
      throw new Error("ID do adicional é obrigatório");
    }

    try {
      const r = await prisma.additional.findUnique({
        where: { id },
        include: includeProducts
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
          : undefined,
      });

      if (!r) {
        throw new Error("Adicional não encontrado");
      }

      return {
        ...r,
        compatible_products:
          (r as any).products?.map((p: any) => ({
            product_id: p.product.id,
            product_name: p.product.name,
            custom_price: p.custom_price,
            is_active: p.is_active,
          })) || undefined,
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
      };

      const r = await prisma.additional.create({ data: payload });

      // Vincular aos produtos se fornecido
      if (data.compatible_products && data.compatible_products.length > 0) {
        await this.linkToProducts(r.id, data.compatible_products);
      }

      return await this.getAdditionalById(r.id, true);
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

    await this.getAdditionalById(id);

    try {
      const payload: any = {};
      if (data.name !== undefined) payload.name = data.name;
      if (data.description !== undefined)
        payload.description = data.description;
      if (data.price !== undefined)
        payload.price = this.normalizePrice(data.price);
      if (data.image_url !== undefined) payload.image_url = data.image_url;

      const r = await prisma.additional.update({
        where: { id },
        data: payload,
      });

      // Atualizar produtos compatíveis se fornecido
      if (data.compatible_products !== undefined) {
        // Remove todas as associações antigas
        await prisma.productAdditional.deleteMany({
          where: { additional_id: id },
        });

        // Adiciona as novas associações
        if (data.compatible_products.length > 0) {
          await this.linkToProducts(id, data.compatible_products);
        }
      }

      return await this.getAdditionalById(id, true);
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

  async linkToProduct(
    additionalId: string,
    productId: string,
    customPrice?: number | null
  ) {
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
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });

      if (!product) {
        throw new Error("Produto não encontrado");
      }

      return await prisma.productAdditional.create({
        data: {
          additional_id: additionalId,
          product_id: productId,
          custom_price: customPrice || null,
        },
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

  async updateProductLink(
    additionalId: string,
    productId: string,
    customPrice?: number | null
  ) {
    if (!additionalId) {
      throw new Error("ID do adicional é obrigatório");
    }
    if (!productId) {
      throw new Error("ID do produto é obrigatório");
    }

    try {
      return await prisma.productAdditional.update({
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
    } catch (error: any) {
      throw new Error(
        `Erro ao atualizar vínculo do adicional: ${error.message}`
      );
    }
  }

  private async linkToProducts(
    additionalId: string,
    products: Array<{ product_id: string; custom_price?: number | null }>
  ) {
    const validProducts = await prisma.product.findMany({
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
      await prisma.productAdditional.createMany({
        data: dataToInsert,
        skipDuplicates: true,
      });
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

  // Método para buscar o preço correto do adicional
  async getAdditionalPrice(
    additionalId: string,
    productId?: string
  ): Promise<number> {
    if (!additionalId) {
      throw new Error("ID do adicional é obrigatório");
    }

    try {
      const additional = await prisma.additional.findUnique({
        where: { id: additionalId },
        select: { price: true },
      });

      if (!additional) {
        throw new Error("Adicional não encontrado");
      }

      // Se tem produto específico, busca o preço customizado
      if (productId) {
        const productAdditional = await prisma.productAdditional.findUnique({
          where: {
            product_id_additional_id: {
              product_id: productId,
              additional_id: additionalId,
            },
          },
          select: { custom_price: true, is_active: true },
        });

        // Se existe vínculo ativo e tem preço customizado, usa ele
        if (
          productAdditional?.is_active &&
          productAdditional.custom_price !== null
        ) {
          return productAdditional.custom_price;
        }
      }

      // Caso contrário, usa o preço base
      return additional.price;
    } catch (error: any) {
      throw new Error(`Erro ao buscar preço do adicional: ${error.message}`);
    }
  }

  // Método para buscar adicionais compatíveis com um produto
  async getAdditionalsByProduct(
    productId: string
  ): Promise<ServiceAdditional[]> {
    if (!productId) {
      throw new Error("ID do produto é obrigatório");
    }

    try {
      const results = await prisma.additional.findMany({
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

      return results.map((r: any) => ({
        ...r,
        compatible_products: r.products.map((p: any) => ({
          product_id: p.product.id,
          product_name: p.product.name,
          custom_price: p.custom_price,
          is_active: p.is_active,
        })),
      }));
    } catch (error: any) {
      throw new Error(`Erro ao buscar adicionais do produto: ${error.message}`);
    }
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
