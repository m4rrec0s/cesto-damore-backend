import prisma from "../database/prisma";
import stockService from "./stockService";
import whatsappService from "./whatsappService";
import productComponentService from "./productComponentService";
import customerManagementService from "./customerManagementService";
import googleDriveService from "./googleDriveService";
import logger from "../utils/logger";
import fs from "fs";
import path from "path";

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

interface PaginationParams {
  page?: number;
  limit?: number;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
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
  complement?: string;
  items: CreateOrderItem[];
  is_draft?: boolean;
  send_anonymously?: boolean;
  delivery_method?: "delivery" | "pickup";
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

function hashCustomizations(customizations?: any[]): string {
  if (!customizations || customizations.length === 0) {
    return "no-customization";
  }

  const sorted = [...customizations].sort((a, b) =>
    (a.customization_id || "").localeCompare(b.customization_id || "")
  );
  const hashData = sorted.map((c) => ({
    id: c.customization_id || "",
    type: c.customization_type || "",
    text: c.title || c.text || "",
    option: c.selected_option || "",
    item: c.selected_item ? JSON.stringify(c.selected_item) : "",
    photos: Array.isArray(c.photos)
      ? c.photos
        .map((p: any) => p.temp_file_id || p.preview_url || "")
        .sort()
        .join(",")
      : "",
  }));

  return JSON.stringify(hashData);
}

class OrderService {
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
                // Also expose label_selected for backwards compatibility with API
                customData.label_selected = customData.selected_option_label;
              }
            }

            // If it's a base layout and we have a selected_item, map it to label_selected
            if (!customData.label_selected && customData.selected_item) {
              const selected =
                typeof customData.selected_item === "string"
                  ? customData.selected_item
                  : (customData.selected_item as { selected_item?: string })
                    .selected_item;

              if (selected) {
                customData.label_selected = selected;
                customData.selected_item_label = selected;
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

  /**
   * Remove todos os campos base64 das customizações antes de retornar ao frontend
   * Mantém apenas os links do Google Drive
   */
  private removeBase64Recursive(obj: any) {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      obj.forEach((item) => this.removeBase64Recursive(item));
      return;
    }

    for (const key of Object.keys(obj)) {
      if (key === "base64" || key === "base64Data") {
        delete obj[key];
        continue;
      }

      const value = obj[key];
      // Remover strings que começam com data:image (base64)
      if (typeof value === "string" && value.startsWith("data:image")) {
        delete obj[key];
        continue;
      }

      if (typeof value === "object" && value !== null) {
        this.removeBase64Recursive(value);
      }
    }
  }

  /**
   * Remove todos os campos base64 das customizações antes de retornar ao frontend
   * Mantém apenas os links do Google Drive
   */
  private sanitizeBase64FromCustomizations(orders: any[]) {
    return orders.map((order) => ({
      ...order,
      items: order.items.map((item: any) => ({
        ...item,
        customizations: item.customizations.map((customization: any) => {
          try {
            const customData = JSON.parse(customization.value || "{}");

            // Sanitização recursiva para garantir que nada escape
            this.removeBase64Recursive(customData);

            return {
              ...customization,
              value: JSON.stringify(customData),
            };
          } catch (error) {
            console.error(
              "Erro ao sanitizar customização:",
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

  async getAllOrders(filter?: OrderFilter, pagination?: PaginationParams) {
    try {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 50;
      const skip = (page - 1) * limit;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
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
          where: {
            status: this.buildStatusWhere(filter),
          },
          orderBy: {
            created_at: "desc",
          },
          skip,
          take: limit,
        }),
        prisma.order.count({
          where: {
            status: this.buildStatusWhere(filter),
          },
        }),
      ]);

      // Enriquecer customizações com labels das opções
      const enriched = this.enrichCustomizations(orders);

      // Sanitizar base64 antes de retornar
      const sanitized = this.sanitizeBase64FromCustomizations(enriched);

      const totalPages = Math.ceil(total / limit);
      const hasMore = page < totalPages;

      return {
        data: sanitized,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasMore,
        },
      };
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

    const enriched = this.enrichCustomizations(orders);
    return this.sanitizeBase64FromCustomizations(enriched);
  }

  async getOrderById(id: string) {
    if (!id) {
      throw new Error("ID do pedido é obrigatório");
    }

    try {
      const order = await prisma.order.findUnique({
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
              customizations: {
                include: {
                  customization: true,
                },
              },
            },
          },
          user: true,
          payment: true,
        },
      });

      if (!order) {
        throw new Error("Pedido não encontrado");
      }

      // Enriquecer e sanitizar o pedido único
      const enriched = this.enrichCustomizations([order]);
      const sanitized = this.sanitizeBase64FromCustomizations(enriched);

      return sanitized[0];
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      throw new Error(`Erro ao buscar pedido: ${error.message}`);
    }
  }

  async createOrder(data: CreateOrderInput) {
    logger.info("📝 [OrderService] Iniciando criação de pedido - resumo:", {
      user_id: data.user_id,
      itemsCount: Array.isArray(data.items) ? data.items.length : 0,
      payment_method: data.payment_method ?? null,
      delivery_city: data.delivery_city ?? null,
      delivery_method: data.delivery_method ?? "delivery",
    });

    if (!data.user_id || data.user_id.trim() === "") {
      logger.error("❌ [OrderService] user_id está vazio ou inválido");
      throw new Error("ID do usuário é obrigatório");
    }
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      logger.error("❌ [OrderService] items está vazio ou inválido");
      throw new Error("Pelo menos um item é obrigatório");
    }

    let phoneDigits = (data.recipient_phone || "").replace(/\D/g, "");

    if (
      !data.is_draft &&
      (phoneDigits.length < 10 || phoneDigits.length > 13)
    ) {
      logger.error(
        "❌ [OrderService] Telefone com tamanho inválido:",
        phoneDigits.length
      );
      throw new Error("Número do destinatário deve ter entre 10 e 13 dígitos");
    }

    if (!data.is_draft && !phoneDigits.startsWith("55")) {
      phoneDigits = "55" + phoneDigits;
    }

    const paymentMethod = normalizeText(String(data.payment_method || ""));
    logger.debug(
      "💳 [OrderService] Método de pagamento normalizado:",
      paymentMethod
    );

    if (!data.is_draft && paymentMethod !== "pix" && paymentMethod !== "card") {
      console.error(
        "❌ [OrderService] Método de pagamento inválido:",
        paymentMethod
      );
      throw new Error("Forma de pagamento inválida. Utilize pix ou card");
    }

    if (!data.is_draft && (!data.delivery_city || !data.delivery_state)) {
      console.error("❌ [OrderService] Cidade ou estado de entrega ausente");
      throw new Error("Cidade e estado de entrega são obrigatórios");
    }

    const normalizedCity = data.delivery_city
      ? normalizeText(data.delivery_city)
      : undefined;

    let shippingRules: { pix: number; card: number } | undefined = undefined;
    if (!data.is_draft) {
      shippingRules = ACCEPTED_CITIES[normalizedCity as string];
      if (!shippingRules) {
        console.error("❌ [OrderService] Cidade não atendida:", normalizedCity);
        throw new Error("Ainda não fazemos entrega nesse endereço");
      }
    }

    const normalizedState = data.delivery_state
      ? normalizeText(data.delivery_state)
      : undefined;
    logger.debug("🗺️ [OrderService] Estado normalizado:", normalizedState);

    if (
      !data.is_draft &&
      normalizedState !== "pb" &&
      normalizedState !== "paraiba"
    ) {
      console.error("❌ [OrderService] Estado não atendido:", normalizedState);
      throw new Error("Atualmente só entregamos na Paraíba (PB)");
    }

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item.product_id || item.product_id.trim() === "") {
        throw new Error(`Item ${i + 1}: ID do produto é obrigatório`);
      }
      // Validar formato UUID do product_id para evitar erros comuns de payload
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(item.product_id)) {
        throw new Error(
          `Item ${i + 1}: ID do produto inválido (formato UUID esperado)`
        );
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
              `Item ${i + 1}: adicional ${j + 1
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
      try {
        await this.cancelPreviousPendingOrders(data.user_id);
        logger.info(
          `✅ [OrderService] Pedidos PENDING anteriores cancelados para usuário ${data.user_id}`
        );
      } catch (error) {
        logger.error(
          "⚠️ Erro ao cancelar pedidos anteriores (continuando):",
          error instanceof Error ? error.message : error
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: data.user_id },
      });
      if (!user) {
        throw new Error("Usuário não encontrado");
      }

      const productIds = data.items.map((item) => item.product_id);
      console.debug(
        "[OrderService.createOrder] payload productIds:",
        productIds
      );
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
        const foundIds = products.map((p) => p.id);
        const missing = productIds.filter((id) => !foundIds.includes(id));
        const err = new Error(`Produtos não encontrados: ${missing.join(",")}`);
        (err as any).code = "MISSING_PRODUCTS";
        (err as any).missing = missing;
        throw err;
      }

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
              `Estoque insuficiente para ${product.name
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

      const shipping_price = shippingRules
        ? shippingRules[paymentMethod as "pix" | "card"]
        : 0;

      const total = parseFloat(itemsTotal.toFixed(2));
      const grand_total = parseFloat(
        (total - discount + shipping_price).toFixed(2)
      );

      if (grand_total <= 0) {
        throw new Error("Valor final do pedido deve ser maior que zero");
      }

      const { items, ...orderData } = data;

      if (!data.is_draft) {
        const stockValidation = await stockService.validateOrderStock(items);

        if (!stockValidation.valid) {
          throw new Error(
            `Estoque insuficiente:\n${stockValidation.errors.join("\n")}`
          );
        }
      }

      const created = await prisma.order.create({
        data: {
          user_id: orderData.user_id,
          discount,
          total,
          delivery_address: orderData.delivery_address,
          complement: orderData.complement,
          delivery_date: orderData.delivery_date || null, // ✅ NOVO: delivery_date é opcional
          shipping_price,
          payment_method: paymentMethod,
          grand_total,
          recipient_phone: phoneDigits, // Salvar com código do país
          send_anonymously: data.send_anonymously || false,
          delivery_city: orderData.delivery_city, // ✅ NOVO: Salvar cidade
          delivery_state: orderData.delivery_state, // ✅ NOVO: Salvar estado
          delivery_method: orderData.delivery_method || "delivery",
        },
      });

      const createdItems: { id: string; index: number }[] = [];
      const additionalsBatch: any[] = [];
      const customizationsBatch: any[] = [];

      const createStart = Date.now();
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const orderItem = await prisma.orderItem.create({
          data: {
            order_id: created.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
          },
        });
        createdItems.push({ id: orderItem.id, index: idx });

        // Preparar adicionais
        if (Array.isArray(item.additionals) && item.additionals.length > 0) {
          for (const additional of item.additionals) {
            additionalsBatch.push({
              order_item_id: orderItem.id,
              additional_id: additional.additional_id,
              quantity: additional.quantity,
              price: additional.price,
            });
          }
        }

        // Preparar customizações
        if (
          Array.isArray(item.customizations) &&
          item.customizations.length > 0
        ) {
          for (const customization of item.customizations) {
            const {
              customization_id,
              customization_type,
              title,
              customization_data,
              ...otherFields
            } = customization as any;

            const uuidRegex =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isValidUUID =
              customization_id && uuidRegex.test(customization_id);

            customizationsBatch.push({
              order_item_id: orderItem.id,
              customization_id: isValidUUID ? customization_id : null,
              value: JSON.stringify({
                customization_type,
                title,
                ...(customization_data || {}),
                ...otherFields,
              }),
            });
          }
        }
      }

      if (additionalsBatch.length > 0) {
        await prisma.orderItemAdditional.createMany({ data: additionalsBatch });
      }
      if (customizationsBatch.length > 0) {
        await prisma.orderItemCustomization.createMany({
          data: customizationsBatch,
        });
      }
      const createDuration = Date.now() - createStart;
      console.log(
        `✅ [OrderService.createOrder] inserted items in ${createDuration}ms, createdItems=${createdItems.length}, additionals=${additionalsBatch.length}, customizations=${customizationsBatch.length}`
      );

      // ========== DECREMENTAR ESTOQUE ==========
      try {
        if (!data.is_draft) {
          await stockService.decrementOrderStock(items);
        }
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

  /**
   * ✅ NOVO: Deleta pastas do Google Drive associadas ao pedido
   * Remove pasta raiz + subpastas de customização
   */
  private async deleteOrderGoogleDriveFolders(orderId: string): Promise<void> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { google_drive_folder_id: true },
      });

      if (!order?.google_drive_folder_id) {
        logger.debug(`ℹ️ Pedido ${orderId} não tem pasta no Google Drive`);
        return;
      }

      // ✅ Deletar pasta raiz (com cascata de subpastas)
      await googleDriveService.deleteFolder(order.google_drive_folder_id);
      logger.info(
        `✅ Pasta Google Drive deletada: ${order.google_drive_folder_id}`
      );
    } catch (err) {
      logger.warn(
        `⚠️ Erro ao deletar pasta Google Drive do pedido ${orderId}:`,
        err
      );
      // Não bloquear deleção do pedido se Drive falhar
    }
  }

  async deleteOrder(id: string) {
    if (!id) {
      throw new Error("ID do pedido é obrigatório");
    }

    // Verifica se o pedido existe
    await this.getOrderById(id);

    try {
      logger.info(`🗑️ [OrderService] Iniciando deleção do pedido ${id}`);

      // ✅ NOVO: Deletar pastas do Google Drive ANTES de deletar do banco
      await this.deleteOrderGoogleDriveFolders(id);

      // ✅ NOVO: Buscar arquivos temporários antes de deletar customizações
      const tempFilesToDelete: string[] = [];
      const customizationsToDelete =
        await prisma.orderItemCustomization.findMany({
          where: {
            orderItem: { order_id: id },
          },
          select: { value: true },
        });

      for (const customization of customizationsToDelete) {
        try {
          const value = JSON.parse(customization.value);
          // Buscar preview_url em fotos
          if (value.photos && Array.isArray(value.photos)) {
            value.photos.forEach((photo: any) => {
              if (
                photo.preview_url &&
                photo.preview_url.includes("/uploads/temp/")
              ) {
                const filename = photo.preview_url
                  .split("/uploads/temp/")
                  .pop();
                if (filename) tempFilesToDelete.push(filename);
              }
            });
          }
          // Buscar preview_url em final_artwork
          if (value.final_artwork && value.final_artwork.preview_url) {
            const url = value.final_artwork.preview_url;
            if (url.includes("/uploads/temp/")) {
              const filename = url.split("/uploads/temp/").pop();
              if (filename) tempFilesToDelete.push(filename);
            }
          }
          // Buscar preview_url em final_artworks (array)
          if (value.final_artworks && Array.isArray(value.final_artworks)) {
            value.final_artworks.forEach((artwork: any) => {
              if (
                artwork.preview_url &&
                artwork.preview_url.includes("/uploads/temp/")
              ) {
                const filename = artwork.preview_url
                  .split("/uploads/temp/")
                  .pop();
                if (filename) tempFilesToDelete.push(filename);
              }
            });
          }

          // ✅ NOVO: Buscar arquivo em text (BASE_LAYOUT)
          if (
            (value.customization_type === "BASE_LAYOUT" ||
              value.customizationType === "BASE_LAYOUT") &&
            value.text &&
            typeof value.text === "string" &&
            value.text.includes("/uploads/temp/")
          ) {
            const filename = value.text.split("/uploads/temp/").pop();
            if (filename) tempFilesToDelete.push(filename);
          }
        } catch (err) {
          logger.warn(`⚠️ Erro ao parsear customização:`, err);
        }
      }

      await prisma.$transaction(async (tx) => {
        const items = await tx.orderItem.findMany({
          where: { order_id: id },
          select: { id: true },
        });
        const itemIds = items.map((item) => item.id);

        if (itemIds.length > 0) {
          const deletedCustomizations =
            await tx.orderItemCustomization.deleteMany({
              where: { order_item_id: { in: itemIds } },
            });
          logger.info(
            `  ✓ Customizações deletadas: ${deletedCustomizations.count}`
          );

          const deletedAdditionals = await tx.orderItemAdditional.deleteMany({
            where: { order_item_id: { in: itemIds } },
          });
          logger.info(`  ✓ Adicionais deletados: ${deletedAdditionals.count}`);
        }

        const deletedItems = await tx.orderItem.deleteMany({
          where: { order_id: id },
        });
        logger.info(`  ✓ Itens do pedido deletados: ${deletedItems.count}`);

        try {
          const deletedPersonalizations = await tx.personalization.deleteMany({
            where: { order_id: id },
          });
          logger.info(
            `  ✓ Personalizações deletadas: ${deletedPersonalizations.count}`
          );
        } catch (err) {
          logger.info(
            "  ℹ️ Sem personalizações para deletar (ou erro):",
            (err as any)?.message || err
          );
        }

        try {
          const payment = await tx.payment.findUnique({
            where: { order_id: id },
          });
          if (payment) {
            await tx.payment.delete({ where: { order_id: id } });
            logger.info("  ✓ Pagamento deletado");
          } else {
            logger.info("  ℹ️ Sem pagamento para deletar");
          }
        } catch (err) {
          logger.warn(
            "  ℹ️ Erro ao deletar pagamento (pode não existir):",
            (err as any)?.message || err
          );
        }

        await tx.order.delete({ where: { id } });
      });

      // ✅ NOVO: Deletar arquivos temporários após deletar pedido do banco
      if (tempFilesToDelete.length > 0) {
        const tempFileService = require("../services/tempFileService").default;
        const result = tempFileService.deleteFiles(tempFilesToDelete);
        logger.info(
          `🗑️ Arquivos temporários deletados: ${result.deleted}, falharam: ${result.failed}`
        );
      }

      logger.info(`✅ [OrderService] Pedido ${id} deletado com sucesso`);

      return { message: "Pedido deletado com sucesso" };
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      logger.error(`❌ [OrderService] Erro ao deletar pedido:`, error);
      throw new Error(`Erro ao deletar pedido: ${error.message}`);
    }
  }

  async list(pagination?: PaginationParams) {
    return this.getAllOrders(undefined, pagination);
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

  async updateOrderItems(orderId: string, items: CreateOrderItem[]) {
    if (!orderId) {
      throw new Error("ID do pedido é obrigatório");
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    if (order.status !== "PENDING") {
      throw new Error("Apenas pedidos pendentes podem ser atualizados");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Pelo menos um item é obrigatório");
    }

    console.log(
      `[OrderService] Atualizando itens do pedido ${orderId} - quantidade: ${items.length}`
    );

    // Validação básica dos itens
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.product_id || item.product_id.trim() === "") {
        throw new Error(`Item ${i + 1}: ID do produto é obrigatório`);
      }
      // Validar formato UUID do product_id para evitar erros comuns de payload
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(item.product_id)) {
        throw new Error(
          `Item ${i + 1}: ID do produto inválido (formato UUID esperado)`
        );
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new Error(`Item ${i + 1}: Quantidade deve ser maior que zero`);
      }
      if (!item.price && item.price !== 0) {
        throw new Error(`Item ${i + 1}: Preço deve ser informado`);
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
        }
      }
    }

    const productIds = items.map((i) => i.product_id);
    console.debug(
      `[OrderService.updateOrderItems] orderId=${orderId} payload items:`,
      items
    );
    console.debug(
      `[OrderService.updateOrderItems] orderId=${orderId} items productIds:`,
      productIds
    );
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    if (products.length !== productIds.length) {
      const foundIds = products.map((p) => p.id);
      const missing = productIds.filter((id) => !foundIds.includes(id));
      const err = new Error(`Produtos não encontrados: ${missing.join(",")}`);
      (err as any).code = "MISSING_PRODUCTS";
      (err as any).missing = missing;
      throw err;
    }

    // Validar se os adicionais existem
    const additionalsIds = items
      .flatMap((item) => item.additionals?.map((ad) => ad.additional_id) || [])
      .filter(Boolean);

    if (additionalsIds.length > 0) {
      const additionals = await prisma.item.findMany({
        where: { id: { in: additionalsIds } },
      });

      if (additionals.length !== additionalsIds.length) {
        const foundIds = additionals.map((a) => a.id);
        const missing = additionalsIds.filter((id) => !foundIds.includes(id));
        const err = new Error(
          `Adicionais não encontrados: ${missing.join(",")}`
        );
        (err as any).code = "MISSING_ADDITIONALS";
        (err as any).missing = missing;
        throw err;
      }
    }

    if (order.payment_method) {
      const stockValidation = await stockService.validateOrderStock(items);
      if (!stockValidation.valid) {
        throw new Error(
          `Estoque insuficiente:\n${stockValidation.errors.join("\n")}`
        );
      }
    }

    const itemsTotal = items.reduce((sum, item) => {
      const additionalTotal = (item.additionals || []).reduce(
        (acc, add) => acc + (add.price || 0) * item.quantity,
        0
      );
      return sum + item.price * item.quantity + additionalTotal;
    }, 0);

    const discount = order.discount || 0;
    if (discount < 0) throw new Error("Desconto não pode ser negativo");
    if (discount > itemsTotal)
      throw new Error("Desconto não pode ser maior que o total dos itens");

    const shipping_price = order.shipping_price || 0;
    const total = parseFloat(itemsTotal.toFixed(2));
    const grand_total = parseFloat(
      (total - discount + shipping_price).toFixed(2)
    );

    // ✅ Use transaction to ensure atomicity and prevent FK constraint violations
    // To avoid timeouts, perform fewer DB roundtrips by batching adds
    // and increase transaction timeout to handle larger payloads
    const txStart = Date.now();
    try {
      await prisma.$transaction(
        async (tx) => {
          // Remover itens antigos (customizações e adicionais em cascata)
          const existingItems = await tx.orderItem.findMany({
            where: { order_id: orderId },
            select: { id: true },
          });
          const itemIds = existingItems.map((i) => i.id);

          if (itemIds.length > 0) {
            await tx.orderItemCustomization.deleteMany({
              where: { order_item_id: { in: itemIds } },
            });
            await tx.orderItemAdditional.deleteMany({
              where: { order_item_id: { in: itemIds } },
            });
          }

          await tx.orderItem.deleteMany({ where: { order_id: orderId } });

          const createdItems: { id: string; index: number }[] = [];
          const additionalsBatch: any[] = [];
          const customizationsBatch: any[] = [];

          // Criar novos itens e acumular additionals/customizations para createMany
          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const createdItem = await tx.orderItem.create({
              data: {
                order_id: orderId,
                product_id: item.product_id,
                quantity: item.quantity,
                price: item.price,
              },
            });
            createdItems.push({ id: createdItem.id, index: idx });

            if (
              Array.isArray(item.additionals) &&
              item.additionals.length > 0
            ) {
              for (const additional of item.additionals) {
                additionalsBatch.push({
                  order_item_id: createdItem.id,
                  additional_id: additional.additional_id,
                  quantity: additional.quantity,
                  price: additional.price,
                });
              }
            }

            if (
              Array.isArray(item.customizations) &&
              item.customizations.length > 0
            ) {
              for (const customization of item.customizations) {
                const {
                  customization_id,
                  customization_type,
                  title,
                  customization_data,
                  ...otherFields
                } = customization as any;

                const uuidRegex =
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const isValidUUID =
                  customization_id && uuidRegex.test(customization_id);

                customizationsBatch.push({
                  order_item_id: createdItem.id,
                  customization_id: isValidUUID ? customization_id : null,
                  value: JSON.stringify({
                    customization_type,
                    title,
                    ...(customization_data || {}),
                    ...otherFields,
                  }),
                });
              }
            }
          }

          // Insert all additionals and customizations in bulk to reduce queries
          if (additionalsBatch.length > 0) {
            await tx.orderItemAdditional.createMany({ data: additionalsBatch });
          }
          if (customizationsBatch.length > 0) {
            await tx.orderItemCustomization.createMany({
              data: customizationsBatch,
            });
          }

          // Atualizar o pedido
          await tx.order.update({
            where: { id: orderId },
            data: { total, grand_total },
          });
          const txDuration = Date.now() - txStart;
          console.log(
            `[OrderService] updateOrderItems transaction completed in ${txDuration}ms, createdItems=${createdItems.length}, additionals=${additionalsBatch.length}, customizations=${customizationsBatch.length}`
          );
        },
        { timeout: 20000 }
      );
    } catch (error: any) {
      console.error(
        `[OrderService] updateOrderItems transaction failed for order ${orderId}:`,
        error
      );
      if (error?.code === "P2028") {
        throw new Error(
          "Erro ao atualizar itens do pedido: tempo limite da transação excedido"
        );
      }
      throw error;
    }

    console.log(
      `[OrderService] Itens atualizados do pedido ${orderId} - total: ${total}`
    );

    return await this.getOrderById(orderId);
  }

  async updateOrderMetadata(
    orderId: string,
    data: {
      send_anonymously?: boolean;
      complement?: string;
      delivery_address?: string | null;
      delivery_city?: string | null;
      delivery_state?: string | null;
      recipient_phone?: string | null;
      delivery_date?: Date | string | null;
      shipping_price?: number; // ✅ NOVO: permitir atualizar frete
    }
  ) {
    if (!orderId) {
      throw new Error("ID do pedido é obrigatório");
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    // Só permite atualizar pedidos PENDING
    if (order.status !== "PENDING") {
      throw new Error("Apenas pedidos pendentes podem ser atualizados");
    }

    const updateData: any = {};
    if (typeof data.send_anonymously === "boolean") {
      updateData.send_anonymously = data.send_anonymously;
    }
    if (typeof data.complement === "string") {
      updateData.complement = data.complement;
    }

    // Permitir atualização de endereço/telefone no pedido quando for rascunho (PENDING)
    if (typeof data.delivery_address === "string") {
      updateData.delivery_address = data.delivery_address || null;
    }
    if (typeof data.delivery_city === "string") {
      updateData.delivery_city = data.delivery_city || null;
    }
    if (typeof data.delivery_state === "string") {
      updateData.delivery_state = data.delivery_state || null;
    }
    if (typeof data.recipient_phone === "string") {
      // Normalizar telefone para o formato que usamos no backend
      const digits = data.recipient_phone.replace(/\D/g, "");
      let normalized = digits;
      if (!digits.startsWith("55")) {
        normalized = "55" + digits;
      }
      // Validação simples do tamanho do telefone (sem código do país)
      const localDigits = normalized.startsWith("55")
        ? normalized.substring(2)
        : normalized;
      if (localDigits.length < 10 || localDigits.length > 11) {
        throw new Error("Telefone do destinatário inválido");
      }
      updateData.recipient_phone = normalized;
    }

    // Validar data de entrega se fornecida
    if (data.delivery_date === null) {
      updateData.delivery_date = null; // permite limpar a data
    } else if (
      typeof data.delivery_date === "string" ||
      data.delivery_date instanceof Date
    ) {
      const dt =
        data.delivery_date instanceof Date
          ? data.delivery_date
          : new Date(String(data.delivery_date));
      if (isNaN(Number(dt))) {
        throw new Error("Data de entrega inválida");
      }
      // Opcional: evitar datas no passado
      const now = new Date();
      if (dt < now) {
        throw new Error("Data de entrega não pode ser no passado");
      }
      updateData.delivery_date = dt;
    }

    // Validar estado de entrega se fornecido
    if (typeof data.delivery_state === "string") {
      const normalizedState = normalizeText(data.delivery_state || "");
      if (
        normalizedState &&
        normalizedState !== "pb" &&
        normalizedState !== "paraiba"
      ) {
        throw new Error("Atualmente só entregamos na Paraíba (PB)");
      }
    }

    // ✅ NOVO: Atualizar frete e recalcular total
    if (typeof data.shipping_price === "number") {
      if (data.shipping_price < 0) {
        throw new Error("O valor do frete não pode ser negativo");
      }
      updateData.shipping_price = data.shipping_price;

      // Recalcular grand_total
      const currentTotal = order.total;
      const currentDiscount = order.discount || 0;
      const newGrandTotal = parseFloat(
        (currentTotal - currentDiscount + data.shipping_price).toFixed(2)
      );

      if (newGrandTotal <= 0) {
        throw new Error("Valor final do pedido deve ser maior que zero");
      }
      updateData.grand_total = newGrandTotal;
    }

    await prisma.order.update({ where: { id: orderId }, data: updateData });

    return await this.getOrderById(orderId);
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

    // Se status não mudou, apenas retorna o pedido completo (sanitizado via getOrderById)
    if (current.status === normalizedStatus) {
      return this.getOrderById(id);
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

    // ✅ NOVO: Limpar recursos quando pedido é ENTREGUE
    if (normalizedStatus === "DELIVERED") {
      try {
        logger.info(
          `📦 [OrderService] Pedido ${id} marcado como ENTREGUE - limpando recursos...`
        );

        // Deletar Google Drive folder
        if (updated.google_drive_folder_id) {
          await googleDriveService
            .deleteFolder(updated.google_drive_folder_id)
            .then(() => {
              logger.info(
                `✅ Pasta Google Drive deletada: ${updated.google_drive_folder_id}`
              );
            })
            .catch((err) => {
              logger.warn(
                `⚠️ Erro ao deletar pasta Drive ${updated.google_drive_folder_id}:`,
                err
              );
            });
        }

        // ✅ Deletar OrderItemCustomization (mantém OrderItem e Order)
        const customizationsDeleted =
          await prisma.orderItemCustomization.deleteMany({
            where: {
              order_item_id: {
                in: updated.items.map((item) => item.id),
              },
            },
          });

        logger.info(
          `🗑️ ${customizationsDeleted.count} customização(ões) deletada(s)`
        );

        // ✅ Deletar Personalization (canvas/imagens geradas)
        const personalizationsDeleted = await prisma.personalization.deleteMany(
          {
            where: {
              order_id: id,
            },
          }
        );

        logger.info(
          `🗑️ ${personalizationsDeleted.count} personalização(ões) deletada(s)`
        );

        // ✅ NOVO: Deletar arquivos temporários da VPS
        // Buscar customizações antes de deletar para coletar temp files
        const customizationsBeforeDeletion =
          await prisma.orderItemCustomization.findMany({
            where: {
              order_item_id: {
                in: updated.items.map((item) => item.id),
              },
            },
          });

        const baseStorageDir =
          process.env.NODE_ENV === "production"
            ? "/app/storage"
            : path.join(process.cwd(), "storage");

        let tempFilesDeleted = 0;

        for (const customization of customizationsBeforeDeletion) {
          try {
            const data = customization.value
              ? JSON.parse(customization.value)
              : {};
            const tempFiles: string[] = [];

            // Coletar URLs de temp files
            if (data.image?.preview_url?.startsWith("/uploads/temp/")) {
              tempFiles.push(data.image.preview_url);
            }
            if (data.photos && Array.isArray(data.photos)) {
              data.photos.forEach((photo: any) => {
                if (photo.preview_url?.startsWith("/uploads/temp/")) {
                  tempFiles.push(photo.preview_url);
                }
              });
            }

            // Deletar cada arquivo
            for (const tempUrl of tempFiles) {
              try {
                const tempFileName = tempUrl.replace("/uploads/temp/", "");
                const filePath = path.join(
                  baseStorageDir,
                  "temp",
                  tempFileName
                );

                // Validação de segurança
                if (
                  filePath.startsWith(path.join(baseStorageDir, "temp")) &&
                  fs.existsSync(filePath)
                ) {
                  fs.unlinkSync(filePath);
                  logger.info(
                    `🗑️ Arquivo temporário deletado: ${tempFileName}`
                  );
                  tempFilesDeleted++;
                }
              } catch (err) {
                logger.warn(`⚠️ Erro ao deletar temp file (${tempUrl}):`, err);
              }
            }
          } catch (err) {
            logger.warn(`⚠️ Erro ao processar customização para cleanup:`, err);
          }
        }

        if (tempFilesDeleted > 0) {
          logger.info(
            `🗑️ ${tempFilesDeleted} arquivo(s) temporário(s) deletado(s)`
          );
        }

        logger.info(
          `✅ [OrderService] Limpeza de recursos do pedido ${id} concluída`
        );
      } catch (err) {
        logger.warn(
          `⚠️ Erro na limpeza de recursos do pedido entregue ${id}:`,
          err
        );
        // Não bloquear - pedido continua sendo retornado
      }
    }

    // Retornar via getOrderById para garantir sanitização
    return this.getOrderById(id);
  }

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
            customizations: {
              include: { customization: true }, // ✅ ADICIONAR customizações
            },
          },
        },
        payment: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (!pendingOrder) return null;

    // Enriquecer e sanitizar o pedido pendente
    const enriched = this.enrichCustomizations([pendingOrder]);
    const sanitized = this.sanitizeBase64FromCustomizations(enriched);

    return sanitized[0];
  }

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

    if (userId && order.user_id !== userId) {
      throw new Error("Você não tem permissão para cancelar este pedido");
    }
    if (order.status !== "PENDING") {
      throw new Error(
        "Apenas pedidos pendentes podem ser cancelados pelo cliente"
      );
    }

    if (order.payment?.mercado_pago_id) {
      try {
        const PaymentService = require("./paymentService").default;
        await PaymentService.cancelPayment(order.payment.mercado_pago_id);
        console.log(
          `✅ Pagamento ${order.payment.mercado_pago_id} cancelado no Mercado Pago`
        );
      } catch (error) {
        console.error("Erro ao cancelar pagamento no Mercado Pago:", error);
      }
    }

    if (order.payment) {
      try {
        await prisma.payment.delete({
          where: { order_id: orderId },
        });
        console.log(`🗑️ Registro de pagamento deletado para pedido ${orderId}`);
      } catch (error) {
        console.error("Erro ao deletar registro de pagamento:", error);
      }
    }

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

    console.log(`✅ Pedido ${orderId} cancelado com sucesso`);
    return null;
  }

  async cancelPreviousPendingOrders(userId: string, excludeOrderId?: string) {
    if (!userId) {
      throw new Error("ID do usuário é obrigatório");
    }

    try {
      const pendingOrders = await prisma.order.findMany({
        where: {
          user_id: userId,
          status: "PENDING",
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        },
        select: { id: true, created_at: true },
      });

      if (pendingOrders.length === 0) {
        console.log(
          `ℹ️ [OrderService] Nenhum pedido PENDING anterior encontrado para usuário ${userId}`
        );
        return { canceled: 0 };
      }

      console.log(
        `🗑️ [OrderService] Cancelando ${pendingOrders.length} pedido(s) PENDING anterior(es) do usuário ${userId}`
      );

      // Cancelar cada pedido PENDING antigo
      let canceledCount = 0;
      for (const order of pendingOrders) {
        try {
          await this.cancelOrder(order.id, userId);
          canceledCount++;
        } catch (error) {
          console.error(
            `⚠️ Erro ao cancelar pedido ${order.id}:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      console.log(
        `✅ [OrderService] ${canceledCount} pedido(s) PENDING cancelado(s) com sucesso`
      );

      return { canceled: canceledCount };
    } catch (error: any) {
      console.error(
        `❌ [OrderService] Erro ao canc elar pedidos PENDING anteriores:`,
        error
      );
      throw new Error(
        `Erro ao cancelar pedidos pendentes anteriores: ${error.message}`
      );
    }
  }

  async cleanupAbandonedOrders() {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const abandonedOrders = await prisma.order.findMany({
        where: {
          status: "PENDING",
          created_at: {
            lt: twentyFourHoursAgo,
          },
        },
        select: {
          id: true,
          user_id: true,
          created_at: true,
          google_drive_folder_id: true, // ✅ NOVO
        },
      });

      if (abandonedOrders.length === 0) {
        console.log(
          "ℹ️ [OrderService] Nenhum pedido abandonado encontrado para limpeza"
        );
        return { cleaned: 0 };
      }

      console.log(
        `🧹 [OrderService] Limpando ${abandonedOrders.length} pedido(s) abandonado(s)`
      );

      // ✅ NOVO: Deletar pastas Google Drive em paralelo
      const driveDeletePromises = abandonedOrders
        .filter((order) => order.google_drive_folder_id)
        .map((order) =>
          googleDriveService
            .deleteFolder(order.google_drive_folder_id!)
            .then(() => {
              logger.info(
                `✅ Pasta Google Drive deletada: ${order.google_drive_folder_id}`
              );
            })
            .catch((err) => {
              logger.warn(
                `⚠️ Erro ao deletar pasta Drive ${order.google_drive_folder_id}:`,
                err
              );
              // Não bloquear limpeza se Drive falhar
            })
        );
      await Promise.all(driveDeletePromises);

      let cleanedCount = 0;
      for (const order of abandonedOrders) {
        try {
          await this.cancelOrder(order.id, order.user_id);
          cleanedCount++;
        } catch (error) {
          console.error(
            `⚠️ Erro ao limpar pedido abandonado ${order.id}:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      console.log(
        `✅ [OrderService] ${cleanedCount} pedido(s) abandonado(s) limpo(s) com sucesso`
      );

      return { cleaned: cleanedCount };
    } catch (error: any) {
      console.error(
        `❌ [OrderService] Erro ao limpar pedidos abandonados:`,
        error
      );
      throw new Error(`Erro ao limpar pedidos abandonados: ${error.message}`);
    }
  }

  async deleteAllCanceledOrders() {
    try {
      const canceledOrders = await prisma.order.findMany({
        where: { status: "CANCELED" },
        select: { id: true, google_drive_folder_id: true },
      });

      if (canceledOrders.length === 0) {
        console.log(
          "ℹ️ [OrderService] Nenhum pedido cancelado encontrado para exclusão"
        );
        return { deleted: 0 };
      }

      console.log(
        `🗑️ [OrderService] Iniciando deleção de ${canceledOrders.length} pedido(s) cancelado(s)`
      );

      // ✅ NOVO: Deletar pastas Google Drive em paralelo ANTES de deletar do banco
      const driveDeletePromises = canceledOrders
        .filter((order) => order.google_drive_folder_id)
        .map((order) =>
          googleDriveService
            .deleteFolder(order.google_drive_folder_id!)
            .then(() => {
              logger.info(
                `✅ Pasta Google Drive deletada: ${order.google_drive_folder_id}`
              );
            })
            .catch((err) => {
              logger.warn(
                `⚠️ Erro ao deletar pasta Drive ${order.google_drive_folder_id}:`,
                err
              );
              // Não bloquear deleção se Drive falhar
            })
        );
      await Promise.all(driveDeletePromises);

      await prisma.$transaction(async (tx) => {
        const orderIds = canceledOrders.map((order) => order.id);

        const items = await tx.orderItem.findMany({
          where: { order_id: { in: orderIds } },
          select: { id: true },
        });
        const itemIds = items.map((item) => item.id);

        if (itemIds.length > 0) {
          const deletedCustomizations =
            await tx.orderItemCustomization.deleteMany({
              where: { order_item_id: { in: itemIds } },
            });
          console.log(
            `  ✓ Customizações deletadas: ${deletedCustomizations.count}`
          );

          const deletedAdditionals = await tx.orderItemAdditional.deleteMany({
            where: { order_item_id: { in: itemIds } },
          });
          console.log(`  ✓ Adicionais deletados: ${deletedAdditionals.count}`);
        }

        const deletedItems = await tx.orderItem.deleteMany({
          where: { order_id: { in: orderIds } },
        });
        console.log(`  ✓ Itens do pedido deletados: ${deletedItems.count}`);

        try {
          const deletedPersonalizations = await tx.personalization.deleteMany({
            where: { order_id: { in: orderIds } },
          });
          console.log(
            `  ✓ Personalizações deletadas: ${deletedPersonalizations.count}`
          );
        } catch (err) {
          console.log(
            "  ℹ️ Sem personalizações para deletar (ou erro):",
            (err as any)?.message || err
          );
        }

        try {
          const deletedPayments = await tx.payment.deleteMany({
            where: { order_id: { in: orderIds } },
          });
          console.log(`  ✓ Pagamentos deletados: ${deletedPayments.count}`);
        } catch (err) {
          console.log(
            "  ℹ️ Erro ao deletar pagamentos (podem não existir):",
            (err as any)?.message || err
          );
        }

        const deletedOrders = await tx.order.deleteMany({
          where: { id: { in: orderIds } },
        });
        console.log(`  ✓ Pedidos deletados: ${deletedOrders.count}`);
      });

      console.log(
        `✅ [OrderService] ${canceledOrders.length} pedido(s) cancelado(s) deletado(s) com sucesso`
      );

      return { deleted: canceledOrders.length };
    } catch (error: any) {
      console.error(
        `❌ [OrderService] Erro ao deletar pedidos cancelados:`,
        error
      );
      throw new Error(`Erro ao deletar pedidos cancelados: ${error.message}`);
    }
  }
}

export default new OrderService();
