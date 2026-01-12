import { payment, preference, mercadoPagoConfig } from "../config/mercadopago";
import prisma from "../database/prisma";
import fs from "fs/promises";
import type { PaymentStatus, Prisma } from "@prisma/client";
import * as crypto from "crypto-js";
import { randomUUID } from "crypto";
import { mercadoPagoDirectService } from "./mercadoPagoDirectService";
import whatsappService from "./whatsappService";
import orderCustomizationService from "./orderCustomizationService";
import { webhookNotificationService } from "./webhookNotificationService";
import orderService from "./orderService";
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
  method?: string | null
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
}

export class PaymentService {
  // In-memory guard to avoid duplicate confirmation sends within same process
  private static notificationSentOrders: Set<string> = new Set();
  private static async loadOrderWithDetails(
    orderId: string
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
        0
      );
      return sum + baseTotal + additionalsTotal;
    }, 0);

    const total = order.total ?? roundCurrency(itemsTotal);
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
    summary: ReturnType<typeof PaymentService.calculateOrderSummary>
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

  static async createPreference(data: CreatePreferenceData) {
    try {
      if (!data.orderId || !data.userId || !data.payerEmail) {
        throw new Error("Dados obrigatórios não fornecidos");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.payerEmail)) {
        throw new Error("Email do pagador inválido");
      }

      const order = await this.loadOrderWithDetails(data.orderId);

      if (!order) {
        throw new Error("Pedido não encontrado");
      }

      if (order.user_id !== data.userId) {
        throw new Error("Pedido não pertence ao usuário informado");
      }

      if (!order.items.length) {
        throw new Error("Pedido sem itens não pode gerar pagamento");
      }

      const orderPaymentMethod = normalizeOrderPaymentMethod(
        order.payment_method
      );

      if (!orderPaymentMethod) {
        throw new Error("Forma de pagamento do pedido não definida");
      }

      if (order.payment) {
        const existingPayment = order.payment;
        const isProduction = process.env.NODE_ENV === "production";
        const paymentFinalized = ["APPROVED", "AUTHORIZED"].includes(
          existingPayment.status
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

      const externalReference =
        data.externalReference || `ORDER_${data.orderId}_${Date.now()}`;

      const preferenceItems = [
        {
          id: order.id,
          title: `Pedido ${order.id}`,
          description: `Pagamento ${orderPaymentMethod === "pix" ? "PIX" : "Cartão"
            } - ${order.items.length} item(s)`,
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
          { id: "ticket" }
        );
      } else {
        paymentMethodsConfig.excluded_payment_types.push(
          { id: "bank_transfer" },
          { id: "ticket" }
        );
      }

      const preferenceData = {
        items: preferenceItems,
        payer: {
          email: data.payerEmail,
          name: data.payerName,
          phone: {
            number: data.payerPhone,
          },
        },
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
      console.error("Erro ao criar preferência:", error);
      throw new Error(
        `Falha ao criar preferência de pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  static async processTransparentCheckout(
    data: ProcessTransparentCheckoutData
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

      const order = await this.loadOrderWithDetails(data.orderId);

      if (!order) {
        throw new Error("Pedido não encontrado");
      }

      if (order.user_id !== data.userId) {
        throw new Error("Pedido não pertence ao usuário informado");
      }

      if (!order.items.length) {
        throw new Error("Pedido não possui itens");
      }

      // Tenta obter o método de pagamento do pedido, caso não exista, usar o método
      // informado pelo payload (data.paymentMethodId). Se encontrarmos um método
      // válido no payload, persistimos no pedido para manter a consistência.
      let orderPaymentMethod = normalizeOrderPaymentMethod(
        order.payment_method
      );

      if (!orderPaymentMethod && data.paymentMethodId) {
        orderPaymentMethod = normalizeOrderPaymentMethod(data.paymentMethodId);
        if (orderPaymentMethod) {
          // Atualiza o pedido com o método de pagamento normalizado (card|pix)
          try {
            await prisma.order.update({
              where: { id: order.id },
              data: { payment_method: orderPaymentMethod },
            });
            logger.info(
              `🛠️ Pedido ${order.id} atualizado com payment_method: ${orderPaymentMethod}`
            );
          } catch (upErr) {
            logger.warn(
              "⚠️ Não foi possível atualizar payment_method do pedido:",
              upErr
            );
            // Continuamos mesmo se não conseguir persistir — o fluxo de pagamento
            // seguirá considerando orderPaymentMethod definido.
          }
        }
      }

      if (!orderPaymentMethod) {
        throw new Error("Método de pagamento do pedido inválido");
      }

      if (order.payment) {
        if (order.payment.status === "APPROVED") {
          throw new Error("Pedido já possui pagamento aprovado");
        }

        // ✅ MUDANÇA: Permitir nova tentativa se o pagamento ainda está pendente, em processamento OU foi rejeitado
        if (
          order.payment.status === "PENDING" ||
          order.payment.status === "IN_PROCESS" ||
          order.payment.status === "REJECTED" ||
          order.payment.status === "CANCELLED"
        ) {
          // Cancelar o pagamento anterior no Mercado Pago (se existir e não estiver rejeitado/cancelado)
          if (
            order.payment.mercado_pago_id &&
            order.payment.status !== "REJECTED" &&
            order.payment.status !== "CANCELLED"
          ) {
            try {
              logger.info(
                `🔄 Cancelando pagamento anterior: ${order.payment.mercado_pago_id}`
              );
              await this.cancelPayment(order.payment.mercado_pago_id);
            } catch (cancelError) {
              logger.warn(
                "⚠️ Não foi possível cancelar pagamento anterior:",
                cancelError
              );
              // Continua mesmo se falhar, pois vamos criar um novo
            }
          }

          // Deletar o registro de pagamento anterior
          await prisma.payment.delete({
            where: { id: order.payment.id },
          });

          logger.info(
            `♻️ Pagamento anterior removido (status era: ${order.payment.status}). Criando novo pagamento ${data.paymentMethodId}...`
          );
        }
      }

      const summary = this.calculateOrderSummary(order);
      await this.ensureOrderTotalsUpToDate(order, summary);

      const nameParts = (data.payerName || "")
        .split(/\s+/)
        .filter((part) => /[\p{L}\p{N}]/u.test(part));

      const payerFirstName = nameParts[0] || "Cliente";
      const payerLastName =
        nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Sem Sobrenome";

      const paymentData: any = {
        transaction_amount: roundCurrency(summary.grandTotal),
        description: `Pedido ${order.id.substring(0, 8)} - ${order.items.length
          } item(s)`,
        payment_method_id: data.paymentMethodId,
        payer: {
          email: data.payerEmail,
          first_name: payerFirstName,
          last_name: payerLastName,
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
            "Token do cartão é obrigatório para pagamento com cartão"
          );
        }

        if (!data.cardholderName) {
          throw new Error("Nome do titular do cartão é obrigatório");
        }

        paymentData.payment_method_id = data.payment_method_id || "master";
        paymentData.token = data.cardToken;
        paymentData.installments = data.installments || 1;

        if (data.issuer_id) {
          paymentData.issuer_id = data.issuer_id;
        }

        const cardholderParts = data.cardholderName
          .split(/\s+/)
          .filter((part: string) => /[\p{L}\p{N}]/u.test(part));

        paymentData.payer = {
          email: data.payerEmail,
          first_name: cardholderParts[0] || "Cliente",
          last_name:
            cardholderParts.length > 1
              ? cardholderParts.slice(1).join(" ")
              : "Sem Sobrenome",
          identification: {
            type: data.payerDocumentType,
            number: data.payerDocument.replace(/\D/g, ""),
          },
        };

        paymentData.additional_info = {
          payer: {
            first_name: paymentData.payer.first_name,
            last_name: paymentData.payer.last_name,
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

      const idempotencyKey = `${data.paymentMethodId}-${data.orderId
        }-${randomUUID()}`;

      const paymentResponse = await payment.create({
        body: paymentData,
        requestOptions: {
          idempotencyKey,
        },
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

      if (paymentResponse.status === "approved") {
        await orderService.updateOrderStatus(data.orderId, "PAID");

        // Finalize customizations first (upload to Drive), then notify
        try {
          const finalizeRes =
            await orderCustomizationService.finalizeOrderCustomizations(
              data.orderId
            );
          logger.info(
            `✅ finalizeOrderCustomizations result (transparent checkout): ${JSON.stringify(
              finalizeRes
            )}`
          );

          // Only send WhatsApp if we have a folder URL (or no files to upload but no error)
          const willNotify =
            !!finalizeRes.folderUrl ||
            (finalizeRes.uploadedFiles === 0 && !finalizeRes.base64Detected);
          // Always send SSE update so frontend knows the order is PAID
          webhookNotificationService.notifyPaymentUpdate(data.orderId, {
            status: "approved",
            paymentId: paymentRecord.id,
            mercadoPagoId: String(paymentResponse.id),
            approvedAt: new Date().toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            }),
            paymentMethod: paymentData.payment_method_id || undefined,
          });

          if (willNotify) {
            if (!PaymentService.notificationSentOrders.has(data.orderId)) {
              await this.sendOrderConfirmationNotification(data.orderId);
              PaymentService.notificationSentOrders.add(data.orderId);
              setTimeout(
                () =>
                  PaymentService.notificationSentOrders.delete(data.orderId),
                1000 * 60 * 15
              );
            } else {
              logger.info(
                `🟡 Notificação de pedido já enviada (cache) para ${data.orderId}, pulando.`
              );
            }
          } else {
            logger.warn(
              `⚠️ Finalize não ready (transparent checkout) for order ${data.orderId}, skipping WhatsApp send`
            );
          }
        } catch (err) {
          console.error(
            "⚠️ Erro na finalização das customizações (transparent checkout):",
            err
          );
          webhookNotificationService.notifyPaymentUpdate(data.orderId, {
            status: "approved",
            paymentId: paymentRecord.id,
            mercadoPagoId: String(paymentResponse.id),
            approvedAt: new Date().toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            }),
            paymentMethod: paymentData.payment_method_id || undefined,
          });
        }
      } else {
        // ✅ NOVO: Notificar outros status (pending, in_process, rejected, etc)
        // Isso permite ao frontend mostrar feedbacks imediatos durante o checkout
        webhookNotificationService.notifyPaymentUpdate(data.orderId, {
          status: this.mapPaymentStatus(paymentResponse.status || "pending"),
          paymentId: paymentRecord.id,
          mercadoPagoId: String(paymentResponse.id),
          paymentMethod: data.paymentMethodId || undefined,
        });

        logger.info(
          `📤 Notificação SSE enviada (checkout transparente) - Pedido ${data.orderId
          } status: ${paymentResponse.status}`
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
            first_name: paymentResponse.payer?.first_name || payerFirstName,
            last_name: paymentResponse.payer?.last_name || payerLastName,
          },
        }),
      };
    } catch (error) {
      console.error("Erro ao processar checkout transparente:", error);

      if (error && typeof error === "object") {
        const serializedError = JSON.stringify(
          error,
          Object.getOwnPropertyNames(error),
          2
        );
        console.error("📛 Detalhes completos do erro:", serializedError);

        const mpError = error as any;
        if (mpError.cause) {
          console.error(
            "📛 Causa do erro:",
            JSON.stringify(mpError.cause, null, 2)
          );
        }
        if (mpError.response) {
          console.error(
            "📛 Resposta da API:",
            JSON.stringify(mpError.response, null, 2)
          );
        }
        if (mpError.status || mpError.statusCode) {
          console.error(
            "📛 Status HTTP:",
            mpError.status || mpError.statusCode
          );
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

      // Create error with cause preserved for controller to extract friendly message
      const paymentError = new Error(
        `Falha ao processar pagamento: ${errorMessage}`
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

      const amount = roundCurrency(data.amount ?? summary.grandTotal);
      if (amount <= 0) {
        throw new Error("Valor total do pedido inválido");
      }

      const normalizedOrderMethod = normalizeOrderPaymentMethod(
        order.payment_method
      );
      const resolvedMethod =
        data.paymentMethodId ??
        (normalizedOrderMethod === "pix" ? "pix" : "credit_card");

      if (!["pix", "credit_card", "debit_card"].includes(resolvedMethod)) {
        throw new Error(
          "Método de pagamento inválido. Use: pix, credit_card ou debit_card"
        );
      }

      const requiresToken =
        resolvedMethod === "credit_card" || resolvedMethod === "debit_card";

      if (requiresToken && !data.token) {
        throw new Error(
          "Token do cartão é obrigatório para pagamentos com cartão"
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
          grand_total: amount,
        },
      });

      // If payment is approved, finalize any order customizations (upload/sanitize artwork)
      if (mercadoPagoResult.status === "approved") {
        // Run finalize in background (non-blocking) so the API call that creates the payment is not blocked
        orderCustomizationService
          .finalizeOrderCustomizations(order.id)
          .then(async (customizationResult) => {
            logger.info(
              "✅ Customizações finalizadas com sucesso (background):",
              customizationResult
            );

            // ✅ NOVO: Salvar Drive folder info no banco e enviar WhatsApp
            if (customizationResult.folderId) {
              try {
                // Recarregar ordem com usuário para enviar WhatsApp
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
                  `📁 Ordem ${order.id} atualizada com Drive folder: ${customizationResult.folderId}`
                );

                // ✅ NOVO: Enviar WhatsApp com link do Drive
                if (orderWithUser.user?.phone) {
                  try {
                    const items = orderWithUser.items.map((item) => ({
                      name: item.product?.name || "Produto",
                      quantity: item.quantity || 1,
                      price: item.product?.price || 0,
                    }));

                    await whatsappService.sendOrderConfirmation({
                      orderNumber: orderWithUser.id
                        .substring(0, 8)
                        .toUpperCase(),
                      phone: orderWithUser.user.phone,
                      customerName: orderWithUser.user.name || "Cliente",
                      deliveryDate: orderWithUser.delivery_date || new Date(),
                      createdAt: orderWithUser.created_at,
                      recipientPhone:
                        orderWithUser.recipient_phone || undefined,
                      items,
                      total:
                        orderWithUser.grand_total || orderWithUser.total || 0,
                      googleDriveUrl: customizationResult.folderUrl,
                    });
                    logger.info(
                      `📱 WhatsApp enviado para ${orderWithUser.user.phone} com link do Drive`
                    );
                  } catch (whatsappErr) {
                    logger.warn(
                      `⚠️ Erro ao enviar WhatsApp para ${orderWithUser.user?.phone}:`,
                      whatsappErr
                    );
                  }
                }
              } catch (updateErr) {
                logger.error(
                  `⚠️ Erro ao atualizar ordem com Drive folder:`,
                  updateErr
                );
              }
            }
          })
          .catch((finalizeErr) => {
            logger.error(
              "⚠️ Erro ao finalizar customizações após pagamento aprovada (background, continuando):",
              finalizeErr
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
      console.error("❌ Erro ao criar pagamento:", error);
      throw new Error(
        `Falha ao criar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"
        }`
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
        }
      );

      if (!response.ok) {
        throw new Error("Erro ao buscar métodos de pagamento");
      }

      const paymentMethods = await response.json();
      return paymentMethods;
    } catch (error) {
      console.error("Erro ao buscar métodos de pagamento:", error);
      throw new Error(
        `Falha ao buscar métodos de pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Busca opções de parcelamento disponíveis para um determinado valor e método de pagamento
   * @param amount - Valor total da compra
   * @param paymentMethodId - ID do método de pagamento (ex: 'visa', 'master', 'elo')
   * @param bin - Primeiros 6 dígitos do cartão (opcional, melhora precisão)
   */
  static async getInstallmentOptions(
    amount: number,
    paymentMethodId: string,
    bin?: string
  ) {
    try {
      // Construir URL com parâmetros
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
          `Erro ao buscar opções de parcelamento: ${response.statusText}`
        );
      }

      const data = await response.json();

      // A API retorna um array com as opções de parcelamento
      // Cada item contém payer_costs com as parcelas disponíveis
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

      // Fallback: se não conseguir buscar da API, retornar parcelas padrão
      return this.getDefaultInstallmentOptions(amount);
    } catch (error) {
      console.error("Erro ao buscar opções de parcelamento:", error);
      // Em caso de erro, retornar opções padrão
      return this.getDefaultInstallmentOptions(amount);
    }
  }

  /**
   * Retorna opções de parcelamento padrão quando a API não está disponível
   */
  private static getDefaultInstallmentOptions(amount: number) {
    const installments = [];

    // Até 12 parcelas
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
      const paymentInfo = await payment.get({ id: paymentId });
      return paymentInfo;
    } catch (error) {
      console.error("Erro ao buscar pagamento:", error);
      throw new Error(
        `Falha ao buscar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Retry finalization for webhook logs where finalization failed or wasn't attempted
   * This is intended to be called on startup or via scheduled cron to ensure
   * we eventually finalize pending customizations without relying solely on provider retries.
   */
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
            console.warn(`Reprocess: pagamento ${paymentId} sem order_id`);
            await prisma.webhookLog.updateMany({
              where: { id: log.id },
              data: { finalization_attempts: { increment: 1 } as any },
            });
            continue;
          }

          // ✅ NOVO: Só reprocessar se o pagamento foi APPROVED
          if (dbPayment.status !== "APPROVED") {
            console.warn(
              `Reprocess: pagamento ${paymentId} não aprovado (status: ${dbPayment.status}), pulando.`
            );
            await prisma.webhookLog.updateMany({
              where: { id: log.id },
              data: { finalization_attempts: { increment: 1 } as any },
            });
            continue;
          }

          console.log(
            `🔁 Reprocessando finalização - orderId=${dbPayment.order_id}`
          );
          const finalizeRes =
            await orderCustomizationService.finalizeOrderCustomizations(
              dbPayment.order_id
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
                  ","
                )}`,
            },
          });
        } catch (err: any) {
          console.error("Erro ao reprocessar finalização:", err);
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
      console.error("Erro ao buscar logs para reprocessamento:", err);
    }
  }

  /**
   * Reprocess finalization for a specific order, for admin manual retry.
   */
  static async reprocessFinalizationForOrder(orderId: string) {
    try {
      const finalizeRes =
        await orderCustomizationService.finalizeOrderCustomizations(orderId);

      // Update webhook logs for the payment related to this order (if exists)
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
        error
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

      // ⚠️ IGNORAR webhooks de criação - só processar atualizações de pagamento
      if (data.action === "payment.created") {
        logger.info(
          "Webhook de criação ignorado - aguardando confirmação de pagamento",
          {
            action: data.action,
            paymentId: data.data?.id,
          }
        );
        return {
          success: true,
          message: "Webhook de criação ignorado (aguardando payment.updated)",
        };
      }

      // Extrair tipo do webhook - suporte para 'type', 'topic' e 'action'
      let webhookType = data.type || data.topic;
      if (!webhookType && data.action) {
        webhookType = data.action.split(".")[0]; // 'payment.updated' -> 'payment'
      }

      // Extrair resourceId - suporte para formato NOVO (data.id) e LEGADO (resource)
      const resourceId =
        (data.data && data.data.id && data.data.id.toString()) ||
        (data.resource && data.resource.toString()) ||
        undefined;

      if (!resourceId || !webhookType) {
        console.error("❌ Webhook inválido - sem ID de recurso ou tipo", {
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

      // Identificar formato (legacy ou novo) para logging e processamento
      const webhookFormat = data.topic && data.resource ? "legacy" : "new";

      // Log minimalista padronizado para facilitar leitura dos eventos
      logger.info("🔔 Webhook recebido", {
        format: webhookFormat,
        type: webhookType,
        action: data.action || null,
        paymentId: resourceId,
        timestamp: data.date_created || data.date || new Date().toISOString(),
      });

      // Verificar se já processamos este webhook (idempotência)
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
        // If we've processed this webhook previously, verify that our DB is consistent with
        // the Mercado Pago status. If the DB hasn't been updated but MP reports 'approved', re-run processing.
        try {
          const paymentInfo = await this.getPayment(resourceId);
          const dbPayment = await prisma.payment.findFirst({
            where: { mercado_pago_id: resourceId },
          });
          const mpStatus = (paymentInfo?.status || "").toLowerCase();
          const dbStatus = dbPayment?.status?.toLowerCase() || null;
          if (mpStatus === "approved" && dbStatus !== "approved") {
            console.warn(
              "⚠️ Webhook marked processed but DB out-of-sync (MP approved, DB not) - reprocessing",
              { resourceId }
            );
            // Reprocess to ensure order/payment state is updated
            await this.processPaymentNotification(resourceId);
            // Update log with attempted reprocess
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
          console.error(
            "Erro ao verificar estado do pagamento para webhooks duplicados:",
            err
          );
        }

        logger.warn("⚠️ Webhook duplicado ignorado (já processado)", {
          paymentId: resourceId,
          type: webhookType,
          processedAt: existingLog.created_at,
        });
        return {
          success: true,
          message: "Webhook já processado anteriormente (duplicado ignorado)",
        };
      }

      logger.info("Pagamento Recebido 💵: Registrando Log", {
        paymentId: resourceId,
        type: webhookType,
        action: data.action || null,
      });

      const logEntry = await prisma.webhookLog.create({
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

      let processedPayment: boolean | undefined = undefined;
      switch (webhookType) {
        case "payment":
          processedPayment = await this.processPaymentNotification(resourceId);
          // ✅ REMOVIDO: Webhook monitor foi removido para evitar duplicação
          // finalizeOrderCustomizations agora é chamada UMA VEZ em processPaymentNotification
          break;
        case "merchant_order":
          await this.processMerchantOrderNotification(resourceId);
          break;
        default:
          logger.info(`ℹ️ Tipo de webhook não processado: ${webhookType}`);
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
        // If payment was not processed (e.g., not found in DB), do not mark as processed
        console.warn(
          "⚠️ Webhook processing completed but payment was NOT processed (not updating webhookLog.processed)",
          { resourceId, topic: webhookType }
        );
      }

      return {
        success: true,
        message: "Webhook processado com sucesso",
      };
    } catch (error: any) {
      console.error("Erro ao processar webhook:", error);

      // If DB is unreachable (Prisma P1001), store the webhook locally for later retry
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
            JSON.stringify(logEntry) + "\n"
          );
          console.warn(
            "⚠️ Webhook armazenado localmente por indisponibilidade do BD"
          );
        } catch (fileErr) {
          console.error("Falha ao salvar webhook offline:", fileErr);
        }

        // Respond as accepted (202) to avoid provider retries; we will reprocess later
        return {
          success: true,
          message:
            "Webhook armazenado localmente devido à indisponibilidade do banco, processará posteriormente",
        };
      }

      // Extrair resourceId - formato NOVO do MP: { data: { id } }
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

  /**
   * Reprocess stored webhooks that were stored locally due to DB unavailability
   * Useful to run during startup or as a cron task.
   */
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
          console.error("Falha ao reprocesar webhook armazenado:", err);
          failed.push(line);
        }
      }

      // Rewrite file with failed entries only
      if (failed.length > 0) {
        await fs.writeFile(filePath, failed.join("\n") + "\n", "utf-8");
      } else {
        // Remove file when all processed
        await fs.unlink(filePath);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return;
      }
      console.error("Erro ao reprocessar webhooks armazenados:", error);
    }
  }

  static async processPaymentNotification(paymentId: string): Promise<boolean> {
    try {
      const paymentInfo = await this.getPayment(paymentId);
      console.log(
        `🔔 processPaymentNotification - paymentId=${paymentId} status=${paymentInfo?.status}`
      );

      const dbPayment = await prisma.payment.findFirst({
        where: { mercado_pago_id: paymentId.toString() },
        include: { order: { include: { user: true } } },
      });

      console.log(
        `🔎 dbPayment found: ${dbPayment ? dbPayment.id : "null"} status: ${dbPayment ? dbPayment.status : "N/A"
        }`
      );

      if (!dbPayment) {
        console.error("Pagamento não encontrado no banco:", paymentId);
        return false;
      }

      const newStatus = this.mapPaymentStatus(paymentInfo.status as string);

      // Use conditional update to avoid duplicate processing across concurrent webhook handlers
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
        // Another process has already updated this payment to the target status -> skip send/finalize
        console.log(
          `⚠️ Pagamento ${dbPayment.id} já atualizado para ${newStatus} por outro processo - pulando notificações e finalização`
        );
        return true;
      }

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: dbPayment.id },
      });
      console.log(`💾 DB updated payment ${dbPayment.id} -> ${newStatus}`);

      if (paymentInfo.status === "approved") {
        // Update order status via OrderService to trigger stock decrement
        await orderService.updateOrderStatus(dbPayment.order_id, "PAID");

        // ✅ VERIFICAÇÃO DE IDEMPOTÊNCIA: Verificar se já foi finalizado com sucesso
        const existingFinalized = await prisma.webhookLog.findFirst({
          where: {
            resource_id: paymentId,
            topic: "payment",
            finalization_succeeded: true,
          },
        });

        if (existingFinalized) {
          logger.info(
            `🟢 Customizações já finalizadas para ${dbPayment.order_id} (via webhookLog), pulando finalização.`
          );
          // Still send notifications if not already sent
          if (!PaymentService.notificationSentOrders.has(dbPayment.order_id)) {
            try {
              const finalGoogleDriveUrl = await this.getOrderGoogleDriveUrl(
                dbPayment.order_id
              );
              await this.sendOrderConfirmationNotification(
                dbPayment.order_id,
                finalGoogleDriveUrl
              );
              PaymentService.notificationSentOrders.add(dbPayment.order_id);
              setTimeout(
                () =>
                  PaymentService.notificationSentOrders.delete(
                    dbPayment.order_id
                  ),
                1000 * 60 * 15
              );
            } catch (err) {
              logger.warn(
                `⚠️ Erro ao enviar notificação após finalização anterior: ${err}`
              );
            }
          }
        } else {
          // ✅ MUST: finalize customizations BEFORE sending notifications (apenas se não foi feito antes)
          let googleDriveUrl: string | undefined;
          try {
            const finalizeRes =
              await orderCustomizationService.finalizeOrderCustomizations(
                dbPayment.order_id
              );
            logger.info(
              `✅ finalizeOrderCustomizations result: ${JSON.stringify(
                finalizeRes
              )}`
            );

            // Store the folder URL for notifications
            googleDriveUrl = finalizeRes.folderUrl;

            // Update webhook log(s) with finalization result for traceability
            await prisma.webhookLog.updateMany({
              where: { resource_id: paymentId, topic: "payment" },
              data: {
                finalization_succeeded: finalizeRes.base64Detected ? false : true,
                finalization_attempts: { increment: 1 } as any,
                error_message: finalizeRes.base64Detected
                  ? `Base64 left in customizations: ${finalizeRes.base64AffectedIds?.join(
                    ","
                  )}`
                  : undefined,
              },
            });

            // Only notify if finalization produced a drive link (or no artifacts but no errors). Prefer: only notify if googleDrive link found.
            const willNotify =
              !!finalizeRes.folderUrl ||
              (finalizeRes.uploadedFiles === 0 && !finalizeRes.base64Detected);

            if (willNotify) {
              // 🔔 Notificar frontend via SSE sobre pagamento aprovado
              webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
                status: "approved",
                paymentId: dbPayment.id,
                mercadoPagoId: paymentId,
                approvedAt: new Date().toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                }),
                paymentMethod: paymentInfo.payment_method_id || undefined,
              });

              console.log(
                `📤 Notificação SSE enviada - Pedido ${dbPayment.order_id} aprovado`
              );

              // Send group + buyer notifications only AFTER Drive link is ready
              if (
                !PaymentService.notificationSentOrders.has(dbPayment.order_id)
              ) {
                await this.sendOrderConfirmationNotification(
                  dbPayment.order_id,
                  googleDriveUrl
                );
                PaymentService.notificationSentOrders.add(dbPayment.order_id);
                setTimeout(
                  () =>
                    PaymentService.notificationSentOrders.delete(
                      dbPayment.order_id
                    ),
                  1000 * 60 * 15
                );
              } else {
                logger.info(
                  `🟡 Notificação de pedido já enviada (cache) para ${dbPayment.order_id}, pulando.`
                );
              }
            } else {
              logger.warn(
                `⚠️ Finalização não retornou link do Drive; pulando envio de notificações para order ${dbPayment.order_id}`
              );

              // Still notify frontend via SSE that it was approved
              webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
                status: "approved",
                paymentId: dbPayment.id,
                mercadoPagoId: paymentId,
                approvedAt: new Date().toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                }),
                paymentMethod: paymentInfo.payment_method_id || undefined,
              });
            }
          } catch (err) {
            logger.error(
              "⚠️ Erro na finalização das customizações antes do envio de notificações:",
              err
            );
            // Still try to notify to frontend that payment was approved (without whatsapp)
            webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
              status: "approved",
              paymentId: dbPayment.id,
              mercadoPagoId: paymentId,
              approvedAt: new Date().toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              }),
              paymentMethod: paymentInfo.payment_method_id || undefined,
            });
            logger.warn(
              `📤 Sent SSE notification despite finalization failure for order ${dbPayment.order_id}`
            );
          }
        }
      } else {
        // ✅ NOVO: Notificar outros status vindo do Webhook (pending, rejected, cancelled, etc)
        // Isso é fundamental para atualizar o checkout em tempo real se o pagamento falhar ou ficar pendente
        webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
          status: newStatus,
          paymentId: dbPayment.id,
          mercadoPagoId: paymentId,
          paymentMethod: paymentInfo.payment_method_id || undefined,
        });

        logger.info(
          `📤 Notificação SSE enviada (webhook) - Pedido ${dbPayment.order_id} status: ${newStatus}`
        );
      }

      if (["cancelled", "rejected"].includes(paymentInfo.status as string)) {
        await prisma.order.update({
          where: { id: dbPayment.order_id },
          data: { status: "CANCELED" },
        });
      }
      return true;
    } catch (error) {
      console.error("Erro ao processar notificação de pagamento:", error);
      throw error;
    }
  }

  static async processMerchantOrderNotification(merchantOrderId: string) { }

  static async sendOrderConfirmationNotification(
    orderId: string,
    googleDriveUrl?: string
  ) {
    try {
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
          payment: true,
        },
      });

      if (!order) {
        console.error("Pedido não encontrado:", orderId);
        return;
      }

      const items: Array<{ name: string; quantity: number; price: number }> =
        [];

      // If googleDriveUrl not provided, try to fetch from customizations
      let finalGoogleDriveUrl = googleDriveUrl;
      if (!finalGoogleDriveUrl) {
        try {
          const customizations = await prisma.orderItemCustomization.findFirst({
            where: {
              order_item_id: {
                in: order.items.map((item) => item.id),
              },
              google_drive_url: {
                not: null,
              },
            },
            select: {
              google_drive_url: true,
            },
          });

          if (customizations?.google_drive_url) {
            finalGoogleDriveUrl = customizations.google_drive_url;
          }
        } catch (error) {
          console.error(
            "Erro ao buscar URL do Google Drive para customizações:",
            error
          );
        }
      }

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
      // Include flags and complement for notification's business logic
      (orderData as any).send_anonymously = order.send_anonymously || false;
      (orderData as any).complement = order.complement || undefined;
      await whatsappService.sendOrderConfirmationNotification(orderData, {
        notifyTeam: true,
        notifyCustomer: false,
      });

      // Enviar confirmação APENAS para o COMPRADOR
      if (order.user.phone) {
        await whatsappService.sendOrderConfirmation({
          phone: order.user.phone,
          orderNumber: order.id.substring(0, 8).toUpperCase(),
          customerName: order.user.name,
          recipientPhone: order.recipient_phone || undefined,
          deliveryDate: order.delivery_date || undefined,
          createdAt: order.created_at,
          googleDriveUrl: finalGoogleDriveUrl,
          items,
          total: Number(order.grand_total || order.total || 0),
        });
      } else {
        console.warn(
          "Telefone do comprador não disponível, não foi possível enviar notificação via WhatsApp."
        );
      }
    } catch (error: any) {
      console.error(
        "Erro ao enviar notificação de pedido confirmado:",
        error.message
      );
    }
  }


  static validateWebhook(data: any, headers: any): boolean {
    try {
      return data && data.type && data.data && data.data.id;
    } catch (error) {
      console.error("Erro na validação do webhook:", error);
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
      console.error("Erro ao cancelar pagamento:", error);
      throw new Error(
        `Falha ao cancelar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * ✅ NOVO: Busca URL do Google Drive da ordem (pasta raiz ou primeira customização)
   */
  private static async getOrderGoogleDriveUrl(
    orderId: string
  ): Promise<string | undefined> {
    try {
      // Tentar buscar pasta raiz primeiro
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { google_drive_folder_url: true },
      });

      if (order?.google_drive_folder_url) {
        return order.google_drive_folder_url;
      }

      // Fallback: buscar primeira customização com URL
      const customization = await prisma.orderItemCustomization.findFirst({
        where: {
          order_item_id: {
            in: (
              await prisma.orderItem.findMany({
                where: { order_id: orderId },
                select: { id: true },
              })
            ).map((i) => i.id),
          },
          google_drive_url: { not: null },
        },
        select: { google_drive_url: true },
      });

      return customization?.google_drive_url || undefined;
    } catch (err) {
      logger.warn(
        `⚠️ Erro ao buscar URL do Google Drive para ${orderId}:`,
        err
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
      console.error("❌ Health check do Mercado Pago falhou:", error);

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
