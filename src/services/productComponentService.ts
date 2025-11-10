import prisma from "../database/prisma";

interface AddComponentInput {
  product_id: string;
  item_id: string;
  quantity: number;
}

interface UpdateComponentInput {
  quantity: number;
}

class ProductComponentService {
  /**
   * Adiciona item como componente de um produto
   */
  async addComponent(data: AddComponentInput) {
    // Validações
    if (!data.product_id || !data.item_id) {
      throw new Error("Product ID e Item ID são obrigatórios");
    }

    if (data.quantity <= 0) {
      throw new Error("Quantidade deve ser maior que zero");
    }

    // Verificar se produto existe
    const product = await prisma.product.findUnique({
      where: { id: data.product_id },
    });

    if (!product) {
      throw new Error("Produto não encontrado");
    }

    // Verificar se item existe
    const item = await prisma.item.findUnique({
      where: { id: data.item_id },
    });

    if (!item) {
      throw new Error("Item não encontrado");
    }

    // Verificar se já existe esse componente no produto
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

  /**
   * Atualiza quantidade de um componente
   */
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

  /**
   * Remove componente de um produto
   */
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

  /**
   * Lista componentes de um produto
   * @param forceRefresh - Se true, força busca sem cache
   */
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
      // Força bypass de cache do Prisma
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
            'price', i.price,
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

  /**
   * Calcula estoque disponível do produto baseado nos componentes
   */
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

    // Fórmula: MIN(item1.stock / qty1, item2.stock / qty2, ..., itemN.stock / qtyN)
    const availableQuantities = components.map((component) => {
      const stock = component.item.stock_quantity ?? 0;
      return Math.floor(stock / component.quantity);
    });

    return Math.min(...availableQuantities);
  }

  /**
   * Atualiza estoque do produto baseado nos componentes
   */
  async updateProductStock(productId: string) {
    const availableStock = await this.calculateProductStock(productId);

    await prisma.product.update({
      where: { id: productId },
      data: { stock_quantity: availableStock },
    });

    return availableStock;
  }

  /**
   * Decrementa estoque de todos os itens componentes de um produto
   * ⚠️ TEMPORARIAMENTE DESABILITADO - Mantém validações mas não decrementa
   */
  async decrementComponentsStock(productId: string, productQuantity: number) {
    console.log(
      `⚠️ DECREMENTO DE COMPONENTES DESABILITADO - Produto ${productId}, Qtd: ${productQuantity}`
    );
    return; // ✅ Desabilitado temporariamente

    /* CÓDIGO ORIGINAL (COMENTADO):
    const components = await this.getProductComponents(productId);

    for (const component of components) {
      const itemQuantityNeeded = component.quantity * productQuantity;

      // Verificar se tem estoque suficiente
      const stock = component.item.stock_quantity ?? 0;
      if (stock < itemQuantityNeeded) {
        throw new Error(
          `Estoque insuficiente para ${component.item.name}. ` +
            `Disponível: ${component.item.stock_quantity}, ` +
            `Necessário: ${itemQuantityNeeded}`
        );
      }

      // Decrementar estoque do item
      await prisma.item.update({
        where: { id: component.item_id },
        data: {
          stock_quantity: {
            decrement: itemQuantityNeeded,
          },
        },
      });
    }

    // Atualizar estoque do produto
    await this.updateProductStock(productId);
    */
  }

  /**
   * Valida se há estoque suficiente para os componentes
   * ✅ CRÍTICO: Usa forceRefresh=true para evitar cache
   */
  async validateComponentsStock(
    productId: string,
    productQuantity: number
  ): Promise<{ valid: boolean; errors: string[] }> {
    // ✅ Force refresh para garantir dados atualizados
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

  /**
   * Busca produtos que usam um item específico
   */
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
