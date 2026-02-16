import prisma from "../database/prisma";
import logger from "../utils/logger";

interface AddComponentInput {
  product_id: string;
  item_id: string;
  quantity: number;
}

interface UpdateComponentInput {
  quantity: number;
}

class ProductComponentService {
  

  async addComponent(data: AddComponentInput) {

    if (!data.product_id || !data.item_id) {
      throw new Error("Product ID e Item ID são obrigatórios");
    }

    if (data.quantity <= 0) {
      throw new Error("Quantidade deve ser maior que zero");
    }

    const product = await prisma.product.findUnique({
      where: { id: data.product_id },
    });

    if (!product) {
      throw new Error("Produto não encontrado");
    }

    const item = await prisma.item.findUnique({
      where: { id: data.item_id },
    });

    if (!item) {
      throw new Error("Item não encontrado");
    }

    const existing = await prisma.productComponent.findFirst({
      where: {
        product_id: data.product_id,
        item_id: data.item_id,
      },
    });

    if (existing) {
      return existing;
    }

    return prisma.productComponent.create({
      data: {
        product_id: data.product_id,
        item_id: data.item_id,
        quantity: data.quantity,
      },
      include: {
        item: {
          include: {
            customizations: true,
          },
        },
      },
    });
  }

  

  async updateComponent(componentId: string, data: UpdateComponentInput) {
    if (data.quantity <= 0) {
      throw new Error("Quantidade deve ser maior que zero");
    }

    const component = await prisma.productComponent.findUnique({
      where: { id: componentId },
    });

    if (!component) {
      throw new Error("Componente não encontrado");
    }

    return prisma.productComponent.update({
      where: { id: componentId },
      data: { quantity: data.quantity },
      include: {
        item: true,
      },
    });
  }

  

  async removeComponent(componentId: string) {
    const component = await prisma.productComponent.findUnique({
      where: { id: componentId },
    });

    if (!component) {
      throw new Error("Componente não encontrado");
    }

    return prisma.productComponent.delete({
      where: { id: componentId },
    });
  }

  

  async getProductComponents(productId: string, forceRefresh = false) {
    const query = {
      where: { product_id: productId },
      include: {
        item: {
          include: {
            customizations: true,
          },
        },
      },
      orderBy: { created_at: "asc" as const },
    };

    if (forceRefresh) {

      const rows = (await prisma.$queryRawUnsafe(
        `
        SELECT 
          pc.id,
          pc.product_id,
          pc.item_id,
          pc.quantity,
          pc.created_at,
          pc.updated_at,
          json_build_object(
            'id', i.id,
            'name', i.name,
            'stock_quantity', i.stock_quantity,
            'base_price', i.base_price,
            'type', i.type,
            'image_url', i.image_url
          ) as item
        FROM "ProductComponent" pc
        INNER JOIN "Item" i ON i.id = pc.item_id
        WHERE pc.product_id = $1
        ORDER BY pc.created_at ASC
      `,
        productId
      )) as any[];

      return rows.map((row) => ({
        ...row,
        item: typeof row.item === "string" ? JSON.parse(row.item) : row.item,
      }));
    }

    return prisma.productComponent.findMany(query);
  }

  

  async calculateProductStock(productId: string): Promise<number> {
    const components = await prisma.productComponent.findMany({
      where: { product_id: productId },
      include: {
        item: {
          select: {
            stock_quantity: true,
          },
        },
      },
    });

    if (components.length === 0) {
      return 0;
    }

    const availableQuantities = components.map((component) => {
      const stock = component.item.stock_quantity ?? 0;
      return Math.floor(stock / component.quantity);
    });

    return Math.min(...availableQuantities);
  }

  

  async updateProductStock(productId: string) {
    const availableStock = await this.calculateProductStock(productId);

    await prisma.product.update({
      where: { id: productId },
      data: { stock_quantity: availableStock },
    });

    return availableStock;
  }

  

  async decrementComponentsStock(productId: string, productQuantity: number) {
    logger.warn(
      `⚠️ DECREMENTO DE COMPONENTES DESABILITADO - Produto ${productId}, Qtd: ${productQuantity}`
    );
    return;

    

  }

  

  async validateComponentsStock(
    productId: string,
    productQuantity: number
  ): Promise<{ valid: boolean; errors: string[] }> {

    const components = await this.getProductComponents(productId, true);
    const errors: string[] = [];

    for (const component of components) {
      const itemQuantityNeeded = component.quantity * productQuantity;
      const availableStock = component.item.stock_quantity ?? 0;

      if (availableStock < itemQuantityNeeded) {
        errors.push(
          `${component.item.name}: estoque insuficiente. ` +
            `Disponível: ${availableStock}, ` +
            `Necessário: ${itemQuantityNeeded}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  

  async getProductsUsingItem(itemId: string) {
    const components = await prisma.productComponent.findMany({
      where: { item_id: itemId },
      include: {
        product: {
          include: {
            type: true,
            categories: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    return components.map((c) => ({
      ...c.product,
      component_quantity: c.quantity,
    }));
  }
}

export default new ProductComponentService();
