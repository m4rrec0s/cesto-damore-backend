import prisma from "../database/prisma";

interface CreateItemInput {
  name: string;
  description?: string;
  stock_quantity: number;
  base_price: number;
  image_url?: string;
  allows_customization?: boolean;
}

interface UpdateItemInput {
  name?: string;
  description?: string;
  stock_quantity?: number;
  base_price?: number;
  image_url?: string;
  allows_customization?: boolean;
}

class ItemService {
  /**
   * Lista todos os itens com paginação
   */
  async listItems(params?: {
    page?: number;
    perPage?: number;
    search?: string;
  }) {
    const page = params?.page || 1;
    const perPage = params?.perPage || 15;
    const search = params?.search;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          additionals: {
            select: {
              custom_price: true,
              is_active: true,
              product: { select: { id: true, name: true, image_url: true } },
            },
          },
          customizations: {
            select: {
              id: true,
              name: true,
              type: true,
              isRequired: true,
              price: true,
            },
          },
          components: {
            select: {
              product_id: true,
              quantity: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
      }),
      prisma.item.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Busca item por ID
   */
  async getItemById(itemId: string) {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        additionals: true,
        customizations: {
          orderBy: { created_at: "asc" },
        },
        components: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                image_url: true,
              },
            },
          },
        },
      },
    });

    if (!item) {
      throw new Error("Item não encontrado");
    }

    return item;
  }

  async getItemsByProductId(productId: string) {
    return prisma.item.findMany({
      where: {
        components: {
          some: {
            product_id: productId,
          },
        },
      },
      include: {
        customizations: {
          orderBy: { created_at: "asc" },
        },
        additionals: {
          select: {
            custom_price: true,
            is_active: true,
            product: { select: { id: true, name: true, image_url: true } },
          },
        },
        components: {
          select: {
            product_id: true,
            quantity: true,
          },
        },
        // Removed legacy 'personalizations' include (table deprecated)
      },
    });
  }

  /**
   * Cria novo item
   */
  async createItem(data: CreateItemInput) {
    // Validações
    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome do item é obrigatório");
    }

    if (data.base_price < 0) {
      throw new Error("Preço base não pode ser negativo");
    }

    if (data.stock_quantity < 0) {
      throw new Error("Quantidade em estoque não pode ser negativa");
    }

    return prisma.item.create({
      data: {
        name: data.name,
        description: data.description,
        stock_quantity: data.stock_quantity,
        base_price: data.base_price,
        image_url: data.image_url,
        allows_customization: data.allows_customization ?? false,
      },
      include: {
        additionals: true,
        customizations: true,
      },
    });
  }

  /**
   * Atualiza item
   */
  async updateItem(itemId: string, data: UpdateItemInput) {
    // Verificar se item existe
    await this.getItemById(itemId);

    // Validações
    if (data.base_price !== undefined && data.base_price < 0) {
      throw new Error("Preço base não pode ser negativo");
    }

    if (data.stock_quantity !== undefined && data.stock_quantity < 0) {
      throw new Error("Quantidade em estoque não pode ser negativa");
    }

    return prisma.item.update({
      where: { id: itemId },
      data,
      include: {
        additionals: true,
        customizations: true,
      },
    });
  }

  /**
   * Deleta item
   */
  async deleteItem(itemId: string) {
    // Verificar se item existe
    await this.getItemById(itemId);

    // Verificar se item está sendo usado em algum produto
    const componentsCount = await prisma.productComponent.count({
      where: { item_id: itemId },
    });

    if (componentsCount > 0) {
      throw new Error(
        "Não é possível deletar item que está sendo usado em produtos"
      );
    }

    return prisma.item.delete({
      where: { id: itemId },
    });
  }

  /**
   * Atualiza estoque do item
   */
  async updateStock(itemId: string, quantity: number) {
    if (quantity < 0) {
      throw new Error("Quantidade não pode ser negativa");
    }

    return prisma.item.update({
      where: { id: itemId },
      data: { stock_quantity: quantity },
    });
  }

  /**
   * Decrementa estoque do item
   */
  async decrementStock(itemId: string, quantity: number) {
    const item = await this.getItemById(itemId);

    if (item.stock_quantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${item.name}. Disponível: ${item.stock_quantity}, Solicitado: ${quantity}`
      );
    }

    return prisma.item.update({
      where: { id: itemId },
      data: {
        stock_quantity: {
          decrement: quantity,
        },
      },
    });
  }

  /**
   * Busca itens que podem ser adicionados a um produto
   */
  async getAvailableItems() {
    return prisma.item.findMany({
      where: {
        stock_quantity: {
          gt: 0,
        },
      },
      include: {
        additionals: {
          select: {
            custom_price: true,
            is_active: true,
            product: { select: { id: true, name: true, image_url: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Busca itens com customizações
   */
  async getItemsWithCustomizations() {
    return prisma.item.findMany({
      where: {
        allows_customization: true,
      },
      include: {
        customizations: {
          orderBy: { created_at: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
  }
}

export default new ItemService();
