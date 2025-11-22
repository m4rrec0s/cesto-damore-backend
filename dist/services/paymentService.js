"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const mercadopago_1 = require("../config/mercadopago");
const prisma_1 = __importDefault(require("../database/prisma"));
const crypto_1 = require("crypto");
const mercadoPagoDirectService_1 = require("./mercadoPagoDirectService");
const whatsappService_1 = __importDefault(require("./whatsappService"));
const orderCustomizationService_1 = __importDefault(require("./orderCustomizationService"));
const webhookNotificationService_1 = require("./webhookNotificationService");
const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalizeOrderPaymentMethod = (method) => {
    if (!method)
        return null;
    const normalized = method.trim().toLowerCase();
    if (normalized === "pix") {
        return "pix";
    }
    if (normalized === "card" ||
        normalized === "credit_card" ||
        normalized === "debit_card") {
        return "card";
    }
    return null;
};
class PaymentService {
    static async loadOrderWithDetails(orderId) {
        return prisma_1.default.order.findUnique({
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
    static calculateOrderSummary(order) {
        const itemsTotal = order.items.reduce((sum, item) => {
            const baseTotal = Number(item.price) * item.quantity;
            const additionalsTotal = item.additionals.reduce((acc, additional) => acc + Number(additional.price) * additional.quantity, 0);
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
    static async ensureOrderTotalsUpToDate(order, summary) {
        const needsUpdate = roundCurrency(order.total ?? 0) !== summary.total ||
            roundCurrency(order.grand_total ?? 0) !== summary.grandTotal ||
            roundCurrency(order.shipping_price ?? 0) !== summary.shipping;
        if (needsUpdate) {
            await prisma_1.default.order.update({
                where: { id: order.id },
                data: {
                    total: summary.total,
                    shipping_price: summary.shipping,
                    grand_total: summary.grandTotal,
                },
            });
        }
    }
    static async createPreference(data) {
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
            const orderPaymentMethod = normalizeOrderPaymentMethod(order.payment_method);
            if (!orderPaymentMethod) {
                throw new Error("Forma de pagamento do pedido não definida");
            }
            if (order.payment) {
                const existingPayment = order.payment;
                const isProduction = process.env.NODE_ENV === "production";
                const paymentFinalized = ["APPROVED", "AUTHORIZED"].includes(existingPayment.status);
                if (isProduction && paymentFinalized) {
                    throw new Error("Pedido já possui um pagamento finalizado");
                }
                if (!paymentFinalized) {
                    await prisma_1.default.payment.delete({
                        where: { id: existingPayment.id },
                    });
                }
            }
            const summary = this.calculateOrderSummary(order);
            await this.ensureOrderTotalsUpToDate(order, summary);
            const externalReference = data.externalReference || `ORDER_${data.orderId}_${Date.now()}`;
            const preferenceItems = [
                {
                    id: order.id,
                    title: `Pedido ${order.id}`,
                    description: `Pagamento ${orderPaymentMethod === "pix" ? "PIX" : "Cartão"} - ${order.items.length} item(s)`,
                    quantity: 1,
                    unit_price: summary.grandTotal,
                },
            ];
            const paymentMethodsConfig = {
                excluded_payment_methods: [],
                excluded_payment_types: [],
                installments: orderPaymentMethod === "pix" ? 1 : 12,
            };
            if (orderPaymentMethod === "pix") {
                paymentMethodsConfig.excluded_payment_types.push({ id: "credit_card" }, { id: "debit_card" }, { id: "ticket" });
            }
            else {
                paymentMethodsConfig.excluded_payment_types.push({ id: "bank_transfer" }, { id: "ticket" });
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
                notification_url: `${mercadopago_1.mercadoPagoConfig.baseUrl}/api/webhook/mercadopago`,
                back_urls: {
                    success: `${mercadopago_1.mercadoPagoConfig.baseUrl}/payment/success`,
                    failure: `${mercadopago_1.mercadoPagoConfig.baseUrl}/payment/failure`,
                    pending: `${mercadopago_1.mercadoPagoConfig.baseUrl}/payment/pending`,
                },
                auto_return: "approved",
                payment_methods: paymentMethodsConfig,
                shipments: {
                    mode: "not_specified",
                },
                metadata: {
                    order_id: data.orderId,
                    user_id: data.userId,
                    shipping_price: summary.shipping,
                    discount: summary.discount,
                    payment_method: orderPaymentMethod,
                },
            };
            const preferenceResponse = await mercadopago_1.preference.create({
                body: preferenceData,
            });
            const paymentRecord = await prisma_1.default.payment.create({
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
        }
        catch (error) {
            console.error("Erro ao criar preferência:", error);
            throw new Error(`Falha ao criar preferência de pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
        }
    }
    static async processTransparentCheckout(data) {
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
            let orderPaymentMethod = normalizeOrderPaymentMethod(order.payment_method);
            if (!orderPaymentMethod && data.paymentMethodId) {
                orderPaymentMethod = normalizeOrderPaymentMethod(data.paymentMethodId);
                if (orderPaymentMethod) {
                    // Atualiza o pedido com o método de pagamento normalizado (card|pix)
                    try {
                        await prisma_1.default.order.update({
                            where: { id: order.id },
                            data: { payment_method: orderPaymentMethod },
                        });
                        console.log(`🛠️ Pedido ${order.id} atualizado com payment_method: ${orderPaymentMethod}`);
                    }
                    catch (upErr) {
                        console.warn("⚠️ Não foi possível atualizar payment_method do pedido:", upErr);
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
                // ✅ MUDANÇA: Permitir alterar entre PIX e CARD se o pagamento ainda está pendente
                if (order.payment.status === "PENDING" ||
                    order.payment.status === "IN_PROCESS") {
                    // Cancelar o pagamento anterior no Mercado Pago (se existir)
                    if (order.payment.mercado_pago_id) {
                        try {
                            console.log(`🔄 Cancelando pagamento anterior: ${order.payment.mercado_pago_id}`);
                            await this.cancelPayment(order.payment.mercado_pago_id);
                        }
                        catch (cancelError) {
                            console.warn("⚠️ Não foi possível cancelar pagamento anterior:", cancelError);
                            // Continua mesmo se falhar, pois vamos criar um novo
                        }
                    }
                    // Deletar o registro de pagamento anterior
                    await prisma_1.default.payment.delete({
                        where: { id: order.payment.id },
                    });
                    console.log(`♻️ Pagamento anterior removido. Criando novo pagamento ${data.paymentMethodId}...`);
                }
            }
            const summary = this.calculateOrderSummary(order);
            await this.ensureOrderTotalsUpToDate(order, summary);
            const nameParts = (data.payerName || "")
                .split(/\s+/)
                .filter((part) => /[\p{L}\p{N}]/u.test(part));
            const payerFirstName = nameParts[0] || "Cliente";
            const payerLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Sem Sobrenome";
            const paymentData = {
                transaction_amount: roundCurrency(summary.grandTotal),
                description: `Pedido ${order.id.substring(0, 8)} - ${order.items.length} item(s)`,
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
                notification_url: `${mercadopago_1.mercadoPagoConfig.baseUrl}/api/webhook/mercadopago`,
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
            }
            else {
                if (!data.cardToken) {
                    throw new Error("Token do cartão é obrigatório para pagamento com cartão");
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
                    .filter((part) => /[\p{L}\p{N}]/u.test(part));
                paymentData.payer = {
                    email: data.payerEmail,
                    first_name: cardholderParts[0] || "Cliente",
                    last_name: cardholderParts.length > 1
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
            const idempotencyKey = `${data.paymentMethodId}-${data.orderId}-${(0, crypto_1.randomUUID)()}`;
            const paymentResponse = await mercadopago_1.payment.create({
                body: paymentData,
                requestOptions: {
                    idempotencyKey,
                },
            });
            const paymentRecord = await prisma_1.default.payment.upsert({
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
                await prisma_1.default.order.update({
                    where: { id: data.orderId },
                    data: { status: "PAID" },
                });
                try {
                    const customizationResult = await orderCustomizationService_1.default.finalizeOrderCustomizations(data.orderId);
                }
                catch (customizationError) {
                    console.error("⚠️ Erro ao finalizar customizações (continuando com notificação):", customizationError);
                }
                // Enviar notificação de confirmação
                await this.sendOrderConfirmationNotification(data.orderId);
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
                    qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code,
                    qr_code_base64: paymentResponse.point_of_interaction?.transaction_data
                        ?.qr_code_base64,
                    ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url,
                    expires_at: paymentResponse.date_of_expiration,
                    payer_info: {
                        id: paymentResponse.payer?.id,
                        email: paymentResponse.payer?.email || data.payerEmail,
                        first_name: paymentResponse.payer?.first_name || payerFirstName,
                        last_name: paymentResponse.payer?.last_name || payerLastName,
                    },
                }),
            };
        }
        catch (error) {
            console.error("Erro ao processar checkout transparente:", error);
            if (error && typeof error === "object") {
                const serializedError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
                console.error("📛 Detalhes completos do erro:", serializedError);
                const mpError = error;
                if (mpError.cause) {
                    console.error("📛 Causa do erro:", JSON.stringify(mpError.cause, null, 2));
                }
                if (mpError.response) {
                    console.error("📛 Resposta da API:", JSON.stringify(mpError.response, null, 2));
                }
                if (mpError.status || mpError.statusCode) {
                    console.error("📛 Status HTTP:", mpError.status || mpError.statusCode);
                }
            }
            let errorMessage = "Erro desconhecido";
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            else if (error && typeof error === "object") {
                const mpError = error;
                if (mpError.cause && mpError.cause.message) {
                    errorMessage = mpError.cause.message;
                }
                else if (mpError.message) {
                    errorMessage = mpError.message;
                }
            }
            throw new Error(`Falha ao processar pagamento: ${errorMessage}`);
        }
    }
    static async createPayment(data) {
        try {
            const { orderId, userId, payerEmail } = data;
            if (!orderId || !userId || !payerEmail) {
                throw new Error("Dados obrigatórios não fornecidos");
            }
            if (data.amount !== undefined &&
                (typeof data.amount !== "number" || data.amount <= 0)) {
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
            const normalizedOrderMethod = normalizeOrderPaymentMethod(order.payment_method);
            const resolvedMethod = data.paymentMethodId ??
                (normalizedOrderMethod === "pix" ? "pix" : "credit_card");
            if (!["pix", "credit_card", "debit_card"].includes(resolvedMethod)) {
                throw new Error("Método de pagamento inválido. Use: pix, credit_card ou debit_card");
            }
            const requiresToken = resolvedMethod === "credit_card" || resolvedMethod === "debit_card";
            if (requiresToken && !data.token) {
                throw new Error("Token do cartão é obrigatório para pagamentos com cartão");
            }
            const installments = requiresToken && data.installments && data.installments > 0
                ? Math.floor(data.installments)
                : 1;
            const mercadoPagoResult = await mercadoPagoDirectService_1.mercadoPagoDirectService.execute({
                transaction_amount: amount,
                token: requiresToken ? data.token : undefined,
                description: data.description ?? `Pedido ${order.id}`,
                installments,
                payment_method_id: resolvedMethod,
                email: payerEmail,
            });
            if (mercadoPagoResult.httpStatus !== 201) {
                throw new Error("Falha de pagamento!");
            }
            const paymentStatus = this.mapPaymentStatus(mercadoPagoResult.status);
            const cardMetadata = mercadoPagoResult.first_six_digits ||
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
            const paymentRecord = await prisma_1.default.payment.upsert({
                where: { order_id: order.id },
                update: {
                    mercado_pago_id: mercadoPagoResult.id,
                    payment_method: mercadoPagoResult.payment_method_id ?? resolvedMethod,
                    payment_type: mercadoPagoResult.payment_type_id,
                    status: paymentStatus,
                    transaction_amount: amount,
                    external_reference: order.id,
                    fee_details: cardMetadata ? JSON.stringify(cardMetadata) : undefined,
                    net_received_amount: mercadoPagoResult.raw?.transaction_details
                        ?.net_received_amount ?? undefined,
                    approved_at: mercadoPagoResult.status === "approved" ? new Date() : null,
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
                    net_received_amount: mercadoPagoResult.raw?.transaction_details
                        ?.net_received_amount ?? undefined,
                    approved_at: mercadoPagoResult.status === "approved" ? new Date() : null,
                },
            });
            await prisma_1.default.order.update({
                where: { id: order.id },
                data: {
                    payment_method: resolvedMethod === "pix" ? "pix" : "card",
                    status: mercadoPagoResult.status === "approved" ? "PAID" : order.status,
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
                payment_method_id: mercadoPagoResult.payment_method_id ?? resolvedMethod,
                payment_type_id: mercadoPagoResult.payment_type_id,
                card: {
                    first_six_digits: mercadoPagoResult.first_six_digits,
                    last_four_digits: mercadoPagoResult.last_four_digits,
                    cardholder_name: mercadoPagoResult.cardholder_name,
                },
                raw: mercadoPagoResult.raw,
            };
        }
        catch (error) {
            console.error("❌ Erro ao criar pagamento:", error);
            throw new Error(`Falha ao criar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
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
                            secure_thumbnail: "https://www.mercadopago.com/org-img/MP3/API/logos/visa.gif",
                            thumbnail: "https://www.mercadopago.com/org-img/MP3/API/logos/visa.gif",
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
                            secure_thumbnail: "https://www.mercadopago.com/org-img/MP3/API/logos/master.gif",
                            thumbnail: "https://www.mercadopago.com/org-img/MP3/API/logos/master.gif",
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
                            secure_thumbnail: "https://www.mercadopago.com/org-img/other/pix/logo-pix-color.png",
                            thumbnail: "https://www.mercadopago.com/org-img/other/pix/logo-pix-color.png",
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
            const response = await fetch("https://api.mercadopago.com/v1/payment_methods", {
                headers: {
                    Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
                },
            });
            if (!response.ok) {
                throw new Error("Erro ao buscar métodos de pagamento");
            }
            const paymentMethods = await response.json();
            return paymentMethods;
        }
        catch (error) {
            console.error("Erro ao buscar métodos de pagamento:", error);
            throw new Error(`Falha ao buscar métodos de pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
        }
    }
    static async getPayment(paymentId) {
        try {
            const paymentInfo = await mercadopago_1.payment.get({ id: paymentId });
            return paymentInfo;
        }
        catch (error) {
            console.error("Erro ao buscar pagamento:", error);
            throw new Error(`Falha ao buscar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
        }
    }
    static async processWebhookNotification(data, headers) {
        try {
            const isTestWebhook = data.live_mode === false && data.data?.id === "123456";
            if (isTestWebhook) {
                console.log("✅ Test webhook received");
                return {
                    success: true,
                    message: "Test webhook received successfully",
                };
            }
            // ⚠️ IGNORAR webhooks de criação - só processar atualizações de pagamento
            if (data.action === "payment.created") {
                console.log("ℹ️ Webhook de criação ignorado - aguardando confirmação de pagamento", {
                    action: data.action,
                    paymentId: data.data?.id,
                });
                return {
                    success: true,
                    message: "Webhook de criação ignorado (aguardando payment.updated)",
                };
            }
            // Extrair tipo do webhook - suporte para 'type' e 'action'
            let webhookType = data.type;
            if (!webhookType && data.action) {
                webhookType = data.action.split(".")[0]; // 'payment.updated' -> 'payment'
            }
            // Extrair resourceId - formato NOVO do MP: { type, action, data: { id: "123" } }
            const resourceId = data.data?.id?.toString();
            if (!resourceId || !webhookType) {
                console.error("❌ Webhook sem ID de recurso ou tipo", {
                    resourceId,
                    webhookType,
                    action: data.action,
                    type: data.type,
                    dataKeys: Object.keys(data.data || {}),
                    dataId: data.data?.id,
                    receivedData: JSON.stringify(data).substring(0, 500),
                });
                return {
                    success: false,
                    message: "Webhook sem dados válidos",
                };
            }
            // ✅ Log de processamento apenas para payment.updated
            console.log("💳 Processando webhook de pagamento confirmado", {
                action: data.action,
                paymentId: resourceId,
                type: webhookType,
                timestamp: data.date_created,
            });
            // Verificar se já processamos este webhook (idempotência)
            const existingLog = await prisma_1.default.webhookLog.findFirst({
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
                console.log("⚠️ Webhook duplicado ignorado (já processado)", {
                    paymentId: resourceId,
                    type: webhookType,
                    processedAt: existingLog.created_at,
                });
                return {
                    success: true,
                    message: "Webhook já processado anteriormente (duplicado ignorado)",
                };
            }
            // ✅ Validação de assinatura já foi feita no middleware (security.ts)
            // Não precisamos validar novamente aqui
            console.log("📝 Registrando webhook", {
                paymentId: resourceId,
                type: webhookType,
                action: data.action,
            });
            await prisma_1.default.webhookLog.create({
                data: {
                    payment_id: resourceId,
                    topic: webhookType,
                    resource_id: resourceId,
                    raw_data: JSON.stringify(data),
                    processed: false,
                },
            });
            switch (webhookType) {
                case "payment":
                    await this.processPaymentNotification(resourceId);
                    break;
                case "merchant_order":
                    await this.processMerchantOrderNotification(resourceId);
                    break;
                default:
                    console.log(`ℹ️ Tipo de webhook não processado: ${webhookType}`);
            }
            await prisma_1.default.webhookLog.updateMany({
                where: {
                    resource_id: resourceId,
                    topic: webhookType,
                },
                data: {
                    processed: true,
                },
            });
            return {
                success: true,
                message: "Webhook processado com sucesso",
            };
        }
        catch (error) {
            console.error("Erro ao processar webhook:", error);
            // Extrair resourceId - formato NOVO do MP: { data: { id } }
            const resourceId = data?.data?.id?.toString();
            const webhookType = data?.type || data?.action?.split(".")[0];
            if (resourceId && webhookType) {
                await prisma_1.default.webhookLog.updateMany({
                    where: {
                        resource_id: resourceId,
                        topic: webhookType,
                    },
                    data: {
                        error_message: error instanceof Error ? error.message : "Erro desconhecido",
                    },
                });
            }
            throw error;
        }
    }
    static async processPaymentNotification(paymentId) {
        try {
            const paymentInfo = await this.getPayment(paymentId);
            const dbPayment = await prisma_1.default.payment.findFirst({
                where: { mercado_pago_id: paymentId.toString() },
                include: { order: { include: { user: true } } },
            });
            if (!dbPayment) {
                console.error("Pagamento não encontrado no banco:", paymentId);
                return;
            }
            const newStatus = this.mapPaymentStatus(paymentInfo.status);
            await prisma_1.default.payment.update({
                where: { id: dbPayment.id },
                data: {
                    status: newStatus,
                    payment_method: paymentInfo.payment_method_id,
                    payment_type: paymentInfo.payment_type_id,
                    net_received_amount: paymentInfo.transaction_details?.net_received_amount,
                    fee_details: JSON.stringify(paymentInfo.fee_details),
                    approved_at: paymentInfo.status === "approved" ? new Date() : null,
                    last_webhook_at: new Date(),
                    webhook_attempts: dbPayment.webhook_attempts + 1,
                },
            });
            if (paymentInfo.status === "approved") {
                await prisma_1.default.order.update({
                    where: { id: dbPayment.order_id },
                    data: { status: "PAID" },
                });
                await this.updateFinancialSummary(dbPayment.order_id, paymentInfo);
                // 🔔 Notificar frontend via SSE sobre pagamento aprovado
                webhookNotificationService_1.webhookNotificationService.notifyPaymentUpdate(dbPayment.order_id, {
                    status: "approved",
                    paymentId: dbPayment.id,
                    mercadoPagoId: paymentId,
                    approvedAt: new Date().toISOString(),
                    paymentMethod: paymentInfo.payment_method_id || undefined,
                });
                console.log(`📤 Notificação SSE enviada - Pedido ${dbPayment.order_id} aprovado`);
                try {
                    await orderCustomizationService_1.default.finalizeOrderCustomizations(dbPayment.order_id);
                }
                catch (error) {
                    console.error("⚠️ Erro ao processar customizações, mas pedido foi aprovado:", error);
                }
                await this.sendOrderConfirmationNotification(dbPayment.order_id);
            }
            if (["cancelled", "rejected"].includes(paymentInfo.status)) {
                await prisma_1.default.order.update({
                    where: { id: dbPayment.order_id },
                    data: { status: "CANCELED" },
                });
            }
        }
        catch (error) {
            console.error("Erro ao processar notificação de pagamento:", error);
            throw error;
        }
    }
    static async processMerchantOrderNotification(merchantOrderId) { }
    static async sendOrderConfirmationNotification(orderId) {
        try {
            const order = await prisma_1.default.order.findUnique({
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
            const items = [];
            let googleDriveUrl;
            try {
                const customizations = await prisma_1.default.orderItemCustomization.findFirst({
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
                    googleDriveUrl = customizations.google_drive_url;
                }
            }
            catch (error) {
                console.error("Erro ao buscar URL do Google Drive para customizações:", error);
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
                googleDriveUrl,
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
            orderData.send_anonymously = order.send_anonymously || false;
            orderData.complement = order.complement || undefined;
            await whatsappService_1.default.sendOrderConfirmationNotification(orderData);
            const recipientPhone = order.recipient_phone || order.user.phone;
            if (recipientPhone && !order.send_anonymously) {
                await whatsappService_1.default.sendCustomerOrderConfirmation(recipientPhone, {
                    orderId: order.id,
                    orderNumber: order.id.substring(0, 8).toUpperCase(),
                    totalAmount: Number(order.grand_total || order.total || 0),
                    paymentMethod: order.payment_method || "Não informado",
                    items,
                    googleDriveUrl,
                    delivery: order.delivery_address
                        ? {
                            address: order.delivery_address,
                            date: order.delivery_date || undefined,
                        }
                        : undefined,
                });
            }
            else {
                console.warn("Telefone do destinatário não disponível, não foi possível enviar notificação via WhatsApp.");
            }
        }
        catch (error) {
            console.error("Erro ao enviar notificação de pedido confirmado:", error.message);
        }
    }
    static async updateFinancialSummary(orderId, paymentInfo) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const order = await this.loadOrderWithDetails(orderId);
            if (!order)
                return;
            const summary = this.calculateOrderSummary(order);
            const totalProductsSold = order.items.reduce((sum, item) => sum + item.quantity, 0);
            const totalAdditionalsSold = order.items.reduce((sum, item) => sum +
                item.additionals.reduce((subSum, add) => subSum + add.quantity, 0), 0);
            const netReceived = roundCurrency(paymentInfo?.transaction_details?.net_received_amount ?? 0);
            const totalFees = roundCurrency(summary.grandTotal - netReceived);
            await prisma_1.default.financialSummary.upsert({
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
        }
        catch (error) {
            console.error("Erro ao atualizar resumo financeiro:", error);
        }
    }
    static validateWebhook(data, headers) {
        try {
            return data && data.type && data.data && data.data.id;
        }
        catch (error) {
            console.error("Erro na validação do webhook:", error);
            return false;
        }
    }
    static mapPaymentStatus(status) {
        const statusMap = {
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
    static async cancelPayment(paymentId, reason) {
        try {
            const cancelResponse = await mercadopago_1.payment.cancel({ id: paymentId });
            await prisma_1.default.payment.updateMany({
                where: { mercado_pago_id: paymentId },
                data: { status: "CANCELLED" },
            });
            return cancelResponse;
        }
        catch (error) {
            console.error("Erro ao cancelar pagamento:", error);
            throw new Error(`Falha ao cancelar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
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
            const response = await mercadopago_1.payment.create({ body: testPayment });
            return {
                status: "healthy",
                message: "Integração com Mercado Pago funcionando corretamente",
                test_payment_id: response.id,
            };
        }
        catch (error) {
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
exports.PaymentService = PaymentService;
exports.default = PaymentService;
