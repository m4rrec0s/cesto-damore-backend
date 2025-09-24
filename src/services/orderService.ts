import prisma from "../database/prisma";

type CreateOrderItem = {
  product_id: string;
  quantity: number;
  price: number;
  additionals?: { additional_id: string; quantity: number; price: number }[];
};

type CreateOrderInput = {
  user_id: string;
  total_price: number;
  delivery_address?: string | null;
  delivery_date?: Date | null;
  items: CreateOrderItem[];
};

class OrderService {
  async getAllOrders() {
    try {
      return await prisma.order.findMany({
        include: {
          items: { include: { additionals: true, product: true } },
          user: true,
        },
      });
    } catch (error: any) {
      throw new Error(`Erro ao buscar pedidos: ${error.message}`);
    }
  }

  async getOrderById(id: string) {
    if (!id) {
      throw new Error("ID do pedido é obrigatório");
    }

    try {
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          items: { include: { additionals: true, product: true } },
          user: true,
        },
      });

      if (!order) {
        throw new Error("Pedido não encontrado");
      }

      return order;
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      throw new Error(`Erro ao buscar pedido: ${error.message}`);
    }
  }

  async createOrder(data: CreateOrderInput) {
    if (!data.user_id || data.user_id.trim() === "") {
      throw new Error("ID do usuário é obrigatório");
    }
    if (!data.total_price || data.total_price <= 0) {
      throw new Error("Preço total é obrigatório e deve ser maior que zero");
    }
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("Pelo menos um item é obrigatório");
    }

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item.product_id || item.product_id.trim() === "") {
        throw new Error(`Item ${i + 1}: ID do produto é obrigatório`);
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new Error(`Item ${i + 1}: Quantidade deve ser maior que zero`);
      }
      if (!item.price || item.price <= 0) {
        throw new Error(`Item ${i + 1}: Preço deve ser maior que zero`);
      }
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: data.user_id },
      });
      if (!user) {
        throw new Error("Usuário não encontrado");
      }

      const productIds = data.items.map((item) => item.product_id);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });

      if (products.length !== productIds.length) {
        throw new Error("Um ou mais produtos não foram encontrados");
      }

      const { items, ...orderData } = data;
      const created = await prisma.order.create({ data: { ...orderData } });

      for (const item of items) {
        const orderItem = await prisma.orderItem.create({
          data: {
            order_id: created.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
          },
        });

        if (Array.isArray(item.additionals) && item.additionals.length > 0) {
          for (const additional of item.additionals) {
            await prisma.orderItemAdditional.create({
              data: {
                order_item_id: orderItem.id,
                additional_id: additional.additional_id,
                quantity: additional.quantity,
                price: additional.price,
              },
            });
          }
        }
      }

      return await this.getOrderById(created.id);
    } catch (error: any) {
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("não encontrado") ||
        error.message.includes("deve ser maior")
      ) {
        throw error;
      }
      throw new Error(`Erro ao criar pedido: ${error.message}`);
    }
  }

  async deleteOrder(id: string) {
    if (!id) {
      throw new Error("ID do pedido é obrigatório");
    }

    // Verifica se o pedido existe
    await this.getOrderById(id);

    try {
      // Remove em cascata: adicionais dos itens, itens e pedido
      const items = await prisma.orderItem.findMany({
        where: { order_id: id },
      });
      for (const item of items) {
        await prisma.orderItemAdditional.deleteMany({
          where: { order_item_id: item.id },
        });
      }
      await prisma.orderItem.deleteMany({ where: { order_id: id } });
      await prisma.order.delete({ where: { id } });

      return { message: "Pedido deletado com sucesso" };
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      throw new Error(`Erro ao deletar pedido: ${error.message}`);
    }
  }

  // Métodos de compatibilidade com o código existente
  async list() {
    return this.getAllOrders();
  }

  async getById(id: string) {
    try {
      return await this.getOrderById(id);
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        return null;
      }
      throw error;
    }
  }

  async create(data: CreateOrderInput) {
    return this.createOrder(data);
  }

  async remove(id: string) {
    return this.deleteOrder(id);
  }
}

export default new OrderService();
