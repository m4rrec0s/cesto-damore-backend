import { payment, preference, mercadoPagoConfig } from "../config/mercadopago";
import prisma from "../database/prisma";
import type { PaymentStatus, Prisma } from "@prisma/client";
import * as crypto from "crypto-js";
import { mercadoPagoDirectService } from "./mercadoPagoDirectService";

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
}

export interface CreatePreferenceData {
  orderId: string;
  userId: string;
  payerEmail: string;
  payerName?: string;
  payerPhone?: string;
  externalReference?: string;
}

export class PaymentService {
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

  /**
   * Cria uma preferência de pagamento para Checkout Pro
   */
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

      // Para desenvolvimento: permitir recriar preferência se pagamento não foi finalizado
      // Em produção: só permitir se não há pagamento ou se pagamento falhou
      if (order.payment) {
        const existingPayment = order.payment;
        const isProduction = process.env.NODE_ENV === "production";
        const paymentFinalized = ["APPROVED", "AUTHORIZED"].includes(
          existingPayment.status
        );

        if (isProduction && paymentFinalized) {
          throw new Error("Pedido já possui um pagamento finalizado");
        }

        // Em desenvolvimento ou se pagamento não finalizado, deletar o pagamento anterior
        if (!paymentFinalized) {
          console.log(
            `[DEV] Removendo pagamento anterior não finalizado: ${existingPayment.id}`
          );
          await prisma.payment.delete({
            where: { id: existingPayment.id },
          });
        }
      }

      const summary = this.calculateOrderSummary(order);
      await this.ensureOrderTotalsUpToDate(order, summary);

      // Gerar referência externa única
      const externalReference =
        data.externalReference || `ORDER_${data.orderId}_${Date.now()}`;

      const preferenceItems = [
        {
          id: order.id,
          title: `Pedido ${order.id}`,
          description: `Pagamento ${
            orderPaymentMethod === "pix" ? "PIX" : "Cartão"
          } - ${order.items.length} item(s)`,
          quantity: 1,
          unit_price: summary.grandTotal,
        },
      ];

      const paymentMethodsConfig = {
        default_payment_method_id:
          orderPaymentMethod === "pix" ? "pix" : "credit_card",
        excluded_payment_methods: [] as { id: string }[],
        excluded_payment_types: [] as { id: string }[],
        installments: orderPaymentMethod === "pix" ? 1 : 12,
      };

      // Criar preferência no Mercado Pago
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
        notification_url: `${mercadoPagoConfig.baseUrl}/webhook/mercadopago`,
        // Configurar back_urls apenas se não for desenvolvimento local
        ...(mercadoPagoConfig.baseUrl.includes("localhost")
          ? {}
          : {
              back_urls: {
                success: `${mercadoPagoConfig.baseUrl}/payment/success`,
                failure: `${mercadoPagoConfig.baseUrl}/payment/failure`,
                pending: `${mercadoPagoConfig.baseUrl}/payment/pending`,
              },
              auto_return: "approved" as const,
            }),
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

