import { payment, preference, mercadoPagoConfig } from "../config/mercadopago";
import prisma from "../database/prisma";
import fs from "fs/promises";
import type { PaymentStatus, Prisma } from "@prisma/client";
import * as crypto from "crypto-js";
import { mercadoPagoDirectService } from "./mercadoPagoDirectService";
import whatsappService from "./whatsappService";
import orderCustomizationService from "./orderCustomizationService";
import { webhookNotificationService } from "./webhookNotificationService";
import { adminNotificationService } from "./adminNotificationService";
import orderService from "./orderService";
import reservationService from "./reservationService";
import alertService from "./alertService";
import { dispatchPrintForOrder } from "./printDispatchService";
import logger from "../utils/logger";

type OrderWithPaymentDetails = Prisma.OrderGetPayload<{
  include: {
    payment: true;
    items: {
      include: {
        product: true;
        additionals: {
          include: { additional: true };
        };
      };
    };
  };
}>;

const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeOrderPaymentMethod = (
  method?: string | null,
): "pix" | "card" | null => {
  if (!method) return null;
  const normalized = method.trim().toLowerCase();
  if (normalized === "pix") {
    return "pix";
  }
  if (
    normalized === "card" ||
    normalized === "credit_card" ||
    normalized === "debit_card"
  ) {
    return "card";
  }
  return null;
};

