import prisma from "../database/prisma";
import stockService from "./stockService";
import whatsappService from "./whatsappService";
import productComponentService from "./productComponentService";
import customerManagementService from "./customerManagementService";

const ORDER_STATUSES = [
  "PENDING",
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "CANCELED",
] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];

interface OrderFilter {
  status?: string;
}

interface UpdateStatusOptions {
  notifyCustomer?: boolean;
}

type CreateOrderItem = {
  product_id: string;
  quantity: number;
  price: number;
  additionals?: {
    additional_id: string;
    quantity: number;
    price: number;
  }[];
  customizations?: {
    customization_id?: string;
    customization_type?: string;
    title?: string;
    customization_data?: any;
  }[];
};

type CreateOrderInput = {
  user_id: string;
  discount?: number;
  payment_method: "pix" | "card";
  delivery_address?: string | null;
  delivery_city: string;
  delivery_state: string;
  delivery_date?: Date | null;
  recipient_phone: string; // Número do destinatário (obrigatório)
  items: CreateOrderItem[];
};

const ACCEPTED_CITIES: Record<string, { pix: number; card: number }> = {
  "campina grande": { pix: 0, card: 10 },
  queimadas: { pix: 15, card: 25 },
  galante: { pix: 15, card: 25 },
  puxinana: { pix: 15, card: 25 },
  "sao jose da mata": { pix: 15, card: 25 },
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

class OrderService {
  // Enriquece as customizações com labels das opções selecionadas
  private enrichCustomizations(orders: any[]) {
    return orders.map((order) => ({
      ...order,
      items: order.items.map((item: any) => ({
        ...item,
        customizations: item.customizations.map((customization: any) => {
          try {
            const customData = JSON.parse(customization.value || "{}");

            // Se tem selected_option mas não tem label, buscar do customization_data
            if (
              customData.selected_option &&
              !customData.selected_option_label &&
              customization.customization?.customization_data
            ) {
              const customizationData =
                customization.customization.customization_data;
              const options = customizationData.options || [];

              // Encontrar a opção selecionada
              const selectedOption = options.find(
                (opt: any) => opt.id === customData.selected_option
              );

              if (selectedOption) {
                customData.selected_option_label =
                  selectedOption.label || selectedOption.name;
              }
            }

            return {
              ...customization,
              value: JSON.stringify(customData),
            };
          } catch (error) {
            console.error(
              "Erro ao enriquecer customização:",
              customization.id,
              error
            );
            return customization;
          }
        }),
      })),
    }));
  }

  private normalizeStatus(status: string): OrderStatus {
    const normalized = status?.trim().toUpperCase();
    if (!ORDER_STATUSES.includes(normalized as OrderStatus)) {
      throw new Error(
        `Status inválido. Utilize um dos seguintes: ${ORDER_STATUSES.join(
          ", "
        )}`
      );
    }
    return normalized as OrderStatus;
  }

  private buildStatusWhere(filter?: OrderFilter) {
    if (!filter?.status) return undefined;

    const normalized = filter.status.trim().toLowerCase();

    if (normalized === "open" || normalized === "abertos") {
      return {
        in: ["PENDING", "PAID", "SHIPPED"] as OrderStatus[],
      };
    }

    if (normalized === "closed" || normalized === "fechados") {
      return {
        in: ["DELIVERED", "CANCELED"] as OrderStatus[],
      };
    }

    return {
      equals: this.normalizeStatus(filter.status),
    };
  }

  async getAllOrders(filter?: OrderFilter) {
    try {
      const orders = await prisma.order.findMany({
        include: {
          items: {
            include: {
              additionals: {
                include: {
                  additional: true,
                },
              },
              product: true,
              customizations: {
                include: {
                  customization: true, // Incluir os dados da customização
                },
              },
            },
          },
          user: true,
          payment: true,
        },
        where: {
          status: this.buildStatusWhere(filter),
        },
        orderBy: {
          created_at: "desc",
        },
      });

      // Enriquecer customizações com labels das opções
      return this.enrichCustomizations(orders);
    } catch (error: any) {
      throw new Error(`Erro ao buscar pedidos: ${error.message}`);
    }
  }

  async getOrdersByUserId(userId: string) {
    if (!userId) {
      throw new Error("ID do usuário é obrigatório");
    }

    const orders = await prisma.order.findMany({
      where: { user_id: userId },
      include: {
        items: {
          include: {
            additionals: {
              include: {
                additional: true,
              },
            },
            product: true,
            customizations: {
              include: {
                customization: true, // Incluir os dados da customização
              },
            },
          },
        },
        user: true,
        payment: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return this.enrichCustomizations(orders);
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
          payment: true, // ✅ CRÍTICO: Incluir payment para o polling funcionar
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
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("Pelo menos um item é obrigatório");
    }

    if (!data.recipient_phone || data.recipient_phone.trim() === "") {
      throw new Error("Número do destinatário é obrigatório");
    }

    let phoneDigits = data.recipient_phone.replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      throw new Error("Número do destinatário deve ter entre 10 e 13 dígitos");
    }

    if (!phoneDigits.startsWith("55")) {
      phoneDigits = "55" + phoneDigits;
    }

    const paymentMethod = normalizeText(data.payment_method);
    if (paymentMethod !== "pix" && paymentMethod !== "card") {
      throw new Error("Forma de pagamento inválida. Utilize pix ou card");
    }

    if (!data.delivery_city || !data.delivery_state) {
      throw new Error("Cidade e estado de entrega são obrigatórios");
    }

    const normalizedCity = normalizeText(data.delivery_city);
    const shippingRules = ACCEPTED_CITIES[normalizedCity];
    if (!shippingRules) {
      throw new Error("Ainda não fazemos entrega nesse endereço");
    }

    const normalizedState = normalizeText(data.delivery_state);
    if (normalizedState !== "pb" && normalizedState !== "paraiba") {
      throw new Error("Atualmente só entregamos na Paraíba (PB)");
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

      if (Array.isArray(item.additionals)) {
        for (let j = 0; j < item.additionals.length; j++) {
          const additional = item.additionals[j];
          if (
            !additional.additional_id ||
            additional.additional_id.trim() === ""
          ) {
            throw new Error(
              `Item ${i + 1}: adicional ${j + 1} precisa de um ID válido`
            );
          }
          if (!additional.quantity || additional.quantity <= 0) {
            throw new Error(
              `Item ${i + 1}: adicional ${
                j + 1
              } deve possuir quantidade maior que zero`
            );
          }
          if (additional.price === undefined || additional.price < 0) {
            throw new Error(
              `Item ${i + 1}: adicional ${j + 1} deve possuir preço válido`
            );
          }
        }
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
        include: {
          components: {
            include: {
              item: true,
            },
          },
        },
      });

      if (products.length !== productIds.length) {
        throw new Error("Um ou mais produtos não foram encontrados");
      }

      // ========== VALIDAR ESTOQUE DOS PRODUCT COMPONENTS ==========
      for (const orderItem of data.items) {
        const product = products.find((p) => p.id === orderItem.product_id);

        if (product && product.components.length > 0) {
          const validation =
            await productComponentService.validateComponentsStock(
              product.id,
              orderItem.quantity
            );

          if (!validation.valid) {
            throw new Error(
              `Estoque insuficiente para ${
                product.name
              }:\n${validation.errors.join("\n")}`
            );
          }
        }
      }

      const additionalsIds = data.items
        .flatMap(
          (item) => item.additionals?.map((ad) => ad.additional_id) || []
        )
        .filter(Boolean);

      if (additionalsIds.length > 0) {
        const additionals = await prisma.item.findMany({
          where: { id: { in: additionalsIds } },
        });

        if (additionals.length !== additionalsIds.length) {
          throw new Error("Um ou mais adicionais não foram encontrados");
        }
      }

      const itemsTotal = data.items.reduce((sum, item) => {
        const baseTotal = item.price * item.quantity;
        const additionalsTotal = (item.additionals || []).reduce(
          (acc, additional) => acc + additional.price * additional.quantity,
          0
        );
        return sum + baseTotal + additionalsTotal;
      }, 0);

      if (itemsTotal <= 0) {
        throw new Error("Total dos itens deve ser maior que zero");
      }

      const discount = data.discount && data.discount > 0 ? data.discount : 0;
      if (discount < 0) {
        throw new Error("Desconto não pode ser negativo");
      }

      if (discount > itemsTotal) {
        throw new Error("Desconto não pode ser maior que o total dos itens");
      }

      const shipping_price = shippingRules[paymentMethod as "pix" | "card"];

      const total = parseFloat(itemsTotal.toFixed(2));
      const grand_total = parseFloat(
        (total - discount + shipping_price).toFixed(2)
      );

      if (grand_total <= 0) {
        throw new Error("Valor final do pedido deve ser maior que zero");
      }

      const { items, ...orderData } = data;

      // ========== VALIDAR E DECREMENTAR ESTOQUE ==========
      const stockValidation = await stockService.validateOrderStock(items);

      if (!stockValidation.valid) {
        throw new Error(
          `Estoque insuficiente:\n${stockValidation.errors.join("\n")}`
        );
      }

      const created = await prisma.order.create({
        data: {
          user_id: orderData.user_id,
          discount,
          total,
          delivery_address: orderData.delivery_address,
          delivery_date: orderData.delivery_date,
          shipping_price,
          payment_method: paymentMethod,
          grand_total,
          recipient_phone: phoneDigits, // Salvar com código do país
        },
      });

      for (const item of items) {
        const orderItem = await prisma.orderItem.create({
          data: {
            order_id: created.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
          },
        });

        // Salvar adicionais
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

        // ✅ NOVO: Salvar customizações
        if (
          Array.isArray(item.customizations) &&
          item.customizations.length > 0
        ) {
          for (const customization of item.customizations) {
            // Extrair todos os campos relevantes da customização
            const {
              customization_id,
              customization_type,
              title,
              customization_data,
              ...otherFields
            } = customization as any;

            await prisma.orderItemCustomization.create({
              data: {
                order_item_id: orderItem.id,
                customization_id: customization_id || "default",
                value: JSON.stringify({
                  customization_type,
                  title,
                  ...(customization_data || {}),
                  ...otherFields, // Inclui selected_option, selected_option_label, etc
                }),
              },
            });
          }
        }
      }

      // ========== DECREMENTAR ESTOQUE ==========
      try {
        await stockService.decrementOrderStock(items);
      } catch (stockError: unknown) {
        console.error("❌ Erro ao decrementar estoque:", stockError);
        // Log o erro mas não falha o pedido, pois já foi criado
        // Idealmente, deveria ter uma transação para reverter
      }

      // Sincronizar cliente com n8n (não bloqueia o pedido se falhar)
      try {
        const orderWithUser = await this.getOrderById(created.id);
        if (orderWithUser?.user?.phone) {
          await customerManagementService.syncAppUserToN8N(data.user_id);
          console.info(
            `✅ Cliente sincronizado com n8n: ${orderWithUser.user.phone}`
          );
        }
      } catch (syncError: any) {
        console.error(
          "⚠️ Erro ao sincronizar cliente com n8n:",
          syncError.message
        );
        // Não falha o pedido se a sincronização falhar
      }

      return await this.getOrderById(created.id);
    } catch (error: any) {
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("não encontrado") ||
        error.message.includes("deve ser maior") ||
        error.message.includes("inválida") ||
        error.message.includes("negativo")
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

  async updateOrderStatus(
    id: string,
    newStatus: string,
    options: UpdateStatusOptions = {}
  ) {
    if (!id) {
      throw new Error("ID do pedido é obrigatório");
    }

    const normalizedStatus = this.normalizeStatus(newStatus);

    const current = await prisma.order.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!current) {
      throw new Error("Pedido não encontrado");
    }

    // Se status não mudou, apenas retorna o pedido completo
    if (current.status === normalizedStatus) {
      return prisma.order.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              additionals: {
                include: {
                  additional: true,
                },
              },
              product: true,
              customizations: true,
            },
          },
          user: true,
          payment: true,
        },
      });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: normalizedStatus,
      },
      include: {
        items: {
          include: {
            additionals: {
              include: {
                additional: true,
              },
            },
            product: true,
            customizations: true,
          },
        },
        user: true,
        payment: true,
      },
    });

    if (options.notifyCustomer !== false) {
      try {
        // Buscar customizações com google_drive_url se existir
        let driveLink: string | undefined;
        try {
          const customizationWithDrive =
            await prisma.orderItemCustomization.findFirst({
              where: {
                order_item_id: {
                  in: updated.items.map((item) => item.id),
                },
                google_drive_url: {
                  not: null,
                },
              },
              select: {
                google_drive_url: true,
              },
            });
          driveLink = customizationWithDrive?.google_drive_url || undefined;
        } catch (error) {
          // Ignorar se a coluna ainda não existir
        }

        const totalAmount =
          typeof updated.grand_total === "number"
            ? updated.grand_total
            : updated.total;

        await whatsappService.sendOrderStatusUpdateNotification(
          {
            orderId: updated.id,
            orderNumber: updated.id.substring(0, 8).toUpperCase(),
            totalAmount,
            paymentMethod:
              updated.payment_method ||
              updated.payment?.payment_method ||
              "Não informado",
            items: updated.items.map((item) => ({
              name: item.product.name,
              quantity: item.quantity,
              price: item.price,
            })),
            customer: {
              name: updated.user.name,
              email: updated.user.email,
              phone: updated.user.phone || undefined,
            },
            delivery: updated.delivery_address
              ? {
                  address: updated.delivery_address,
                  date: updated.delivery_date || undefined,
                }
              : undefined,
            googleDriveUrl: driveLink || undefined,
          },
          normalizedStatus
        );
      } catch (error) {
        console.error(
          "⚠️ Erro ao enviar notificação de atualização de pedido:",
          (error as Error).message
        );
      }
    }

    return updated;
  }

  /**
   * Busca pedido pendente de pagamento do usuário
   */
  async getPendingOrder(userId: string) {
    if (!userId) {
      throw new Error("ID do usuário é obrigatório");
    }

    const pendingOrder = await prisma.order.findFirst({
      where: {
        user_id: userId,
        status: "PENDING",
      },
      include: {
        items: {
          include: {
            product: true,
            additionals: {
              include: { additional: true },
            },
          },
        },
        payment: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return pendingOrder;
  }

  /**
   * Cancela um pedido pendente
   */
  async cancelOrder(orderId: string, userId?: string) {
    if (!orderId) {
      throw new Error("ID do pedido é obrigatório");
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        items: true,
      },
    });

    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    // Se userId for fornecido, verificar se o pedido pertence ao usuário
    if (userId && order.user_id !== userId) {
      throw new Error("Você não tem permissão para cancelar este pedido");
    }

    // Só permite cancelar pedidos pendentes
    if (order.status !== "PENDING") {
      throw new Error(
        "Apenas pedidos pendentes podem ser cancelados pelo cliente"
      );
    }

    // Cancelar pagamento no Mercado Pago se existir
    if (order.payment?.mercado_pago_id) {
      try {
        const PaymentService = require("./paymentService").default;
        await PaymentService.cancelPayment(order.payment.mercado_pago_id);
      } catch (error) {
        console.error("Erro ao cancelar pagamento no Mercado Pago:", error);
        // Continua mesmo se falhar, pois o pedido será marcado como cancelado
      }
    }

    // Atualizar status do pedido
    const canceledOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELED",
      },
      include: {
        items: {
          include: {
            product: true,
            additionals: {
              include: { additional: true },
            },
          },
        },
        payment: true,
        user: true,
      },
    });

    return canceledOrder;
  }
}

export default new OrderService();
