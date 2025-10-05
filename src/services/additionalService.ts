import { deleteAdditionalImage } from "../config/localStorage";
import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import { Additional as AdditionalModel } from "../models/Addtional";

// DB shape for Additional as stored by Prisma
interface DBAdditional {
  id: string;
  name: string;
  description: string | null;
  price: number;
  discount: number | null;
  image_url: string | null;
  stock_quantity: number | null;
  created_at: Date;
  updated_at: Date;
}

interface AdditionalColorInfo {
  color_id: string;
  color_name: string;
  color_hex_code: string;
  stock_quantity: number;
}

interface ServiceAdditional extends DBAdditional {
  colors?: AdditionalColorInfo[];
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
  discount?: number;
  image_url?: string | null;
  stock_quantity?: number;
  colors?: Array<{
    color_id: string;
    stock_quantity: number;
  }>;
  compatible_products?:
    | Array<{
        product_id: string;
        custom_price?: number | null;
      }>
    | string[]; // Permite array de strings também
};

type UpdateAdditionalInput = Partial<CreateAdditionalInput>;

class AdditionalService {
  async getAllAdditionals(
    includeProducts = false
  ): Promise<ServiceAdditional[]> {
    try {
      const results = await withRetry(() =>
        prisma.additional.findMany({
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
        })
      );

      return results.map((r: any) => ({
        ...r,
        colors: r.colors?.map((c: any) => ({
          color_id: c.color.id,
          color_name: c.color.name,
          color_hex_code: c.color.hex_code,
          stock_quantity: c.stock_quantity,
        })),
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
      const r = await withRetry(() =>
        prisma.additional.findUnique({
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
        })
      );

      if (!r) {
        throw new Error("Adicional não encontrado");
      }

      return {
        ...r,
        colors: (r as any).colors?.map((c: any) => ({
          color_id: c.color.id,
          color_name: c.color.name,
          color_hex_code: c.color.hex_code,
          stock_quantity: c.stock_quantity,
        })),
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
        discount: data.discount || 0,
        image_url: data.image_url,
        stock_quantity: data.stock_quantity || 0,
      };

      const r = await withRetry(() =>
        prisma.additional.create({ data: payload })
      );

      // Vincular cores se fornecido
      if (data.colors && data.colors.length > 0) {
        await this.linkColors(r.id, data.colors);
      }

      // Vincular aos produtos se fornecido
      if (data.compatible_products && data.compatible_products.length > 0) {
        const normalizedProducts = this.normalizeCompatibleProducts(
          data.compatible_products
        );
        await this.linkToProducts(r.id, normalizedProducts);
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
      if (data.discount !== undefined) payload.discount = data.discount;
      if (data.image_url !== undefined) payload.image_url = data.image_url;
      if (data.stock_quantity !== undefined)
        payload.stock_quantity = data.stock_quantity;

      const r = await withRetry(() =>
        prisma.additional.update({
          where: { id },
          data: payload,
        })
      );

      // Atualizar cores se fornecido
      if (data.colors !== undefined) {
        // Remove todas as cores atuais
        await withRetry(() =>
          prisma.additionalColor.deleteMany({
            where: { additional_id: id },
          })
        );

        // Adiciona as novas cores
        if (data.colors.length > 0) {
          await this.linkColors(id, data.colors);
        }
      }

      if (data.compatible_products !== undefined) {
        await withRetry(() =>
          prisma.productAdditional.deleteMany({
            where: { additional_id: id },
          })
        );

        if (data.compatible_products.length > 0) {
          const normalizedProducts = this.normalizeCompatibleProducts(
            data.compatible_products
          );
          await this.linkToProducts(id, normalizedProducts);
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

    const additional = await this.getAdditionalById(id);

    if (additional.image_url) {
      await deleteAdditionalImage(additional.image_url);
    }

    try {
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
      // Primeiro verifica se o vínculo existe
      const existingLink = await prisma.productAdditional.findUnique({
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

  // Função helper para normalizar compatible_products
  private normalizeCompatibleProducts(
    products:
      | Array<{ product_id: string; custom_price?: number | null }>
      | string[]
  ): Array<{ product_id: string; custom_price?: number | null }> {
    if (!products || products.length === 0) return [];

    // Se o primeiro elemento é string, todo o array é de strings
    if (typeof products[0] === "string") {
      return (products as string[]).map((productId) => ({
        product_id: productId,
        custom_price: null,
      }));
    }

    // Caso contrário, já está no formato correto
    return products as Array<{
      product_id: string;
      custom_price?: number | null;
    }>;
  }

  // Método para vincular cores ao adicional
  private async linkColors(
    additionalId: string,
    colors: Array<{ color_id: string; stock_quantity: number }>
  ) {
    // Verificar se as cores existem
    const validColors = await withRetry(() =>
      prisma.colors.findMany({
        where: { id: { in: colors.map((c) => c.color_id) } },
        select: { id: true },
      })
    );

    const validColorIds = new Set(validColors.map((c) => c.id));
    const dataToInsert = colors
      .filter((c) => validColorIds.has(c.color_id))
      .map((c) => ({
        additional_id: additionalId,
        color_id: c.color_id,
        stock_quantity: c.stock_quantity || 0,
      }));

    if (dataToInsert.length > 0) {
      await withRetry(() =>
        prisma.additionalColor.createMany({
          data: dataToInsert,
          skipDuplicates: true,
        })
      );
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