const SHIPPING_RULES: Record<string, { pix: number; card: number }> = {
  "campina grande": { pix: 0, card: 10 },
  queimadas: { pix: 15, card: 25 },
  galante: { pix: 15, card: 25 },
  puxinana: { pix: 15, card: 25 },
  "sao jose da mata": { pix: 15, card: 25 },
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export interface CreatePaymentData {
  orderId: string;
  userId: string;
  amount?: number;
  description?: string;
  payerEmail: string;
  payerName?: string;
  payerPhone?: string;
  paymentMethodId?: "pix" | "credit_card" | "debit_card";
  installments?: number;
  token?: string;
  cardToken?: string;
  issuer_id?: string;
  payerDocument?: string;
  payerDocumentType?: "CPF" | "CNPJ";
}

export interface CreatePreferenceData {
  orderId: string;
  userId: string;
  payerEmail: string;
  payerName?: string;
  payerPhone?: string;
  externalReference?: string;
}

export interface ProcessTransparentCheckoutData {
  orderId: string;
  userId: string;
  payerEmail: string;
  payerName: string;
  payerDocument: string;
  payerDocumentType: "CPF" | "CNPJ";
  paymentMethodId: "pix" | "credit_card" | "debit_card";
  cardToken?: string;
  cardholderName?: string;
  installments?: number;
  issuer_id?: string;
  payment_method_id?: string;
  frontendPublicKeyFingerprint?: string;
  frontendPublicKeyPrefix?: string;
}

const buildPaymentIdempotencyKey = (params: {
  orderId: string;
  paymentMethodId: string;
  amount: number;
  paymentDbVersionAt?: number;
}) => {
  const payload = [
    params.orderId,
    params.paymentMethodId,
    String(roundCurrency(params.amount)),
    String(params.paymentDbVersionAt ?? 0),
  ].join("|");

  return crypto.SHA256(payload).toString();
};

export class PaymentService {
  private static notificationSentOrders: Set<string> = new Set();
  private static customizationReadySentOrders: Set<string> = new Set();

  private static splitPersonName(fullName?: string | null) {
    const parts = (fullName || "")
      .split(/\s+/)
      .filter((part) => /[\p{L}\p{N}]/u.test(part));

    return {
      firstName: parts[0] || "Cliente",
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : "Sem Sobrenome",
    };
  }

  private static formatOrderShortId(orderId: string) {
    return orderId.slice(0, 6).toUpperCase();
  }

  private static formatAmountBRL(amount: number) {
    return amount.toFixed(2).replace(".", ",");
  }

  private static resolveCustomerLabel(data: {
    payerName?: string | null;
    payerEmail?: string | null;
    userId?: string | null;
  }) {
    return data.payerName || data.payerEmail || data.userId || "cliente";
  }

  private static logPaymentFlow(params: {
    customerLabel: string;
    stage: string;
    orderId: string;
    amount: number;
  }) {
    logger.info(
      `[cliente ${params.customerLabel}: ${params.stage} para pedido ${this.formatOrderShortId(
        params.orderId,
      )} - R$ ${this.formatAmountBRL(params.amount)}]`,
    );
  }

  private static customizationValueHasImageAssets(value?: string | null) {
    if (!value) return false;

    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;

      if (Array.isArray(parsed.photos) && parsed.photos.length > 0) return true;
      if (Array.isArray(parsed.previews) && parsed.previews.length > 0)
        return true;
      if (
        Array.isArray(parsed.temp_file_ids) &&
        parsed.temp_file_ids.length > 0
      )
        return true;
      if (typeof parsed.temp_file_id === "string" && parsed.temp_file_id)
        return true;
      if (Array.isArray(parsed.files) && parsed.files.length > 0) return true;

      return false;
    } catch {
      return false;
    }
  }

  private static async resolveOrderConfirmationDriveContext(
    orderId: string,
    googleDriveUrl?: string,
  ): Promise<{
    hasImageCustomizations: boolean;
    resolvedGoogleDriveUrl?: string;
  }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        google_drive_folder_url: true,
        items: {
          select: {
            customizations: {
              select: {
                value: true,
                customization: {
                  select: {
                    type: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new Error(`Pedido não encontrado: ${orderId}`);
    }

    const hasImageCustomizations = order.items.some((item) =>
      item.customizations.some(
        (customization) =>
          customization.customization?.type === "IMAGES" ||
          PaymentService.customizationValueHasImageAssets(customization.value),
      ),
    );

    return {
      hasImageCustomizations,
      resolvedGoogleDriveUrl:
        googleDriveUrl || order.google_drive_folder_url || undefined,
    };
  }

  private static runApprovedOrderPostProcessingInBackground(params: {
    orderId: string;
    paymentId: string;
    mercadoPagoId: string;
    paymentMethod?: string;
  }) {
    const { orderId, paymentId, mercadoPagoId, paymentMethod } = params;

    logger.info(
      `🚀 Agendando pós-processamento assíncrono do pedido ${orderId}`,
    );

    void (async () => {
      try {
        const finalizeRes =
          await orderCustomizationService.finalizeOrderCustomizations(orderId);

        logger.info(
          `✅ finalizeOrderCustomizations result (background): ${JSON.stringify(
            finalizeRes,
          )}`,
        );

        webhookNotificationService.notifyPaymentUpdate(orderId, {
          status: "approved",
          paymentId,
          mercadoPagoId,
          approvedAt: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          }),
          paymentMethod,
        });

        await this.sendOrderConfirmationNotificationOnce(
          orderId,
          finalizeRes.folderUrl,
        );
        await this.sendCustomizationReadyNotificationOnce(
          orderId,
          finalizeRes.folderUrl,
        );
      } catch (error) {
        logger.error(
          `⚠️ Erro no pós-processamento assíncrono do pedido ${orderId}:`,
          error,
        );

        webhookNotificationService.notifyPaymentUpdate(orderId, {
          status: "approved",
          paymentId,
          mercadoPagoId,
          approvedAt: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          }),
          paymentMethod,
        });

        try {
          await this.sendOrderConfirmationNotificationOnce(orderId);
        } catch (notifyError) {
          logger.warn(
            `⚠️ Falha ao enviar confirmação WhatsApp fallback para ${orderId}: ${notifyError}`,
          );
        }
      }
    })();
  }

  private static async recoverApprovedOrderPostProcessingIfNeeded(params: {
    orderId: string;
    paymentId: string;
    mercadoPagoId: string;
    paymentMethod?: string;
  }) {
    const { orderId, paymentId, mercadoPagoId, paymentMethod } = params;

    const orderState = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customizations_drive_processed: true,
        confirmation_whatsapp_sent_at: true,
        google_drive_folder_url: true,
      },
    });

    if (!orderState) {
      logger.warn(
        `⚠️ Pedido ${orderId} não encontrado ao tentar recuperar pós-processamento aprovado`,
      );
      return;
    }

    if (
      orderState.customizations_drive_processed &&
      orderState.confirmation_whatsapp_sent_at
    ) {
      logger.info(
        `🟢 Pós-processamento já concluído para ${orderId}; nenhuma recuperação necessária`,
      );
      return;
    }

    logger.warn(
      `🛟 Recuperando pós-processamento pendente do pedido ${orderId} via webhook fallback`,
    );

    const finalizeRes =
      await orderCustomizationService.finalizeOrderCustomizations(orderId);

    const finalDriveUrl =
      finalizeRes.folderUrl || orderState.google_drive_folder_url || undefined;

    webhookNotificationService.notifyPaymentUpdate(orderId, {
      status: "approved",
      paymentId,
      mercadoPagoId,
      approvedAt: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }),
      paymentMethod,
    });

    await this.sendOrderConfirmationNotificationOnce(orderId, finalDriveUrl);
    await this.sendCustomizationReadyNotificationOnce(orderId, finalDriveUrl);
  }

  private static scheduleNotificationCacheRelease(orderId: string) {
    setTimeout(
      () => PaymentService.notificationSentOrders.delete(orderId),
      1000 * 60 * 15,
    );
  }

  private static scheduleCustomizationReadyCacheRelease(cacheKey: string) {
    setTimeout(
      () => PaymentService.customizationReadySentOrders.delete(cacheKey),
      1000 * 60 * 60,
    );
  }

  static async sendCustomizationReadyNotificationOnce(
    orderId: string,
    googleDriveUrl?: string,
  ) {
    if (!googleDriveUrl) {
      return false;
    }

    const cacheKey = `${orderId}:${googleDriveUrl}`;
    if (PaymentService.customizationReadySentOrders.has(cacheKey)) {
      logger.info(
        `🟡 Notificação de customizações prontas já enviada (cache) para ${orderId}, pulando.`,
      );
      return false;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            product: true,
            additionals: {
              include: {
                additional: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      logger.warn(
        `⚠️ Pedido ${orderId} não encontrado para notificação de customizações prontas`,
      );
      return false;
    }

    const items: Array<{ name: string; quantity: number; price: number }> = [];
    order.items.forEach((item) => {
      items.push({
        name: item.product.name,
        quantity: item.quantity,
        price: Number(item.price),
      });

      item.additionals.forEach((additional) => {
        items.push({
          name: additional.additional.name,
          quantity: additional.quantity,
          price: Number(additional.price),
        });
      });
    });

    const notifyResult =
      await whatsappService.sendCustomizationReadyNotification({
        orderId: order.id,
        orderNumber: order.id.substring(0, 8).toUpperCase(),
        customerName: order.user.name,
        customerPhone: order.user.phone || undefined,
        recipientPhone: order.recipient_phone || undefined,
        purchaseDate: order.created_at,
        items,
        googleDriveUrl,
      });

    if (notifyResult.teamSent || notifyResult.customerSent) {
      PaymentService.customizationReadySentOrders.add(cacheKey);
      this.scheduleCustomizationReadyCacheRelease(cacheKey);
      return true;
    }

    return false;
  }

  private static async sendOrderConfirmationNotificationOnce(
    orderId: string,
    googleDriveUrl?: string,
  ) {
    const confirmationContext = await this.resolveOrderConfirmationDriveContext(
      orderId,
      googleDriveUrl,
    );

    if (PaymentService.notificationSentOrders.has(orderId)) {
      logger.info(
        `🟡 Notificação de pedido já enviada (cache) para ${orderId}, pulando.`,
      );
      return false;
    }

    const claimedAt = new Date();
    const claimResult = await prisma.order.updateMany({
      where: {
        id: orderId,
        confirmation_whatsapp_sent_at: null,
      },
      data: {
        confirmation_whatsapp_sent_at: claimedAt,
      },
    });

    if (claimResult.count === 0) {
      logger.info(
        `🟡 Notificação de pedido já foi reivindicada/enviada para ${orderId}, pulando.`,
      );
      PaymentService.notificationSentOrders.add(orderId);
      this.scheduleNotificationCacheRelease(orderId);
      return false;
    }

    try {
      await this.performSendOrderConfirmationNotification(
        orderId,
        confirmationContext.resolvedGoogleDriveUrl,
      );
      PaymentService.notificationSentOrders.add(orderId);
      this.scheduleNotificationCacheRelease(orderId);
      return true;
    } catch (error) {
      await prisma.order.updateMany({
        where: {
          id: orderId,
          confirmation_whatsapp_sent_at: claimedAt,
        },
        data: {
          confirmation_whatsapp_sent_at: null,
        },
      });
      throw error;
    }
  }
  private static resolveShippingPrice(
    order: OrderWithPaymentDetails,
    method: "pix" | "card",
  ) {
    if ((order as any).delivery_method === "pickup") {
      return 0;
    }

    const city = order.delivery_city ? normalizeText(order.delivery_city) : "";
    const rule = SHIPPING_RULES[city];
    if (rule) {
      return rule[method];
    }

    return order.shipping_price ?? 0;
  }
  private static async loadOrderWithDetails(
    orderId: string,
  ): Promise<OrderWithPaymentDetails | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        items: {
          include: {
            product: true,
            additionals: {
              include: { additional: true },
            },
          },
        },
      },
    });
  }

  private static calculateOrderSummary(order: OrderWithPaymentDetails) {
    const itemsTotal = order.items.reduce((sum, item) => {
      const baseTotal = Number(item.price) * item.quantity;
      const additionalsTotal = item.additionals.reduce(
        (acc, additional) =>
          acc + Number(additional.price) * additional.quantity,
        0,
      );
      return sum + baseTotal + additionalsTotal;
    }, 0);

    const total = roundCurrency(itemsTotal);
    const discount = roundCurrency(order.discount ?? 0);
    const shipping = roundCurrency(order.shipping_price ?? 0);
    const computedGrandTotal = roundCurrency(total - discount + shipping);
    const grandTotal = roundCurrency(order.grand_total ?? computedGrandTotal);

    return {
      itemsTotal: roundCurrency(itemsTotal),
      total: roundCurrency(total),
      discount,
      shipping,
      grandTotal,
    };
  }

  private static async ensureOrderTotalsUpToDate(
    order: OrderWithPaymentDetails,
    summary: ReturnType<typeof PaymentService.calculateOrderSummary>,
  ) {
    const needsUpdate =
      roundCurrency(order.total ?? 0) !== summary.total ||
      roundCurrency(order.grand_total ?? 0) !== summary.grandTotal ||
      roundCurrency(order.shipping_price ?? 0) !== summary.shipping;

    if (needsUpdate) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          total: summary.total,
          shipping_price: summary.shipping,
          grand_total: summary.grandTotal,
        },
      });
    }
  }

  private static async ensureOrderCustomizationsReady(orderId: string) {
    const validation =
      await orderCustomizationService.validateOrderForCheckout(orderId);

    if (!validation.valid) {
      const missing = validation.missingRequired
        .slice(0, 3)
        .map((m) => m.reason);
      const invalid = validation.invalidCustomizations
        .slice(0, 3)
        .map((m) => m.reason);

      const details = [...missing, ...invalid].filter(Boolean);
      const detailText =
        details.length > 0 ? ` Detalhes: ${details.join(" | ")}` : "";

      throw new Error(
        `Customizações pendentes ou inválidas para este pedido.${detailText}`,
      );
    }
  }

  static async createPreference(data: CreatePreferenceData) {
    try {
      if (!data.orderId || !data.userId || !data.payerEmail) {
        throw new Error("Dados obrigatórios não fornecidos");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.payerEmail)) {
        throw new Error("Email do pagador inválido");
      }

      let order = await this.loadOrderWithDetails(data.orderId);

      if (!order) {
        throw new Error("Pedido não encontrado");
      }

      if (order.user_id !== data.userId) {
        throw new Error("Pedido não pertence ao usuário informado");
      }

      if (!order.items.length) {
        throw new Error("Pedido sem itens não pode gerar pagamento");
      }

      await orderService.refreshOrderCatalogPrices(order.id);
      const refreshedOrder = await this.loadOrderWithDetails(data.orderId);
      if (!refreshedOrder) {
        throw new Error("Pedido não encontrado após recálculo de preços");
      }
      order = refreshedOrder;

      const orderPaymentMethod = normalizeOrderPaymentMethod(
        order.payment_method,
      );

      if (!orderPaymentMethod) {
        throw new Error("Forma de pagamento do pedido não definida");
      }

      if (order.payment) {
        const existingPayment = order.payment;
        const isProduction = process.env.NODE_ENV === "production";
        const paymentFinalized = ["APPROVED", "AUTHORIZED"].includes(
          existingPayment.status,
        );

        if (isProduction && paymentFinalized) {
          throw new Error("Pedido já possui um pagamento finalizado");
        }

        if (!paymentFinalized) {
          await prisma.payment.delete({
            where: { id: existingPayment.id },
          });
        }
      }

      const summary = this.calculateOrderSummary(order);
      await this.ensureOrderTotalsUpToDate(order, summary);
      await this.ensureOrderCustomizationsReady(data.orderId);

      const { firstName, lastName } = this.splitPersonName(data.payerName);
      const customerLabel = this.resolveCustomerLabel({
        payerName: data.payerName,
        payerEmail: data.payerEmail,
        userId: data.userId,
      });

      this.logPaymentFlow({
        customerLabel,
        stage: "geracao de pagamento",
        orderId: data.orderId,
        amount: summary.grandTotal,
      });

      const externalReference =
        data.externalReference || `ORDER_${data.orderId}_${Date.now()}`;

      const preferenceItems = [
        {
          id: order.id,
          title: `Pedido ${order.id}`,
          description: `Pagamento ${
            orderPaymentMethod === "pix" ? "PIX" : "Cartão"
          } - ${order.items.length} item(s)`,
          category_id: "others",
          quantity: 1,
          unit_price: summary.grandTotal,
        },
      ];

      const paymentMethodsConfig: any = {
        excluded_payment_methods: [] as { id: string }[],
        excluded_payment_types: [] as { id: string }[],
        installments: orderPaymentMethod === "pix" ? 1 : 12,
      };

      if (orderPaymentMethod === "pix") {
        paymentMethodsConfig.excluded_payment_types.push(
          { id: "credit_card" },
          { id: "debit_card" },
          { id: "ticket" },
        );
      } else {
        paymentMethodsConfig.excluded_payment_types.push(
          { id: "bank_transfer" },
          { id: "ticket" },
        );
      }

      const preferenceData = {
        items: preferenceItems,
        payer: {
          email: data.payerEmail,
          first_name: firstName,
          last_name: lastName,
          phone: {
            number: data.payerPhone,
          },
        },
        statement_descriptor: "CESTODAMORE",
        external_reference: externalReference,
        notification_url: `${mercadoPagoConfig.baseUrl}/api/webhook/mercadopago`,
        back_urls: {
          success: `${mercadoPagoConfig.baseUrl}/payment/success`,
          failure: `${mercadoPagoConfig.baseUrl}/payment/failure`,
          pending: `${mercadoPagoConfig.baseUrl}/payment/pending`,
        },
        auto_return: "approved" as const,
        payment_methods: paymentMethodsConfig,
        shipments: {
          mode: "not_specified" as const,
        },
        metadata: {
          order_id: data.orderId,
          user_id: data.userId,
          shipping_price: summary.shipping,
          discount: summary.discount,
          payment_method: orderPaymentMethod,
        },
      };

      const preferenceResponse = await preference.create({
        body: preferenceData,
      });

      this.logPaymentFlow({
        customerLabel,
        stage: "enviando e processando pagamento",
        orderId: data.orderId,
        amount: summary.grandTotal,
      });

      const paymentRecord = await prisma.payment.create({
        data: {
          order_id: data.orderId,
          preference_id: preferenceResponse.id,
          status: "PENDING",
          transaction_amount: summary.grandTotal,
          payment_method: orderPaymentMethod,
          external_reference: externalReference,
        },
      });

      return {
        preference_id: preferenceResponse.id,
        init_point: preferenceResponse.init_point,
        sandbox_init_point: preferenceResponse.sandbox_init_point,
        payment_id: paymentRecord.id,
        external_reference: externalReference,
      };
    } catch (error) {
      logger.error("Erro ao criar preferência:", error);
      throw new Error(
        `Falha ao criar preferência de pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`,
      );
    }
  }

  static async processTransparentCheckout(
    data: ProcessTransparentCheckoutData,
  ) {
    try {
      if (!data.orderId || !data.userId || !data.payerEmail) {
        throw new Error("Dados obrigatórios não fornecidos");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.payerEmail)) {
        throw new Error("Email do pagador inválido");
      }

      if (!data.payerDocument || !data.payerDocumentType) {
        throw new Error("Documento do pagador é obrigatório");
      }

      if (
        (data.paymentMethodId === "credit_card" ||
          data.paymentMethodId === "debit_card") &&
        data.frontendPublicKeyFingerprint &&
        data.frontendPublicKeyFingerprint !==
          mercadoPagoConfig.publicKeyFingerprint
      ) {
        logger.error("❌ Chave pública do frontend não confere com o backend", {
          orderId: data.orderId,
          userId: data.userId,
          backendPublicKeyPrefix: mercadoPagoConfig.publicKeyPrefix,
          backendPublicKeyFingerprint: mercadoPagoConfig.publicKeyFingerprint,
          frontendPublicKeyPrefix: data.frontendPublicKeyPrefix || null,
          frontendPublicKeyFingerprint: data.frontendPublicKeyFingerprint,
        });

        throw new Error(
          "A chave pública do Mercado Pago carregada no navegador não corresponde à configuração atual do servidor. Recarregue a página para atualizar o checkout e tente novamente.",
        );
      }

      let order = await this.loadOrderWithDetails(data.orderId);

      if (!order) {
        logger.error(
          `[ProcessPayment] Pedido ${data.orderId} não encontrado no banco de dados para o usuário ${data.userId}`,
        );
        throw new Error("Pedido não encontrado");
      }

      if (order.user_id !== data.userId) {
        throw new Error("Pedido não pertence ao usuário informado");
      }

      if (!order.items.length) {
        throw new Error("Pedido não possui itens");
      }

      let orderPaymentMethod = normalizeOrderPaymentMethod(
        order.payment_method,
      );

      const desiredMethod = data.paymentMethodId
        ? normalizeOrderPaymentMethod(data.paymentMethodId)
        : null;

      if (!orderPaymentMethod && desiredMethod) {
        orderPaymentMethod = desiredMethod;
      }

      if (desiredMethod && orderPaymentMethod !== desiredMethod) {
        orderPaymentMethod = desiredMethod;
      }

      if (orderPaymentMethod) {
        if (order.payment_method !== orderPaymentMethod) {
          try {
            await prisma.order.update({
              where: { id: order.id },
              data: { payment_method: orderPaymentMethod },
            });
            logger.info(
              `🛠️ Pedido ${order.id} atualizado com payment_method: ${orderPaymentMethod}`,
            );
          } catch (upErr) {
            logger.warn(
              "⚠️ Não foi possível atualizar payment_method do pedido:",
              upErr,
            );
          }
        }
      }

      if (!orderPaymentMethod) {
        throw new Error("Método de pagamento do pedido inválido");
      }

      const resolvedShipping = this.resolveShippingPrice(
        order,
        orderPaymentMethod,
      );

      if (Number(order.shipping_price ?? 0) !== resolvedShipping) {
        try {
          await prisma.order.update({
            where: { id: order.id },
            data: { shipping_price: resolvedShipping },
          });
          order.shipping_price = resolvedShipping;
        } catch (shippingErr) {
          logger.warn(
            "⚠️ Não foi possível atualizar frete do pedido:",
            shippingErr,
          );
        }
      }

      await orderService.refreshOrderCatalogPrices(order.id);
      const refreshedOrder = await this.loadOrderWithDetails(data.orderId);
      if (!refreshedOrder) {
        throw new Error("Pedido não encontrado após recálculo de preços");
      }
      order = refreshedOrder;

      if (order.payment) {
        if (order.payment.status === "APPROVED") {
          throw new Error("Pedido já possui pagamento aprovado");
        }

        if (
          order.payment.status === "PENDING" ||
          order.payment.status === "IN_PROCESS" ||
          order.payment.status === "REJECTED" ||
          order.payment.status === "CANCELLED"
        ) {
          // Se pagamento está pendente/em processamento, não deleta - retorna existente
          if (
            order.payment.mercado_pago_id &&
            (order.payment.status === "PENDING" || order.payment.status === "IN_PROCESS")
          ) {
            logger.info(`♻️ Pagamento existente encontrado (${order.payment.status}): ${order.payment.mercado_pago_id}, retornando sem criar novo`);
            return order.payment;
          }

          // Só deleta se REJECTED ou CANCELLED
          if (
            order.payment.mercado_pago_id &&
            (order.payment.status === "REJECTED" || order.payment.status === "CANCELLED")
          ) {
            try {
              logger.info(
                `🔄 Cancelando pagamento anterior: ${order.payment.mercado_pago_id}`,
              );
              await this.cancelPayment(order.payment.mercado_pago_id);
            } catch (cancelError) {
              logger.warn(
                "⚠️ Não foi possível cancelar pagamento anterior:",
                cancelError,
              );
            }
          }

          // Deleta pagamento anterior para criar novo
          // (não pode desvincular pois order_id é obrigatório no schema)
          logger.info(`🗑️ Deletando payment ${order.payment.id} antes de criar novo`);
          await prisma.payment.delete({
            where: { id: order.payment.id },
          });

          // Delay maior para garantir que o delete foi propagado
          await new Promise(resolve => setTimeout(resolve, 500));

          logger.info(
            `♻️ Pagamento anterior removido (status era: ${order.payment.status}). Criando novo pagamento ${data.paymentMethodId}...`,
          );
        }
      }

      const summary = this.calculateOrderSummary(order);
      await this.ensureOrderTotalsUpToDate(order, summary);
      await this.ensureOrderCustomizationsReady(data.orderId);

      const customerLabel = this.resolveCustomerLabel({
        payerName: data.payerName,
        payerEmail: data.payerEmail,
        userId: data.userId,
      });

      const payerNameParts = this.splitPersonName(data.payerName);

      this.logPaymentFlow({
        customerLabel,
        stage: "geracao de pagamento",
        orderId: data.orderId,
        amount: summary.grandTotal,
      });

      const paymentData: any = {
        transaction_amount: roundCurrency(summary.grandTotal),
        description: `Pedido ${order.id.substring(0, 8)} - ${
          order.items.length
        } item(s)`,
        payment_method_id: data.paymentMethodId,
        payer: {
          email: data.payerEmail,
          first_name: mercadoPagoConfig.accessToken?.startsWith("TEST-") ? "APRO" : (data.payerName?.split(" ")[0] || ""),
          last_name: mercadoPagoConfig.accessToken?.startsWith("TEST-") ? "" : (data.payerName?.split(" ").slice(1).join(" ") || ""),
          identification: {
            type: data.payerDocumentType,
            number: data.payerDocument.replace(/\D/g, ""),
          },
        },
        external_reference: `ORDER_${data.orderId}_${Date.now()}`,
        notification_url: `${mercadoPagoConfig.baseUrl}/api/webhook/mercadopago`,
        metadata: {
          order_id: data.orderId,
          user_id: data.userId,
          shipping_price: summary.shipping,
          discount: summary.discount,
          payment_method: orderPaymentMethod,
        },
      };

      if (data.paymentMethodId === "pix") {
        paymentData.payment_method_id = "pix";
      } else {
        if (!data.cardToken) {
          throw new Error(
            "Token do cartão é obrigatório para pagamento com cartão",
          );
        }

        paymentData.payment_method_id = data.payment_method_id || "master";
        paymentData.token = data.cardToken;
        paymentData.installments = data.installments || 1;

        if (data.issuer_id) {
          paymentData.issuer_id = data.issuer_id;
        }

        paymentData.payer = {
          email: data.payerEmail,
          first_name: mercadoPagoConfig.accessToken?.startsWith("TEST-") ? "APRO" : (data.payerName?.split(" ")[0] || ""),
          last_name: mercadoPagoConfig.accessToken?.startsWith("TEST-") ? "" : (data.payerName?.split(" ").slice(1).join(" ") || ""),
          identification: {
            type: data.payerDocumentType,
            number: data.payerDocument.replace(/\D/g, ""),
          },
        };

        paymentData.additional_info = {
          payer: {
            phone: {
              area_code: "",
              number: "",
            },
            address: {
              zip_code: "",
              street_name: "",
              street_number: 0,
            },
          },
        };

        paymentData.statement_descriptor = "CESTO D'AMORE";
      }

      const idempotencyKey = buildPaymentIdempotencyKey({
        orderId: data.orderId,
        paymentMethodId: data.paymentMethodId,
        amount: summary.grandTotal,
        paymentDbVersionAt: (order as any).updated_at
          ? new Date((order as any).updated_at).getTime()
          : 0,
      });

      this.logPaymentFlow({
        customerLabel,
        stage: "enviando e processando pagamento",
        orderId: data.orderId,
        amount: summary.grandTotal,
      });

      logger.info('📞 Chamando MP SDK payment.create:', {
        orderId: data.orderId,
        paymentMethodId: data.paymentMethodId,
        amount: summary.grandTotal,
        idempotencyKey,
      });

      logger.info('📦 Payload completo enviado ao MP:', JSON.stringify(paymentData, null, 2));

      const paymentResponse = await payment.create({
        body: paymentData,
        requestOptions: {
          idempotencyKey,
        },
      });

      logger.info('✅ MP SDK payment.create respondeu:', {
        orderId: data.orderId,
        mercadoPagoId: paymentResponse.id,
        status: paymentResponse.status,
        statusDetail: paymentResponse.status_detail,
      });

      logger.info('💾 Executando upsert no banco:', {
        orderId: data.orderId,
        mercadoPagoId: String(paymentResponse.id),
        status: this.mapPaymentStatus(paymentResponse.status || "pending"),
      });

      const paymentRecord = await prisma.payment.upsert({
        where: {
          order_id: data.orderId,
        },
        update: {
          mercado_pago_id: String(paymentResponse.id),
          status: this.mapPaymentStatus(paymentResponse.status || "pending"),
          transaction_amount: summary.grandTotal,
          payment_method: orderPaymentMethod,
          external_reference: paymentData.external_reference,
        },
        create: {
          order_id: data.orderId,
          mercado_pago_id: String(paymentResponse.id),
          status: this.mapPaymentStatus(paymentResponse.status || "pending"),
          transaction_amount: summary.grandTotal,
          payment_method: orderPaymentMethod,
          external_reference: paymentData.external_reference,
        },
      });

      logger.info('✅ Payment salvo no banco:', {
        id: paymentRecord.id,
        orderId: paymentRecord.order_id,
        mercadoPagoId: paymentRecord.mercado_pago_id,
        status: paymentRecord.status,
      });

      if (paymentResponse.status === "approved") {
        await orderService.updateOrderStatus(data.orderId, "PAID", {
          notifyCustomer: false,
        });

        this.runApprovedOrderPostProcessingInBackground({
          orderId: data.orderId,
          paymentId: paymentRecord.id,
          mercadoPagoId: String(paymentResponse.id),
          paymentMethod: paymentData.payment_method_id || undefined,
        });
      } else {
        webhookNotificationService.notifyPaymentUpdate(data.orderId, {
          status: this.mapPaymentStatus(paymentResponse.status || "pending"),
          paymentId: paymentRecord.id,
          mercadoPagoId: String(paymentResponse.id),
          paymentMethod: data.paymentMethodId || undefined,
        });

        logger.info(
          `📤 Notificação SSE enviada (checkout transparente) - Pedido ${
            data.orderId
          } status: ${paymentResponse.status}`,
        );
      }

      return {
        payment_id: paymentResponse.id,
        mercado_pago_id: String(paymentResponse.id),
        status: paymentResponse.status,
        status_detail: paymentResponse.status_detail,
        payment_record_id: paymentRecord.id,
        external_reference: paymentData.external_reference,
        amount: summary.grandTotal,
        transaction_amount: summary.grandTotal,
        ...(data.paymentMethodId === "pix" && {
          qr_code:
            paymentResponse.point_of_interaction?.transaction_data?.qr_code,
          qr_code_base64:
            paymentResponse.point_of_interaction?.transaction_data
              ?.qr_code_base64,
          ticket_url:
            paymentResponse.point_of_interaction?.transaction_data?.ticket_url,
          expires_at: paymentResponse.date_of_expiration,
          payer_info: {
            id: paymentResponse.payer?.id,
            email: paymentResponse.payer?.email || data.payerEmail,
            first_name:
              paymentResponse.payer?.first_name || payerNameParts.firstName,
            last_name:
              paymentResponse.payer?.last_name || payerNameParts.lastName,
          },
        }),
      };
    } catch (error) {
      logger.error("Erro ao processar checkout transparente:", error);

      if (error && typeof error === "object") {
        const serializedError = JSON.stringify(
          error,
          Object.getOwnPropertyNames(error),
          2,
        );
        logger.error("📛 Detalhes completos do erro:", serializedError);

        const mpError = error as any;
        if (mpError.cause) {
          logger.error(
            "📛 Causa do erro:",
            JSON.stringify(mpError.cause, null, 2),
          );
        }
        if (mpError.response) {
          logger.error(
            "📛 Resposta da API:",
            JSON.stringify(mpError.response, null, 2),
          );
        }
        if (mpError.status || mpError.statusCode) {
          logger.error("📛 Status HTTP:", mpError.status || mpError.statusCode);
        }
      }

      let errorMessage = "Erro desconhecido";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error && typeof error === "object") {
        const mpError = error as any;
        if (mpError.cause && mpError.cause.message) {
          errorMessage = mpError.cause.message;
        } else if (mpError.message) {
          errorMessage = mpError.message;
        }
      }

      const paymentError = new Error(
        `Falha ao processar pagamento: ${errorMessage}`,
      ) as any;
      if (error && typeof error === "object") {
        const mpError = error as any;
        paymentError.cause = mpError.cause;
        paymentError.response = mpError.response;
      }
      throw paymentError;
    }
  }

  static async createPayment(data: CreatePaymentData) {
    try {
      const { orderId, userId, payerEmail } = data;

      if (!orderId || !userId || !payerEmail) {
        throw new Error("Dados obrigatórios não fornecidos");
      }

      if (
        data.amount !== undefined &&
        (typeof data.amount !== "number" || data.amount <= 0)
      ) {
        throw new Error("Valor informado deve ser um número positivo");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(payerEmail)) {
        throw new Error("Email do pagador inválido");
      }

      const order = await this.loadOrderWithDetails(orderId);

      if (!order) {
        logger.error(
          `[CreatePayment] Pedido ${orderId} não encontrado no banco de dados para o usuário ${userId}`,
        );
        throw new Error("Pedido não encontrado");
      }

      if (order.user_id !== userId) {
        throw new Error("Pedido não pertence ao usuário informado");
      }

      if (!order.items.length) {
        throw new Error("Pedido sem itens não pode ser pago");
      }

      const summary = this.calculateOrderSummary(order);
      await this.ensureOrderTotalsUpToDate(order, summary);
      await this.ensureOrderCustomizationsReady(orderId);

      const amount = roundCurrency(data.amount ?? summary.grandTotal);
      if (amount <= 0) {
        throw new Error("Valor total do pedido inválido");
      }

      const normalizedOrderMethod = normalizeOrderPaymentMethod(
        order.payment_method,
      );
      const resolvedMethod =
        data.paymentMethodId ??
        (normalizedOrderMethod === "pix" ? "pix" : "credit_card");

      if (!["pix", "credit_card", "debit_card"].includes(resolvedMethod)) {
        throw new Error(
          "Método de pagamento inválido. Use: pix, credit_card ou debit_card",
        );
      }

      const requiresToken =
        resolvedMethod === "credit_card" || resolvedMethod === "debit_card";

      if (requiresToken && !data.token) {
        throw new Error(
          "Token do cartão é obrigatório para pagamentos com cartão",
        );
      }

      const installments =
        requiresToken && data.installments && data.installments > 0
          ? Math.floor(data.installments)
          : 1;

      const mercadoPagoResult = await mercadoPagoDirectService.execute({
        transaction_amount: amount,
        token: requiresToken ? data.token! : undefined,
        description: data.description ?? `Pedido ${order.id}`,
        installments,
        payment_method_id: resolvedMethod,
        email: payerEmail,
      });

      if (mercadoPagoResult.httpStatus !== 201) {
        throw new Error("Falha de pagamento!");
      }

      const paymentStatus = this.mapPaymentStatus(mercadoPagoResult.status);

      const cardMetadata =
        mercadoPagoResult.first_six_digits ||
        mercadoPagoResult.last_four_digits ||
        mercadoPagoResult.cardholder_name
          ? {
              card: {
                first_six_digits: mercadoPagoResult.first_six_digits,
                last_four_digits: mercadoPagoResult.last_four_digits,
                cardholder_name: mercadoPagoResult.cardholder_name,
              },
            }
          : null;

      const paymentRecord = await prisma.payment.upsert({
        where: { order_id: order.id },
        update: {
          mercado_pago_id: mercadoPagoResult.id,
          payment_method: mercadoPagoResult.payment_method_id ?? resolvedMethod,
          payment_type: mercadoPagoResult.payment_type_id,
          status: paymentStatus,
          transaction_amount: amount,
          external_reference: order.id,
          fee_details: cardMetadata ? JSON.stringify(cardMetadata) : undefined,
          net_received_amount:
            (mercadoPagoResult.raw as any)?.transaction_details
              ?.net_received_amount ?? undefined,
          approved_at:
            mercadoPagoResult.status === "approved" ? new Date() : null,
          last_webhook_at: new Date(),
        },
        create: {
          order_id: order.id,
          mercado_pago_id: mercadoPagoResult.id,
          payment_method: mercadoPagoResult.payment_method_id ?? resolvedMethod,
          payment_type: mercadoPagoResult.payment_type_id,
          status: paymentStatus,
          transaction_amount: amount,
          external_reference: order.id,
          fee_details: cardMetadata ? JSON.stringify(cardMetadata) : undefined,
          net_received_amount:
            (mercadoPagoResult.raw as any)?.transaction_details
              ?.net_received_amount ?? undefined,
          approved_at:
            mercadoPagoResult.status === "approved" ? new Date() : null,
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: {
          payment_method: resolvedMethod === "pix" ? "pix" : "card",
          status:
            mercadoPagoResult.status === "approved" ? "PAID" : order.status,
          pending_owner_key:
            mercadoPagoResult.status === "approved" ? null : undefined,
          grand_total: amount,
        },
      });

      if (mercadoPagoResult.status === "approved") {
        orderCustomizationService
          .finalizeOrderCustomizations(order.id)
          .then(async (customizationResult) => {
            logger.info(
              "✅ Customizações finalizadas com sucesso (background):",
              customizationResult,
            );

            if (customizationResult.folderId) {
              try {
                const orderWithUser = await prisma.order.findUnique({
                  where: { id: order.id },
                  include: {
                    user: true,
                    items: {
                      include: { product: true },
                    },
                  },
                });

                if (!orderWithUser) {
                  logger.error(`Ordem não encontrada: ${order.id}`);
                  return;
                }

                await prisma.order.update({
                  where: { id: order.id },
                  data: {
                    google_drive_folder_id: customizationResult.folderId,
                    google_drive_folder_url: customizationResult.folderUrl,
                    customizations_drive_processed: true,
                    customizations_drive_processed_at: new Date(),
                  },
                });
                logger.info(
                  `📁 Ordem ${order.id} atualizada com Drive folder: ${customizationResult.folderId}`,
                );

                await this.sendOrderConfirmationNotificationOnce(
                  order.id,
                  customizationResult.folderUrl,
                );
                await this.sendCustomizationReadyNotificationOnce(
                  order.id,
                  customizationResult.folderUrl,
                );
              } catch (updateErr) {
                logger.error(
                  `⚠️ Erro ao atualizar ordem com Drive folder:`,
                  updateErr,
                );
              }
            }
          })
          .catch((finalizeErr) => {
            logger.error(
              "⚠️ Erro ao finalizar customizações após pagamento aprovada (background, continuando):",
              finalizeErr,
            );
          });
      }

      return {
        payment_id: paymentRecord.id,
        mercado_pago_id: mercadoPagoResult.id,
        status: mercadoPagoResult.status,
        status_detail: mercadoPagoResult.status_detail,
        amount,
        date_approved: mercadoPagoResult.date_approved,
        payment_method_id:
          mercadoPagoResult.payment_method_id ?? resolvedMethod,
        payment_type_id: mercadoPagoResult.payment_type_id,
        card: {
          first_six_digits: mercadoPagoResult.first_six_digits,
          last_four_digits: mercadoPagoResult.last_four_digits,
          cardholder_name: mercadoPagoResult.cardholder_name,
        },
        raw: mercadoPagoResult.raw,
      };
    } catch (error) {
      logger.error("❌ Erro ao criar pagamento:", error);
      throw new Error(
        `Falha ao criar pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`,
      );
    }
  }

  static async getPaymentMethods() {
    try {
      if (process.env.NODE_ENV === "development") {
        return {
          results: [
            {
              id: "visa",
              name: "Visa",
              payment_type_id: "credit_card",
              status: "active",
              secure_thumbnail:
                "https://www.mercadopago.com/org-img/MP3/API/logos/visa.gif",
              thumbnail:
                "https://www.mercadopago.com/org-img/MP3/API/logos/visa.gif",
              deferred_capture: "supported",
              settings: [],
              additional_info_needed: [
                "cardholder_name",
                "cardholder_identification_number",
              ],
              min_allowed_amount: 0.5,
              max_allowed_amount: 250000,
              accreditation_time: 2880,
              financial_institutions: [],
              processing_modes: ["aggregator"],
            },
            {
              id: "master",
              name: "Mastercard",
              payment_type_id: "credit_card",
              status: "active",
              secure_thumbnail:
                "https://www.mercadopago.com/org-img/MP3/API/logos/master.gif",
              thumbnail:
                "https://www.mercadopago.com/org-img/MP3/API/logos/master.gif",
              deferred_capture: "supported",
              settings: [],
              additional_info_needed: [
                "cardholder_name",
                "cardholder_identification_number",
              ],
              min_allowed_amount: 0.5,
              max_allowed_amount: 250000,
              accreditation_time: 2880,
              financial_institutions: [],
              processing_modes: ["aggregator"],
            },
            {
              id: "pix",
              name: "PIX",
              payment_type_id: "bank_transfer",
              status: "active",
              secure_thumbnail:
                "https://www.mercadopago.com/org-img/other/pix/logo-pix-color.png",
              thumbnail:
                "https://www.mercadopago.com/org-img/other/pix/logo-pix-color.png",
              deferred_capture: "does_not_apply",
              settings: [],
              additional_info_needed: [],
              min_allowed_amount: 0.01,
              max_allowed_amount: 1000000,
              accreditation_time: 0,
              financial_institutions: [],
              processing_modes: ["aggregator"],
            },
          ],
        };
      }

      const response = await fetch(
        "https://api.mercadopago.com/v1/payment_methods",
        {
          headers: {
            Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Erro ao buscar métodos de pagamento");
      }

      const paymentMethods = await response.json();
      return paymentMethods;
    } catch (error) {
      logger.error("Erro ao buscar métodos de pagamento:", error);
      throw new Error(
        `Falha ao buscar métodos de pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`,
      );
    }
  }

  static async getInstallmentOptions(
    amount: number,
    paymentMethodId: string,
    bin?: string,
  ) {
    try {
      const params = new URLSearchParams({
        amount: amount.toString(),
        payment_method_id: paymentMethodId,
        locale: "pt-BR",
      });

      if (bin) {
        params.append("bin", bin);
      }

      const url = `https://api.mercadopago.com/v1/payment_methods/installments?${params.toString()}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Erro ao buscar opções de parcelamento: ${response.statusText}`,
        );
      }

      const data = await response.json();

      if (data && data.length > 0 && data[0].payer_costs) {
        return {
          payment_method_id: data[0].payment_method_id,
          payment_type_id: data[0].payment_type_id,
          issuer: data[0].issuer,
          payer_costs: data[0].payer_costs.map((cost: any) => ({
            installments: cost.installments,
            installment_rate: cost.installment_rate,
            discount_rate: cost.discount_rate,
            labels: cost.labels,
            min_allowed_amount: cost.min_allowed_amount,
            max_allowed_amount: cost.max_allowed_amount,
            recommended_message: cost.recommended_message,
            installment_amount: cost.installment_amount,
            total_amount: cost.total_amount,
            payment_method_option_id: cost.payment_method_option_id,
          })),
        };
      }

      return this.getDefaultInstallmentOptions(amount);
    } catch (error) {
      logger.error("Erro ao buscar opções de parcelamento:", error);

      return this.getDefaultInstallmentOptions(amount);
    }
  }

  private static getDefaultInstallmentOptions(amount: number) {
    const installments = [];

    for (let i = 1; i <= 12; i++) {
      const installmentAmount = amount / i;
      const totalAmount = amount;

      installments.push({
        installments: i,
        installment_rate: 0,
        discount_rate: 0,
        labels: i === 1 ? ["CFT_ZERO"] : [],
        min_allowed_amount: 0,
        max_allowed_amount: 999999,
        recommended_message:
          i === 1
            ? `1 parcela de R$ ${installmentAmount.toFixed(2)} sem juros`
            : `${i} parcelas de R$ ${installmentAmount.toFixed(2)}`,
        installment_amount: roundCurrency(installmentAmount),
        total_amount: roundCurrency(totalAmount),
      });
    }

    return {
      payment_method_id: "unknown",
      payment_type_id: "credit_card",
      issuer: null,
      payer_costs: installments,
    };
  }

  static async getPayment(paymentId: string) {
    try {
      // Se o paymentId parece ser um UUID, busca no banco primeiro
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          paymentId,
        );

      if (isUuid) {
        // É um UUID do nosso banco, busca o mercado_pago_id
        const dbPayment = await prisma.payment.findUnique({
          where: { id: paymentId },
          select: { mercado_pago_id: true },
        });

        if (!dbPayment?.mercado_pago_id) {
          throw new Error("Pagamento ainda não possui ID do Mercado Pago");
        }

        paymentId = dbPayment.mercado_pago_id;
      }

      const paymentInfo = await payment.get({ id: paymentId });
      return paymentInfo;
    } catch (error) {
      logger.error("Erro ao buscar pagamento:", error);

      const mpError = error as any;
      const errorStatus = Number(
        mpError?.status || mpError?.response?.status || 0,
      );
      const errorDescription =
        mpError?.cause?.[0]?.description || mpError?.message || "";
      const paymentNotFound =
        errorStatus === 404 ||
        String(errorDescription).toLowerCase().includes("payment not found");

      if (paymentNotFound) {
        const notFoundError = new Error(
          "Falha ao buscar pagamento: Payment not found",
        ) as any;
        notFoundError.code = "MP_PAYMENT_NOT_FOUND";
        notFoundError.status = 404;
        throw notFoundError;
      }

      const normalizedMessage =
        mpError?.message ||
        mpError?.cause?.[0]?.description ||
        "Erro desconhecido";

      throw new Error(`Falha ao buscar pagamento: ${normalizedMessage}`);
    }
  }

  static async reprocessFailedFinalizations(maxAttempts = 5) {
    try {
      const logs = await prisma.webhookLog.findMany({
        where: {
          processed: true,
          finalization_succeeded: false,
          finalization_attempts: { lt: maxAttempts },
          topic: "payment",
        },
      });

      for (const log of logs) {
        try {
          const paymentId = log.resource_id;
          const dbPayment = await prisma.payment.findFirst({
            where: { mercado_pago_id: paymentId },
            include: { order: true },
          });

          if (!dbPayment || !dbPayment.order_id) {
            logger.warn(`Reprocess: pagamento ${paymentId} sem order_id (provavelmente deletado/substituído), marcando como finalizado`);
            await prisma.webhookLog.updateMany({
              where: { id: log.id },
              data: {
                finalization_succeeded: true,
                finalization_attempts: { increment: 1 } as any,
                error_message: "Pagamento não encontrado no banco (deletado/substituído)",
              },
            });
            continue;
          }

          if (dbPayment.status !== "APPROVED") {
            logger.warn(
              `Reprocess: pagamento ${paymentId} não aprovado (status: ${dbPayment.status}), pulando.`,
            );
            await prisma.webhookLog.updateMany({
              where: { id: log.id },
              data: { finalization_attempts: { increment: 1 } as any },
            });
            continue;
          }

          console.log(
            `🔁 Reprocessando finalização - orderId=${dbPayment.order_id}`,
          );
          const finalizeRes =
            await orderCustomizationService.finalizeOrderCustomizations(
              dbPayment.order_id,
            );
          const succeeded = !finalizeRes?.base64Detected;
          await prisma.webhookLog.updateMany({
            where: { id: log.id },
            data: {
              finalization_succeeded: succeeded,
              finalization_attempts: { increment: 1 } as any,
              error_message: succeeded
                ? undefined
                : `Base64 left in customizations: ${finalizeRes.base64AffectedIds?.join(
                    ",",
                  )}`,
            },
          });
        } catch (err: any) {
          logger.error("Erro ao reprocessar finalização:", err);
          await prisma.webhookLog.updateMany({
            where: { id: log.id },
            data: {
              finalization_succeeded: false,
              finalization_attempts: { increment: 1 } as any,
              error_message: String(err?.message || err),
            },
          });
        }
      }
    } catch (err) {
      logger.error("Erro ao buscar logs para reprocessamento:", err);
    }
  }

  static async reprocessFinalizationForOrder(orderId: string) {
    try {
      const finalizeRes =
        await orderCustomizationService.finalizeOrderCustomizations(orderId);

      const payment = await prisma.payment.findUnique({
        where: { order_id: orderId },
      });
      if (payment && payment.mercado_pago_id) {
        const succeeded = !finalizeRes?.base64Detected;
        await prisma.webhookLog.updateMany({
          where: { resource_id: payment.mercado_pago_id, topic: "payment" },
          data: {
            finalization_succeeded: succeeded,
            finalization_attempts: { increment: 1 } as any,
            error_message: succeeded
              ? undefined
              : `Base64 left: ${finalizeRes.base64AffectedIds?.join(",")}`,
          },
        });
      }

      return finalizeRes;
    } catch (error) {
      logger.error(
        "Erro ao reprocessar finalização para pedido:",
        orderId,
        error,
      );
      throw error;
    }
  }

  static async processWebhookNotification(data: any, headers: any) {
    try {
      const isTestWebhook =
        data.live_mode === false && data.data?.id === "123456";

      if (isTestWebhook) {
        logger.info("✅ Test webhook received");
        return {
          success: true,
          message: "Test webhook received successfully",
        };
      }

      if (data.action === "payment.created") {
        const createdPaymentId = data.data?.id?.toString();
        logger.info("🔔 [Webhook MP] Criação de pagamento recebida", {
          paymentId: createdPaymentId,
        });

        // Verifica se o pagamento já existe no banco e sincroniza status
        if (createdPaymentId) {
          const existsInDb = await prisma.payment.findFirst({
            where: { mercado_pago_id: createdPaymentId },
          });
          if (existsInDb) {
            await this.processPaymentNotification(createdPaymentId);
          }
        }

        return {
          success: true,
          message: "Webhook de criação processado",
        };
      }

      let webhookType = data.type || data.topic;
      if (!webhookType && data.action) {
        webhookType = data.action.split(".")[0];
      }

      const resourceId =
        (data.data && data.data.id && data.data.id.toString()) ||
        (data.resource && data.resource.toString()) ||
        undefined;
      const webhookAction = data.action || `${webhookType}.updated`;

      if (!resourceId || !webhookType) {
        logger.error("❌ Webhook inválido - sem ID de recurso ou tipo", {
          resourceId: resourceId || null,
          webhookType: webhookType || null,
          action: data.action || null,
          type: data.type || null,
          topic: data.topic || null,
          keys: Object.keys(data || {}),
        });
        return {
          success: false,
          message: "Webhook sem dados válidos",
        };
      }

      logger.info(
        `[webhook mp: acao ${webhookAction} recurso ${resourceId} tipo ${webhookType}]`,
      );

      const existingLog = await prisma.webhookLog.findFirst({
        where: {
          resource_id: resourceId,
          topic: webhookType,
          processed: true,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      if (existingLog) {
        try {
          const paymentInfo = await this.getPayment(resourceId);
          const dbPayment = await prisma.payment.findFirst({
            where: { mercado_pago_id: resourceId },
          });
          const mpStatus = (paymentInfo?.status || "").toLowerCase();
          const dbStatus = dbPayment?.status?.toLowerCase() || null;
          if (mpStatus === "approved" && dbStatus !== "approved") {
            logger.warn("🟡 [Webhook MP] Reprocessando pagamento aprovado", {
              paymentId: resourceId,
            });

            await this.processPaymentNotification(resourceId);

            await prisma.webhookLog.updateMany({
              where: { resource_id: resourceId, topic: webhookType },
              data: { processed: true },
            });
            return {
              success: true,
              message:
                "Webhook reprocessado para sincronizar estado de pagamento",
            };
          }
        } catch (err) {
          logger.error(
            "Erro ao verificar estado do pagamento para webhooks duplicados:",
            err,
          );
        }

        logger.info("ℹ️ [Webhook MP] Evento duplicado ignorado", {
          paymentId: resourceId,
        });
        return {
          success: true,
          message: "Webhook já processado anteriormente (duplicado ignorado)",
        };
      }

      logger.info("📝 [Webhook MP] Registrando evento", {
        paymentId: resourceId,
      });

      const preExistingLog = await prisma.webhookLog.findFirst({
        where: {
          resource_id: resourceId,
          topic: webhookType,
          processed: false,
        },
        orderBy: { created_at: "desc" },
      });

      if (!preExistingLog) {
        await prisma.webhookLog.create({
          data: {
            payment_id: resourceId,
            topic: webhookType,
            resource_id: resourceId,
            raw_data: JSON.stringify(data),
            processed: false,
            finalization_succeeded: false,
            finalization_attempts: 0,
          },
        });
      }

      let processedPayment: boolean | undefined = undefined;
      switch (webhookType) {
        case "payment":
          logger.info(`[webhook mp: processando pagamento ${resourceId}]`);
          processedPayment = await this.processPaymentNotification(resourceId);

          break;
        case "merchant_order":
          await this.processMerchantOrderNotification(resourceId);
          break;
        default:
          logger.info("ℹ️ [Webhook MP] Tipo de evento não processado", {
            type: webhookType,
          });
      }

      if (processedPayment) {
        await prisma.webhookLog.updateMany({
          where: {
            resource_id: resourceId,
            topic: webhookType,
          },
          data: {
            processed: true,
          },
        });
      } else {
        logger.warn(
          "⚠️ Webhook processing completed but payment was NOT processed (not updating webhookLog.processed)",
          { resourceId, topic: webhookType },
        );
      }

      return {
        success: true,
        message: "Webhook processado com sucesso",
      };
    } catch (error: any) {
      logger.error("Erro ao processar webhook:", error);

      const isPrismaDBUnreachable =
        (error && (error.code === "P1001" || error?.meta?.code === "P1001")) ||
        false;

      if (isPrismaDBUnreachable) {
        try {
          const logEntry = {
            timestamp: new Date().toISOString(),
            error: String(error?.message || "Prisma P1001 - DB unreachable"),
            payload: data,
          };
          await fs.appendFile(
            process.env.WEBHOOK_OFFLINE_LOG_FILE ||
              "./webhook_offline_log.ndjson",
            JSON.stringify(logEntry) + "\n",
          );
          logger.warn(
            "⚠️ Webhook armazenado localmente por indisponibilidade do BD",
          );
        } catch (fileErr) {
          logger.error("Falha ao salvar webhook offline:", fileErr);
        }

        return {
          success: true,
          message:
            "Webhook armazenado localmente devido à indisponibilidade do banco, processará posteriormente",
        };
      }

      const resourceId = data?.data?.id?.toString();
      const webhookType = data?.type || data?.action?.split(".")[0];

      if (resourceId && webhookType) {
        await prisma.webhookLog.updateMany({
          where: {
            resource_id: resourceId,
            topic: webhookType,
          },
          data: {
            error_message:
              error instanceof Error ? error.message : "Erro desconhecido",
          },
        });
      }

      throw error;
    }
  }

  static async replayStoredWebhooks() {
    const filePath =
      process.env.WEBHOOK_OFFLINE_LOG_FILE || "./webhook_offline_log.ndjson";
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      const failed: string[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          await PaymentService.processWebhookNotification(entry.payload, {});
        } catch (err) {
          logger.error("Falha ao reprocesar webhook armazenado:", err);
          failed.push(line);
        }
      }

      if (failed.length > 0) {
        await fs.writeFile(filePath, failed.join("\n") + "\n", "utf-8");
      } else {
        await fs.unlink(filePath);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return;
      }
      logger.error("Erro ao reprocessar webhooks armazenados:", error);
    }
  }

  static async reconcilePendingPixPayments(params?: {
    limit?: number;
    maxAgeHours?: number;
  }) {
    const limit = Math.max(1, Math.min(params?.limit ?? 20, 100));
    const maxAgeHours = Math.max(1, Math.min(params?.maxAgeHours ?? 72, 240));
    const oldestAllowed = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    const candidates = await prisma.payment.findMany({
      where: {
        mercado_pago_id: { not: null },
        status: {
          in: ["PENDING", "IN_PROCESS", "IN_MEDIATION", "AUTHORIZED"],
        },
        created_at: { gte: oldestAllowed },
      },
      select: {
        id: true,
        order_id: true,
        mercado_pago_id: true,
        status: true,
        payment_method: true,
      },
      orderBy: { created_at: "asc" },
      take: limit,
    });

    if (candidates.length === 0) {
      return { scanned: 0, reprocessed: 0 };
    }

    let reprocessed = 0;
    for (const candidate of candidates) {
      try {
        const mercadoPagoId = candidate.mercado_pago_id;
        if (!mercadoPagoId) continue;

        const paymentInfo = await this.getPayment(mercadoPagoId);
        const newStatus = this.mapPaymentStatus(
          String(paymentInfo?.status || ""),
        );
        if (
          newStatus !== candidate.status ||
          paymentInfo?.status === "approved"
        ) {
          logger.info(`🔄 Reconciliação: ${candidate.payment_method} ${mercadoPagoId} status mudou ${candidate.status} -> ${newStatus}`);
          await this.processPaymentNotification(mercadoPagoId, paymentInfo);
          reprocessed++;
        }
      } catch (error) {
        const reconciliationError = error as any;
        const isPaymentNotFound =
          reconciliationError?.status === 404 ||
          reconciliationError?.code === "MP_PAYMENT_NOT_FOUND" ||
          String(reconciliationError?.message || "")
            .toLowerCase()
            .includes("payment not found");

        if (isPaymentNotFound) {
          await prisma.payment.updateMany({
            where: { id: candidate.id },
            data: {
              status: "CANCELLED",
              last_webhook_at: new Date(),
              webhook_attempts: { increment: 1 } as any,
            },
          });

          logger.warn(
            `⚠️ Pagamento ${candidate.payment_method} ${candidate.mercado_pago_id} não encontrado no MP; status local atualizado para CANCELLED (order ${candidate.order_id})`,
          );
          continue;
        }

        logger.warn(
          `⚠️ Falha ao reconciliar pagamento ${candidate.payment_method} ${candidate.mercado_pago_id} (order ${candidate.order_id}): ${error}`,
        );
      }
    }

    return { scanned: candidates.length, reprocessed };
  }

  static async processPaymentNotification(
    paymentId: string,
    mockPaymentData?: any,
  ): Promise<boolean> {
    try {
      const paymentInfo = mockPaymentData || (await this.getPayment(paymentId));
      logger.info("🔄 [Pagamento] Atualizando status", {
        paymentId,
        status: paymentInfo?.status || null,
      });

      // Retry logic: tenta encontrar o pagamento até 3x com delay
      let dbPayment = null;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        dbPayment = await prisma.payment.findFirst({
          where: { mercado_pago_id: paymentId.toString() },
          include: { order: { include: { user: true, items: true } } },
        });

        if (dbPayment) break;

        if (attempt < maxRetries) {
          logger.info(`⏳ Pagamento ${paymentId} não encontrado, tentativa ${attempt}/${maxRetries}, aguardando 500ms...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (!dbPayment) {
        logger.info(`ℹ️ Pagamento ${paymentId} não encontrado no banco (possivelmente cancelado/substituído)`);
        return true; // Retorna true para marcar webhook como processado
      }

      const newStatus = this.mapPaymentStatus(paymentInfo.status as string);
      const previousStatus = dbPayment.status;
      const customerLabel =
        dbPayment.order.user?.name ||
        dbPayment.order.user?.email ||
        dbPayment.order.user_id;

      const updateResult = await prisma.payment.updateMany({
        where: { id: dbPayment.id, status: { not: newStatus } },
        data: {
          status: newStatus,
          payment_method: paymentInfo.payment_method_id,
          payment_type: paymentInfo.payment_type_id,
          net_received_amount:
            paymentInfo.transaction_details?.net_received_amount,
          fee_details: JSON.stringify(paymentInfo.fee_details),
          approved_at:
            paymentInfo.status === "approved"
              ? paymentInfo.date_approved
                ? new Date(paymentInfo.date_approved)
                : new Date()
              : null,
          last_webhook_at: paymentInfo.date_created
            ? new Date(paymentInfo.date_created)
            : paymentInfo.date_approved
              ? new Date(paymentInfo.date_approved)
              : new Date(),
          webhook_attempts: dbPayment.webhook_attempts + 1,
        },
      });

      if (updateResult.count === 0) {
        logger.info("ℹ️ [Pagamento] Status já atualizado anteriormente", {
          paymentId: dbPayment.id,
          status: newStatus,
        });

        if (paymentInfo.status === "approved") {
          webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
            status: "approved",
            paymentId: dbPayment.id,
            mercadoPagoId: paymentId,
            approvedAt: new Date().toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            }),
            paymentMethod: paymentInfo.payment_method_id || undefined,
          });

          await this.recoverApprovedOrderPostProcessingIfNeeded({
            orderId: dbPayment.order_id,
            paymentId: dbPayment.id,
            mercadoPagoId: paymentId,
            paymentMethod: paymentInfo.payment_method_id || undefined,
          });
        }

        return true;
      }

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: dbPayment.id },
      });
      logger.info("[pagamento: transicao de status]", {
        paymentId: dbPayment.id,
        previousStatus,
        newStatus,
      });

      this.logPaymentFlow({
        customerLabel,
        stage: `status ${previousStatus.toLowerCase()} -> ${newStatus.toLowerCase()}`,
        orderId: dbPayment.order_id,
        amount: Number(
          updatedPayment?.transaction_amount ||
            dbPayment.transaction_amount ||
            0,
        ),
      });

      if (paymentInfo.status === "approved") {
        this.logPaymentFlow({
          customerLabel,
          stage: "pagamento aprovado 🟢",
          orderId: dbPayment.order_id,
          amount: Number(
            updatedPayment?.transaction_amount ||
              dbPayment.transaction_amount ||
              0,
          ),
        });

        // Notifica frontend IMEDIATAMENTE antes de qualquer pós-processamento
        webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
          status: "approved",
          paymentId: dbPayment.id,
          mercadoPagoId: paymentId,
          approvedAt: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          }),
          paymentMethod: paymentInfo.payment_method_id || undefined,
        });

        // Atualiza status do pedido (não-bloqueante)
        await orderService.updateOrderStatus(dbPayment.order_id, "PAID", {
          notifyCustomer: false,
        }).catch((err: any) => {
          logger.error(`⚠️ Falha ao atualizar status do pedido ${dbPayment.order_id} para PAID:`, err?.message || err);
        });

        // Notifica Manager/Admin instantaneamente via SSE
        adminNotificationService.notifyNewPaidOrder({
          orderId: dbPayment.order_id,
          customerName: customerLabel,
          total: Number(updatedPayment?.transaction_amount || dbPayment.transaction_amount || 0),
          itemsCount: dbPayment.order.items?.length || 0,
          deliveryDate: (dbPayment.order as any).delivery_date?.toISOString(),
          paymentMethod: paymentInfo.payment_method_id || undefined,
        });

        // Confirma reserva de estoque (não-bloqueante)
        try {
          await reservationService.confirmReservation(dbPayment.order_id);
          logger.info(
            `✅ Stock reservation confirmed for order ${dbPayment.order_id}`,
          );
        } catch (reservationError: any) {
          logger.error(
            `⚠️ Error confirming reservation for order ${dbPayment.order_id}:`,
            reservationError.message,
          );
        }

        try {
          await this.sendOrderConfirmationNotificationOnce(dbPayment.order_id);
        } catch (notifyError) {
          logger.warn(
            `⚠️ Falha ao enviar confirmação inicial WhatsApp para ${dbPayment.order_id}: ${notifyError}`,
          );
        }

        const existingFinalized = await prisma.webhookLog.findFirst({
          where: {
            resource_id: paymentId,
            topic: "payment",
            finalization_succeeded: true,
          },
        });

        if (existingFinalized) {
          logger.info(
            `🟢 Customizações já finalizadas para ${dbPayment.order_id} (via webhookLog), pulando finalização.`,
          );

          try {
            const finalGoogleDriveUrl = await this.getOrderGoogleDriveUrl(
              dbPayment.order_id,
            );

            if (finalGoogleDriveUrl) {
              try {
                const orderInfo = await prisma.order.findUnique({
                  where: { id: dbPayment.order_id },
                  select: {
                    google_drive_folder_id: true,
                    user: { select: { name: true } },
                  },
                });
                if (orderInfo?.google_drive_folder_id) {
                  await dispatchPrintForOrder(
                    dbPayment.order_id,
                    orderInfo.google_drive_folder_id,
                    orderInfo.user?.name || "Cliente",
                  );
                }
              } catch (printErr) {
                logger.error(
                  { err: printErr, orderId: dbPayment.order_id },
                  "print_job_enqueue_failed",
                );
              }
            }

            await this.sendCustomizationReadyNotificationOnce(
              dbPayment.order_id,
              finalGoogleDriveUrl,
            );
          } catch (err) {
            logger.warn(
              `⚠️ Erro ao enviar notificação após finalização anterior: ${err}`,
            );
          }
        } else {
          let googleDriveUrl: string | undefined;
          try {
            const finalizeRes =
              await orderCustomizationService.finalizeOrderCustomizations(
                dbPayment.order_id,
              );
            logger.info(
              `✅ finalizeOrderCustomizations result: ${JSON.stringify(
                finalizeRes,
              )}`,
            );

            googleDriveUrl = finalizeRes.folderUrl;

            try {
              if (finalizeRes.folderId) {
                await dispatchPrintForOrder(
                  dbPayment.order_id,
                  finalizeRes.folderId,
                  dbPayment.order.user?.name || "Cliente",
                );
              }
            } catch (printErr) {
              logger.error(
                { err: printErr, orderId: dbPayment.order_id },
                "print_job_enqueue_failed",
              );
            }

            await prisma.webhookLog.updateMany({
              where: { resource_id: paymentId, topic: "payment" },
              data: {
                finalization_succeeded: finalizeRes.base64Detected
                  ? false
                  : true,
                finalization_attempts: { increment: 1 } as any,
                error_message: finalizeRes.base64Detected
                  ? `Base64 left in customizations: ${finalizeRes.base64AffectedIds?.join(
                      ",",
                    )}`
                  : undefined,
              },
            });

            if (finalizeRes.base64Detected && finalizeRes.base64AffectedIds) {
              await alertService.alertBase64Residual(
                dbPayment.order_id,
                finalizeRes.base64AffectedIds,
                finalizeRes.uploadedFiles,
              );
            }

            await this.sendCustomizationReadyNotificationOnce(
              dbPayment.order_id,
              googleDriveUrl,
            );
          } catch (err) {
            logger.error(
              "⚠️ Erro na finalização das customizações antes do envio de notificações:",
              err,
            );

            try {
              await this.sendCustomizationReadyNotificationOnce(dbPayment.order_id);
            } catch (notifyErr) {
              logger.warn(`⚠️ Falha ao enviar notificação após erro de finalização: ${notifyErr}`);
            }
          }
        }
      } else {
        webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
          status: newStatus,
          paymentId: dbPayment.id,
          mercadoPagoId: paymentId,
          paymentMethod: paymentInfo.payment_method_id || undefined,
        });

        logger.info(
          `📤 Notificação SSE enviada (webhook) - Pedido ${dbPayment.order_id} status: ${newStatus}`,
        );
      }

      if (["cancelled", "rejected"].includes(paymentInfo.status as string)) {
        // Release stock reservation when payment is cancelled or rejected
        try {
          await reservationService.releaseReservation(dbPayment.order_id);
          logger.info(
            `✅ Stock reservation released for order ${dbPayment.order_id} (payment ${paymentInfo.status})`,
          );
        } catch (reservationError: any) {
          logger.error(
            `⚠️ Error releasing reservation for order ${dbPayment.order_id}:`,
            reservationError.message,
          );
          // Don't block order update if reservation release fails
        }

        await prisma.order.update({
          where: { id: dbPayment.order_id },
          data: { status: "CANCELED", pending_owner_key: null },
        });
      }
      return true;
    } catch (error) {
      logger.error("Erro ao processar notificação de pagamento:", error);
      throw error;
    }
  }

  static async processMerchantOrderNotification(merchantOrderId: string) {}

  private static async performSendOrderConfirmationNotification(
    orderId: string,
    googleDriveUrl?: string,
  ) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            product: true,
            customizations: {
              include: {
                customization: true,
              },
            },
            additionals: {
              include: {
                additional: true,
              },
            },
          },
        },
        payment: true,
      },
    });

    if (!order) {
      throw new Error(`Pedido não encontrado: ${orderId}`);
    }

    const items: Array<{ name: string; quantity: number; price: number }> = [];

    const finalGoogleDriveUrl =
      googleDriveUrl || order.google_drive_folder_url || undefined;

    const hasImageCustomizations = order.items.some((item) =>
      item.customizations.some(
        (customization) =>
          customization.customization?.type === "IMAGES" ||
          PaymentService.customizationValueHasImageAssets(customization.value),
      ),
    );

    order.items.forEach((item) => {
      items.push({
        name: item.product.name,
        quantity: item.quantity,
        price: Number(item.price),
      });

      item.additionals.forEach((additional) => {
        items.push({
          name: additional.additional.name,
          quantity: additional.quantity,
          price: Number(additional.price),
        });
      });
    });

    const orderData = {
      orderId: order.id,
      orderNumber: order.id.substring(0, 8).toUpperCase(),
      totalAmount: Number(order.grand_total || order.total || 0),
      paymentMethod: order.payment_method || "Não informado",
      items,
      googleDriveUrl: finalGoogleDriveUrl,
      hasImageCustomizations,
      recipientPhone: order.recipient_phone || undefined,
      customer: {
        name: order.user.name,
        email: order.user.email,
        phone: order.user.phone || undefined,
      },
      delivery: order.delivery_address
        ? {
            address: order.delivery_address,
            city: order.user.city || "",
            state: order.user.state || "",
            zipCode: order.user.zip_code || "",
            date: order.delivery_date || undefined,
          }
        : undefined,
    };

    (orderData as any).send_anonymously = order.send_anonymously || false;
    (orderData as any).complement = order.complement || undefined;
    await whatsappService.sendOrderConfirmationNotification(orderData, {
      notifyTeam: true,
      notifyCustomer: false,
    });

    if (order.user.phone) {
      await whatsappService.sendOrderConfirmation({
        phone: order.user.phone,
        orderNumber: order.id.substring(0, 8).toUpperCase(),
        customerName: order.user.name,
        recipientPhone: order.recipient_phone || undefined,
        deliveryDate: order.delivery_date || undefined,
        createdAt: order.created_at,
        googleDriveUrl: hasImageCustomizations
          ? finalGoogleDriveUrl
          : undefined,
        hasImageCustomizations,
        items,
        total: Number(order.grand_total || order.total || 0),
      });
    } else {
      logger.warn(
        "Telefone do comprador não disponível, não foi possível enviar notificação via WhatsApp.",
      );
    }
  }

  static async sendOrderConfirmationNotification(
    orderId: string,
    googleDriveUrl?: string,
  ) {
    try {
      await this.performSendOrderConfirmationNotification(
        orderId,
        googleDriveUrl,
      );
    } catch (error: any) {
      logger.error(
        "Erro ao enviar notificação de pedido confirmado:",
        error.message,
      );
    }
  }

  static validateWebhook(data: any, headers: any): boolean {
    try {
      return data && data.type && data.data && data.data.id;
    } catch (error) {
      logger.error("Erro na validação do webhook:", error);
      return false;
    }
  }

  static mapPaymentStatus(status: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      pending: "PENDING",
      approved: "APPROVED",
      authorized: "AUTHORIZED",
      in_process: "IN_PROCESS",
      in_mediation: "IN_MEDIATION",
      rejected: "REJECTED",
      cancelled: "CANCELLED",
      refunded: "REFUNDED",
      charged_back: "CHARGED_BACK",
    };

    return statusMap[status] ?? "PENDING";
  }

  static async cancelPayment(paymentId: string, reason?: string) {
    try {
      const cancelResponse = await payment.cancel({ id: paymentId });

      await prisma.payment.updateMany({
        where: { mercado_pago_id: paymentId },
        data: { status: "CANCELLED" },
      });

      return cancelResponse;
    } catch (error) {
      logger.error("Erro ao cancelar pagamento:", error);
      throw new Error(
        `Falha ao cancelar pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`,
      );
    }
  }

  private static async getOrderGoogleDriveUrl(
    orderId: string,
  ): Promise<string | undefined> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { google_drive_folder_url: true },
      });

      if (order?.google_drive_folder_url) {
        return order.google_drive_folder_url;
      }

      return undefined;
    } catch (err) {
      logger.warn(
        `⚠️ Erro ao buscar URL do Google Drive para ${orderId}:`,
        err,
      );
      return undefined;
    }
  }

  static async healthCheck() {
    try {
      const testPayment = {
        transaction_amount: 1.0,
        description: "Health Check - Cesto d'Amore",
        payment_method_id: "pix",
        payer: {
          email: "test@cestodamore.com",
        },
        external_reference: `HEALTH_CHECK_${Date.now()}`,
      };

      const response = await payment.create({ body: testPayment });

      return {
        status: "healthy",
        message: "Integração com Mercado Pago funcionando corretamente",
        test_payment_id: response.id,
      };
    } catch (error: any) {
      logger.error("❌ Health check do Mercado Pago falhou:", error);

      return {
        status: "unhealthy",
        message: "Problema na integração com Mercado Pago",
        error: {
          message: error.message,
          code: error.code,
          status: error.status,
        },
      };
    }
  }
}

export default PaymentService;

// Exported for unit testing only
export { normalizeOrderPaymentMethod, roundCurrency, normalizeText, SHIPPING_RULES };