      // Criar registro de pagamento no banco
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
        `Falha ao criar preferência de pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Cria um pagamento direto (Checkout API)
   */
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
        raw: mercadoPagoResult.raw, // Incluir dados raw para PIX
      };
    } catch (error) {
      console.error("❌ Erro ao criar pagamento:", error);
      throw new Error(
        `Falha ao criar pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Obtém métodos de pagamento disponíveis
   */
  static async getPaymentMethods() {
    try {
      // Para ambiente de teste, retorna métodos mock
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

      // Em produção, usar a API do Mercado Pago
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
        `Falha ao buscar métodos de pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Busca informações de um pagamento
   */
  static async getPayment(paymentId: string) {
    try {
      const paymentInfo = await payment.get({ id: paymentId });
      return paymentInfo;
    } catch (error) {
      console.error("Erro ao buscar pagamento:", error);
      throw new Error(
        `Falha ao buscar pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Processa notificação de webhook
   */
  static async processWebhookNotification(data: any, headers: any) {
    try {
      // Validar webhook (opcional mas recomendado)
      if (mercadoPagoConfig.security.enableWebhookValidation) {
        const isValid = this.validateWebhook(data, headers);
        if (!isValid) {
          throw new Error("Webhook inválido");
        }
      }

      // Log do webhook
      await prisma.webhookLog.create({
        data: {
          payment_id: data.data?.id?.toString(),
          topic: data.type || "unknown",
          resource_id: data.data?.id?.toString() || "unknown",
          raw_data: JSON.stringify(data),
          processed: false,
        },
      });

      // Processar por tipo
      switch (data.type) {
        case "payment":
          await this.processPaymentNotification(data.data.id);
          break;
        case "merchant_order":
          await this.processMerchantOrderNotification(data.data.id);
          break;
        default:
          console.log("Tipo de notificação não tratado:", data.type);
      }

      // Marcar webhook como processado
      await prisma.webhookLog.updateMany({
        where: {
          resource_id: data.data?.id?.toString(),
          topic: data.type,
        },
        data: {
          processed: true,
        },
      });
    } catch (error) {
      console.error("Erro ao processar webhook:", error);

      // Log do erro
      await prisma.webhookLog.updateMany({
        where: {
          resource_id: data.data?.id?.toString(),
          topic: data.type,
        },
        data: {
          error_message:
            error instanceof Error ? error.message : "Erro desconhecido",
        },
      });

      throw error;
    }
  }

  /**
   * Processa notificação de pagamento
   */
  static async processPaymentNotification(paymentId: string) {
    try {
      // Buscar dados do pagamento no Mercado Pago
      const paymentInfo = await this.getPayment(paymentId);

      // Buscar pagamento no banco
      const dbPayment = await prisma.payment.findFirst({
        where: { mercado_pago_id: paymentId.toString() },
        include: { order: { include: { user: true } } },
      });

      if (!dbPayment) {
        console.error("Pagamento não encontrado no banco:", paymentId);
        return;
      }

      // Atualizar status do pagamento
      const newStatus = this.mapPaymentStatus(paymentInfo.status as string);

      await prisma.payment.update({
        where: { id: dbPayment.id },
        data: {
          status: newStatus,
          payment_method: paymentInfo.payment_method_id,
          payment_type: paymentInfo.payment_type_id,
          net_received_amount:
            paymentInfo.transaction_details?.net_received_amount,
          fee_details: JSON.stringify(paymentInfo.fee_details),
          approved_at: paymentInfo.status === "approved" ? new Date() : null,
          last_webhook_at: new Date(),
          webhook_attempts: dbPayment.webhook_attempts + 1,
        },
      });

      // Atualizar status do pedido se pagamento aprovado
      if (paymentInfo.status === "approved") {
        await prisma.order.update({
          where: { id: dbPayment.order_id },
          data: { status: "PAID" },
        });

        // Atualizar resumo financeiro
        await this.updateFinancialSummary(dbPayment.order_id, paymentInfo);
      }

      // Atualizar status do pedido se pagamento cancelado/rejeitado
      if (["cancelled", "rejected"].includes(paymentInfo.status as string)) {
        await prisma.order.update({
          where: { id: dbPayment.order_id },
          data: { status: "CANCELED" },
        });
      }
    } catch (error) {
      console.error("Erro ao processar notificação de pagamento:", error);
      throw error;
    }
  }

  /**
   * Processa notificação de merchant order
   */
  static async processMerchantOrderNotification(merchantOrderId: string) {
    // Implementar se necessário
    console.log("Processando merchant order:", merchantOrderId);
  }

  /**
   * Atualiza resumo financeiro diário
   */
  static async updateFinancialSummary(orderId: string, paymentInfo: any) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const order = await this.loadOrderWithDetails(orderId);

      if (!order) return;

      const summary = this.calculateOrderSummary(order);

      // Calcular totais
      const totalProductsSold = order.items.reduce(
        (sum: number, item: any) => sum + item.quantity,
        0
      );
      const totalAdditionalsSold = order.items.reduce(
        (sum: number, item: any) =>
          sum +
          item.additionals.reduce(
            (subSum: number, add: any) => subSum + add.quantity,
            0
          ),
        0
      );

      const netReceived = roundCurrency(
        paymentInfo?.transaction_details?.net_received_amount ?? 0
      );
      const totalFees = roundCurrency(summary.grandTotal - netReceived);

      // Atualizar ou criar resumo do dia
      await prisma.financialSummary.upsert({
        where: { date: today },
        update: {
          total_sales: { increment: summary.grandTotal },
          total_net_revenue: { increment: netReceived },
          total_fees: { increment: totalFees },
          total_orders: { increment: 1 },
          approved_orders: { increment: 1 },
          total_products_sold: { increment: totalProductsSold },
          total_additionals_sold: { increment: totalAdditionalsSold },
        },
        create: {
          date: today,
          total_sales: summary.grandTotal,
          total_net_revenue: netReceived,
          total_fees: totalFees,
          total_orders: 1,
          approved_orders: 1,
          pending_orders: 0,
          canceled_orders: 0,
          total_products_sold: totalProductsSold,
          total_additionals_sold: totalAdditionalsSold,
        },
      });
    } catch (error) {
      console.error("Erro ao atualizar resumo financeiro:", error);
    }
  }

  /**
   * Valida webhook do Mercado Pago
   */
  static validateWebhook(data: any, headers: any): boolean {
    try {
      // Implementar validação de assinatura se necessário
      // Por ora, validação básica
      return data && data.type && data.data && data.data.id;
    } catch (error) {
      console.error("Erro na validação do webhook:", error);
      return false;
    }
  }
  /**
   * Mapeia status do Mercado Pago para nosso enum
   */
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

  /**
   * Cancela um pagamento
   */
  static async cancelPayment(paymentId: string, reason?: string) {
    try {
      const cancelResponse = await payment.cancel({ id: paymentId });

      // Atualizar no banco
      await prisma.payment.updateMany({
        where: { mercado_pago_id: paymentId },
        data: { status: "CANCELLED" },
      });

      return cancelResponse;
    } catch (error) {
      console.error("Erro ao cancelar pagamento:", error);
      throw new Error(
        `Falha ao cancelar pagamento: ${
          error instanceof Error ? error.message : "Erro desconhecido"
        }`
      );
    }
  }

  /**
   * Verifica saúde da integração com Mercado Pago
   */
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

      console.log("🔍 Fazendo health check do Mercado Pago...");
      const response = await payment.create({ body: testPayment });

      console.log("✅ Health check do Mercado Pago: OK");

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
