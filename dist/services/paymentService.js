"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const mercadopago_1 = require("../config/mercadopago");
const prisma_1 = __importDefault(require("../database/prisma"));
class PaymentService {
    /**
     * Cria uma preferência de pagamento para Checkout Pro
     */
    static async createPreference(data) {
        try {
            // Validar dados
            if (!data.orderId ||
                !data.userId ||
                !data.items ||
                data.items.length === 0) {
                throw new Error("Dados obrigatórios não fornecidos");
            }
            // Verificar se o pedido existe
            const order = await prisma_1.default.order.findUnique({
                where: { id: data.orderId },
                include: { payment: true },
            });
            if (!order) {
                throw new Error("Pedido não encontrado");
            }
            // Para desenvolvimento: permitir recriar preferência se pagamento não foi finalizado
            // Em produção: só permitir se não há pagamento ou se pagamento falhou
            if (order.payment) {
                const existingPayment = order.payment;
                const isProduction = process.env.NODE_ENV === "production";
                const paymentFinalized = ["APPROVED", "AUTHORIZED"].includes(existingPayment.status);
                if (isProduction && paymentFinalized) {
                    throw new Error("Pedido já possui um pagamento finalizado");
                }
                // Em desenvolvimento ou se pagamento não finalizado, deletar o pagamento anterior
                if (!paymentFinalized) {
                    console.log(`[DEV] Removendo pagamento anterior não finalizado: ${existingPayment.id}`);
                    await prisma_1.default.payment.delete({
                        where: { id: existingPayment.id },
                    });
                }
            }
            // Calcular total
            const totalAmount = data.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
            // Gerar referência externa única
            const externalReference = data.externalReference || `ORDER_${data.orderId}_${Date.now()}`;
            // Criar preferência no Mercado Pago
            const preferenceData = {
                items: data.items.map((item, index) => ({
                    id: `item_${index}`,
                    title: item.title,
                    description: item.description,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                })),
                payer: {
                    email: data.payerEmail,
                    name: data.payerName,
                    phone: {
                        number: data.payerPhone,
                    },
                },
                external_reference: externalReference,
                notification_url: `${mercadopago_1.mercadoPagoConfig.baseUrl}/webhook/mercadopago`,
                // Configurar back_urls apenas se não for desenvolvimento local
                ...(mercadopago_1.mercadoPagoConfig.baseUrl.includes("localhost")
                    ? {}
                    : {
                        back_urls: {
                            success: `${mercadopago_1.mercadoPagoConfig.baseUrl}/payment/success`,
                            failure: `${mercadopago_1.mercadoPagoConfig.baseUrl}/payment/failure`,
                            pending: `${mercadopago_1.mercadoPagoConfig.baseUrl}/payment/pending`,
                        },
                        auto_return: "approved",
                    }),
                payment_methods: {
                    excluded_payment_methods: [],
                    excluded_payment_types: [],
                    installments: 12,
                },
                shipments: {
                    mode: "not_specified",
                },
                metadata: {
                    order_id: data.orderId,
                    user_id: data.userId,
                },
            };
            const preferenceResponse = await mercadopago_1.preference.create({
                body: preferenceData,
            });
            // Criar registro de pagamento no banco
            const paymentRecord = await prisma_1.default.payment.create({
                data: {
                    order_id: data.orderId,
                    preference_id: preferenceResponse.id,
                    status: "PENDING",
                    transaction_amount: totalAmount,
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
    /**
     * Cria um pagamento direto (Checkout API)
     */
    static async createPayment(data) {
        try {
            // Validar dados obrigatórios
            if (!data.orderId || !data.userId || !data.amount || !data.payerEmail) {
                throw new Error("Dados obrigatórios não fornecidos");
            }
            // Validar valor mínimo
            if (data.amount <= 0) {
                throw new Error("Valor do pagamento deve ser maior que zero");
            }
            // Validar email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data.payerEmail)) {
                throw new Error("Email do pagador inválido");
            }
            // Validar método de pagamento
            const validPaymentMethods = [
                "pix",
                "credit_card",
                "debit_card",
                "ticket",
            ];
            if (data.paymentMethodId &&
                !validPaymentMethods.includes(data.paymentMethodId)) {
                throw new Error(`Método de pagamento inválido. Use: ${validPaymentMethods.join(", ")}`);
            }
            // Para cartão de crédito, token é obrigatório
            if ((data.paymentMethodId === "credit_card" ||
                data.paymentMethodId === "debit_card") &&
                !data.token) {
                throw new Error("Token do cartão é obrigatório para pagamentos com cartão");
            }
            // Verificar se o pedido existe
            const order = await prisma_1.default.order.findUnique({
                where: { id: data.orderId },
                include: { payment: true },
            });
            if (!order) {
                throw new Error("Pedido não encontrado");
            }
            // Para desenvolvimento: permitir recriar pagamento se anterior não foi finalizado
            if (order.payment) {
                const existingPayment = order.payment;
                const isProduction = process.env.NODE_ENV === "production";
                const paymentFinalized = ["APPROVED", "AUTHORIZED"].includes(existingPayment.status);
                if (isProduction && paymentFinalized) {
                    throw new Error("Pedido já possui um pagamento finalizado");
                }
                // Em desenvolvimento ou se pagamento não finalizado, deletar o pagamento anterior
                if (!paymentFinalized) {
                    console.log(`[DEV] Removendo pagamento anterior não finalizado: ${existingPayment.id}`);
                    await prisma_1.default.payment.delete({
                        where: { id: existingPayment.id },
                    });
                }
            }
            // Gerar referência externa única
            const externalReference = `ORDER_${data.orderId}_${Date.now()}`;
            // Criar pagamento no Mercado Pago
            const paymentData = {
                transaction_amount: data.amount,
                description: data.description,
                payment_method_id: data.paymentMethodId || "pix",
                installments: data.installments || 1,
                token: data.token,
                payer: {
                    email: data.payerEmail,
                    first_name: data.payerName,
                    phone: {
                        number: data.payerPhone,
                    },
                },
                external_reference: externalReference,
                // Configuração específica para desenvolvimento
                ...(process.env.NODE_ENV === "production"
                    ? {
                        notification_url: `${mercadopago_1.mercadoPagoConfig.baseUrl}/webhook/mercadopago`,
                    }
                    : {
                    // Em desenvolvimento, não incluir notification_url para evitar erros
                    }),
                metadata: {
                    order_id: data.orderId,
                    user_id: data.userId,
                    environment: process.env.NODE_ENV || "development",
                },
            };
            console.log("📤 Enviando dados para Mercado Pago:", JSON.stringify(paymentData, null, 2));
            console.log("🌍 Ambiente:", process.env.NODE_ENV);
            console.log("🔑 Access Token presente:", !!mercadopago_1.mercadoPagoConfig.accessToken);
            let paymentResponse;
            // Verificar se deve usar mock (desenvolvimento ou forçado)
            const useMock = process.env.NODE_ENV !== "production" &&
                process.env.USE_MOCK_PAYMENTS === "true";
            if (useMock) {
                console.log("🧪 Usando pagamento mock para desenvolvimento");
                paymentResponse = this.createMockPayment(data);
            }
            else {
                try {
                    paymentResponse = await mercadopago_1.payment.create({ body: paymentData });
                }
                catch (mercadoPagoError) {
                    // Se for erro de política e estiver em desenvolvimento, tentar usar mock
                    if (mercadoPagoError.code === "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" &&
                        process.env.NODE_ENV !== "production") {
                        console.log("⚠️ Erro de política detectado. Tentando usar mock...");
                        paymentResponse = this.createMockPayment(data);
                    }
                    else {
                        throw mercadoPagoError;
                    }
                }
            }
            console.log("📥 Resposta do Mercado Pago:", JSON.stringify(paymentResponse, null, 2));
            // Criar registro de pagamento no banco
            const paymentRecord = await prisma_1.default.payment.create({
                data: {
                    order_id: data.orderId,
                    mercado_pago_id: paymentResponse.id?.toString(),
                    payment_method: paymentResponse.payment_method_id,
                    payment_type: paymentResponse.payment_type_id,
                    status: this.mapPaymentStatus(paymentResponse.status),
                    transaction_amount: data.amount,
                    external_reference: externalReference,
                },
            });
            return {
                payment_id: paymentResponse.id,
                status: paymentResponse.status,
                payment_method: paymentResponse.payment_method_id,
                qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: paymentResponse.point_of_interaction?.transaction_data
                    ?.qr_code_base64,
                external_reference: externalReference,
                database_payment_id: paymentRecord.id,
            };
        }
        catch (error) {
            console.error("❌ Erro ao criar pagamento:", error);
            // Log detalhado do erro
            if (error && typeof error === "object") {
                console.error("Detalhes do erro:", {
                    message: error.message,
                    code: error.code,
                    status: error.status,
                    blocked_by: error.blocked_by,
                    full_error: error,
                });
            }
            // Tratamento específico para erros do Mercado Pago
            if (error.code === "PA_UNAUTHORIZED_RESULT_FROM_POLICIES") {
                throw new Error(`Pagamento bloqueado por política de segurança do Mercado Pago. ` +
                    `Verifique se o token de acesso está correto e se a conta está configurada para o ambiente atual. ` +
                    `Detalhes: ${error.message}`);
            }
            throw new Error(`Falha ao criar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
        }
    }
    /**
     * Busca informações de um pagamento
     */
    static async getPayment(paymentId) {
        try {
            // Verificar se há dados mock para teste local
            const mockKey = `mock_payment_${paymentId}`;
            const mockData = global[mockKey];
            if (mockData) {
                console.log(`🧪 [MOCK] Usando dados simulados para pagamento ${paymentId}`);
                return mockData;
            }
            const paymentInfo = await mercadopago_1.payment.get({ id: paymentId });
            return paymentInfo;
        }
        catch (error) {
            console.error("Erro ao buscar pagamento:", error);
            throw new Error(`Falha ao buscar pagamento: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
        }
    }
    /**
     * Processa notificação de webhook
     */
    static async processWebhookNotification(data, headers) {
        try {
            // Validar webhook (opcional mas recomendado)
            if (mercadopago_1.mercadoPagoConfig.security.enableWebhookValidation) {
                const isValid = this.validateWebhook(data, headers);
                if (!isValid) {
                    throw new Error("Webhook inválido");
                }
            }
            // Log do webhook
            await prisma_1.default.webhookLog.create({
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
            await prisma_1.default.webhookLog.updateMany({
                where: {
                    resource_id: data.data?.id?.toString(),
                    topic: data.type,
                },
                data: {
                    processed: true,
                },
            });
        }
        catch (error) {
            console.error("Erro ao processar webhook:", error);
            // Log do erro
            await prisma_1.default.webhookLog.updateMany({
                where: {
                    resource_id: data.data?.id?.toString(),
                    topic: data.type,
                },
                data: {
                    error_message: error instanceof Error ? error.message : "Erro desconhecido",
                },
            });
            throw error;
        }
    }
    /**
     * Processa notificação de pagamento
     */
    static async processPaymentNotification(paymentId) {
        try {
            // Buscar dados do pagamento no Mercado Pago
            const paymentInfo = await this.getPayment(paymentId);
            // Buscar pagamento no banco
            const dbPayment = await prisma_1.default.payment.findFirst({
                where: { mercado_pago_id: paymentId.toString() },
                include: { order: { include: { user: true } } },
            });
            if (!dbPayment) {
                console.error("Pagamento não encontrado no banco:", paymentId);
                return;
            }
            // Atualizar status do pagamento
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
            // Atualizar status do pedido se pagamento aprovado
            if (paymentInfo.status === "approved") {
                await prisma_1.default.order.update({
                    where: { id: dbPayment.order_id },
                    data: { status: "PAID" },
                });
                // Atualizar resumo financeiro
                await this.updateFinancialSummary(dbPayment.order_id, paymentInfo);
            }
            // Atualizar status do pedido se pagamento cancelado/rejeitado
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
    /**
     * Processa notificação de merchant order
     */
    static async processMerchantOrderNotification(merchantOrderId) {
        // Implementar se necessário
        console.log("Processando merchant order:", merchantOrderId);
    }
    /**
     * Atualiza resumo financeiro diário
     */
    static async updateFinancialSummary(orderId, paymentInfo) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // Buscar dados do pedido
            const order = await prisma_1.default.order.findUnique({
                where: { id: orderId },
                include: {
                    items: {
                        include: {
                            additionals: true,
                        },
                    },
                },
            });
            if (!order)
                return;
            // Calcular totais
            const totalProductsSold = order.items.reduce((sum, item) => sum + item.quantity, 0);
            const totalAdditionalsSold = order.items.reduce((sum, item) => sum +
                item.additionals.reduce((subSum, add) => subSum + add.quantity, 0), 0);
            const netReceived = paymentInfo.transaction_details?.net_received_amount || 0;
            const totalFees = order.total_price - netReceived;
            // Atualizar ou criar resumo do dia
            await prisma_1.default.financialSummary.upsert({
                where: { date: today },
                update: {
                    total_sales: { increment: order.total_price },
                    total_net_revenue: { increment: netReceived },
                    total_fees: { increment: totalFees },
                    total_orders: { increment: 1 },
                    approved_orders: { increment: 1 },
                    total_products_sold: { increment: totalProductsSold },
                    total_additionals_sold: { increment: totalAdditionalsSold },
                },
                create: {
                    date: today,
                    total_sales: order.total_price,
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
    /**
     * Valida webhook do Mercado Pago
     */
    static validateWebhook(data, headers) {
        try {
            // Implementar validação de assinatura se necessário
            // Por ora, validação básica
            return data && data.type && data.data && data.data.id;
        }
        catch (error) {
            console.error("Erro na validação do webhook:", error);
            return false;
        }
    }
    /**
     * Mapeia status do Mercado Pago para nosso enum
     */
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
    /**
     * Cancela um pagamento
     */
    static async cancelPayment(paymentId, reason) {
        try {
            const cancelResponse = await mercadopago_1.payment.cancel({ id: paymentId });
            // Atualizar no banco
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
    /**
     * Verifica saúde da integração com Mercado Pago
     */
    static async healthCheck() {
        try {
            // Tentar fazer uma chamada simples para verificar se o token está funcionando
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
            const response = await mercadopago_1.payment.create({ body: testPayment });
            // Se chegou aqui, a integração está funcionando
            console.log("✅ Health check do Mercado Pago: OK");
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
    /**
     * Cria um pagamento mock para desenvolvimento
     */
    static createMockPayment(data) {
        console.log("🧪 [MOCK] Criando pagamento simulado para desenvolvimento");
        const mockPaymentId = `mock_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        // Simular resposta do Mercado Pago
        const mockResponse = {
            id: mockPaymentId,
            status: "pending",
            payment_method_id: data.paymentMethodId || "pix",
            payment_type_id: "pix",
            transaction_amount: data.amount,
            description: data.description,
            external_reference: `ORDER_${data.orderId}_${Date.now()}`,
            point_of_interaction: {
                transaction_data: {
                    qr_code: "mock_qr_code_data",
                    qr_code_base64: "mock_qr_code_base64_data",
                },
            },
        };
        // Armazenar dados mock globalmente para simular webhook
        global[`mock_payment_${mockPaymentId}`] = mockResponse;
        return mockResponse;
    }
}
exports.PaymentService = PaymentService;
exports.default = PaymentService;
