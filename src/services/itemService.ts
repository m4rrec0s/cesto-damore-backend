import prisma from "../database/prisma";

interface CreateItemInput {
  name: string;
  description?: string;
  stock_quantity: number;
  base_price: number;
  image_url?: string;
  allows_customization?: boolean;
  additional_id?: string;
}

interface UpdateItemInput {
  name?: string;
  description?: string;
  stock_quantity?: number;
  base_price?: number;
  image_url?: string;
  allows_customization?: boolean;
  additional_id?: string;
}

class ItemService {
  /**
   * Lista todos os itens
   */
  async listItems() {
    return prisma.item.findMany({
      include: {
        additional: {
          select: {
            id: true,
            name: true,
            image_url: true,
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
    });
  }

  /**
   * Busca item por ID
   */
  async getItemById(itemId: string) {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        additional: true,
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

    // Se tem additional_id, verificar se existe
    if (data.additional_id) {
      const additional = await prisma.additional.findUnique({
        where: { id: data.additional_id },
      });

      if (!additional) {
        throw new Error("Adicional não encontrado");
      }
    }

    return prisma.item.create({
      data: {
        name: data.name,
        description: data.description,
        stock_quantity: data.stock_quantity,
        base_price: data.base_price,
        image_url: data.image_url,
        allows_customization: data.allows_customization ?? false,
        additional_id: data.additional_id,
      },
      include: {
        additional: true,
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

    // Se está atualizando additional_id, verificar se existe
    if (data.additional_id) {
      const additional = await prisma.additional.findUnique({
        where: { id: data.additional_id },
      });

      if (!additional) {
        throw new Error("Adicional não encontrado");
      }
    }

    return prisma.item.update({
      where: { id: itemId },
      data,
      include: {
        additional: true,
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
        additional: {
          select: {
            id: true,
            name: true,
            image_url: true,
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
