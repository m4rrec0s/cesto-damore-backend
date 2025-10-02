"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutTransparenteRouter = void 0;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const paymentService_1 = require("../services/paymentService");
const prisma_1 = __importDefault(require("../database/prisma"));
exports.checkoutTransparenteRouter = (0, express_1.Router)();
/**
 * Serve a página HTML do Checkout Transparente
 */
exports.checkoutTransparenteRouter.get("/checkout-transparente", (req, res) => {
    try {
        const { orderId } = req.query;
        if (!orderId || typeof orderId !== "string") {
            return res.status(400).json({
                error: "ID do pedido é obrigatório",
            });
        }
        const htmlPath = path_1.default.join(__dirname, "../pages/checkout-transparente.html");
        if (!fs_1.default.existsSync(htmlPath)) {
            return res.status(404).json({
                error: "Página de checkout não encontrada",
            });
        }
        let htmlContent = fs_1.default.readFileSync(htmlPath, "utf8");
        // Substituir a chave pública no HTML
        const publicKey = process.env.MERCADO_PAGO_PUBLIC_KEY;
        if (publicKey) {
            htmlContent = htmlContent.replace("TEST-8c043cc6-f2e4-4b8a-a282-dcdbcf0edcc9", publicKey.replace(/"/g, "") // Remove quotes se houver
            );
        }
        res.setHeader("Content-Type", "text/html");
        res.send(htmlContent);
    }
    catch (error) {
        console.error("Erro ao servir checkout transparente:", error);
        res.status(500).json({
            error: "Erro interno do servidor",
        });
    }
});
/**
 * Busca dados de um pedido específico
 */
exports.checkoutTransparenteRouter.get("/orders/:orderId", async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return res.status(400).json({
                error: "ID do pedido é obrigatório",
            });
        }
        const order = await prisma_1.default.order.findUnique({
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
        if (!order) {
            return res.status(404).json({
                error: "Pedido não encontrado",
            });
        }
        // Calcular totais se necessário
        const itemsTotal = order.items.reduce((sum, item) => {
            const baseTotal = Number(item.price) * item.quantity;
            const additionalsTotal = item.additionals.reduce((acc, additional) => acc + Number(additional.price) * additional.quantity, 0);
            return sum + baseTotal + additionalsTotal;
        }, 0);
        const responseData = {
            id: order.id,
            total: Number(order.total) || itemsTotal,
            discount: Number(order.discount) || 0,
            shipping_price: Number(order.shipping_price) || 0,
            grand_total: Number(order.grand_total) ||
                itemsTotal -
                    Number(order.discount || 0) +
                    Number(order.shipping_price || 0),
            status: order.status,
            payment_method: order.payment_method,
            items: order.items.map((item) => ({
                id: item.id,
                product_name: item.product?.name || "Produto",
                price: Number(item.price),
                quantity: item.quantity,
                additionals: item.additionals.map((add) => ({
                    name: add.additional?.name || "",
                    price: Number(add.price),
                    quantity: add.quantity,
                })),
            })),
        };
        res.json(responseData);
    }
    catch (error) {
        console.error("Erro ao buscar pedido:", error);
        res.status(500).json({
            error: "Erro ao buscar dados do pedido",
        });
    }
});
/**
 * Lista métodos de pagamento disponíveis
 */
exports.checkoutTransparenteRouter.get("/payment-methods", async (req, res) => {
    try {
        const paymentMethods = await paymentService_1.PaymentService.getPaymentMethods();
        res.json(paymentMethods);
    }
    catch (error) {
        console.error("Erro ao buscar métodos de pagamento:", error);
        res.status(500).json({
            error: "Erro ao buscar métodos de pagamento",
        });
    }
});
/**
 * Processa pagamento via Checkout Transparente
 */
exports.checkoutTransparenteRouter.post("/payment/transparent", async (req, res) => {
    try {
        const { orderId, token, payment_method_id, issuer_id, installments, payer, } = req.body;
        // Validações básicas
        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: "ID do pedido é obrigatório",
            });
        }
        if (!token &&
            (payment_method_id === "credit_card" ||
                payment_method_id === "debit_card")) {
            return res.status(400).json({
                success: false,
                message: "Token do cartão é obrigatório",
            });
        }
        if (!payer || !payer.email) {
            return res.status(400).json({
                success: false,
                message: "E-mail do pagador é obrigatório",
            });
        }
        // Verificar se o pedido existe
        const order = await prisma_1.default.order.findUnique({
            where: { id: orderId },
            include: { payment: true },
        });
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Pedido não encontrado",
            });
        }
        // Verificar se já existe um pagamento aprovado
        if (order.payment &&
            ["APPROVED", "AUTHORIZED"].includes(order.payment.status)) {
            return res.status(400).json({
                success: false,
                message: "Este pedido já foi pago",
            });
        }
        // Criar dados para o pagamento
        const paymentData = {
            orderId: orderId,
            userId: order.user_id,
            payerEmail: payer.email,
            payerName: payer.first_name,
            paymentMethodId: payment_method_id,
            installments: installments || 1,
            token: token,
            description: `Pagamento do pedido ${orderId}`,
        };
        // Processar pagamento
        const paymentResult = await paymentService_1.PaymentService.createPayment(paymentData);
        // Estruturar resposta baseada no método de pagamento
        const response = {
            success: true,
            message: "Pagamento processado com sucesso",
            paymentId: paymentResult.payment_id,
            mercadoPagoId: paymentResult.mercado_pago_id,
            status: paymentResult.status,
        };
        // Se for PIX, incluir dados específicos
        if (payment_method_id === "pix" && paymentResult.raw) {
            const pixData = paymentResult.raw;
            console.log("PIX Raw Data:", JSON.stringify(pixData, null, 2));
            // Extrair dados do PIX da estrutura point_of_interaction
            const pixTransactionData = pixData.point_of_interaction?.transaction_data;
            response.data = {
                qr_code: pixTransactionData?.qr_code || pixData.qr_code,
                qr_code_base64: pixTransactionData?.qr_code_base64 || pixData.qr_code_base64,
                ticket_url: pixTransactionData?.ticket_url || pixData.ticket_url,
                amount: paymentResult.amount,
                expires_at: pixTransactionData?.expiration_date ||
                    pixTransactionData?.expiration_time ||
                    pixData.date_of_expiration,
                payment_id: paymentResult.payment_id,
                mercado_pago_id: paymentResult.mercado_pago_id,
                status: paymentResult.status,
                status_detail: paymentResult.status_detail,
                // Informações bancárias se disponíveis
                bank_info: pixData.point_of_interaction?.bank_info,
                // Informações do pagador (usar dados do request quando disponível)
                payer_info: {
                    id: pixData.payer?.id,
                    email: payer.email || pixData.payer?.email,
                    first_name: payer.first_name || pixData.payer?.first_name,
                    last_name: payer.last_name || pixData.payer?.last_name,
                },
                // Informações de taxas
                fee_info: pixData.fee_details
                    ? {
                        total_fees: pixData.fee_details.reduce((sum, fee) => sum + (fee.amounts?.original || 0), 0),
                        details: pixData.fee_details,
                    }
                    : null,
                // Data de criação e aprovação
                date_created: pixData.date_created,
                date_approved: pixData.date_approved,
                // Fallback para estrutura alternativa se necessário
                ...(pixData.qr_code && { qr_code: pixData.qr_code }),
                ...(pixData.qr_code_base64 && {
                    qr_code_base64: pixData.qr_code_base64,
                }),
            };
            console.log("PIX Response Data:", response.data);
        }
        res.json(response);
    }
    catch (error) {
        console.error("Erro ao processar pagamento transparente:", error);
        const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
        let userFriendlyMessage = errorMessage;
        // Mapear erros específicos do Mercado Pago para mensagens amigáveis
        if (errorMessage.includes("Token inválido") ||
            errorMessage.includes("invalid token")) {
            userFriendlyMessage =
                "Os dados do cartão são inválidos. Verifique as informações e tente novamente.";
        }
        else if (errorMessage.includes("insufficient_amount")) {
            userFriendlyMessage =
                "O cartão não possui saldo suficiente para esta transação.";
        }
        else if (errorMessage.includes("cc_rejected_call_for_authorize")) {
            userFriendlyMessage =
                "Entre em contato com o seu banco para autorizar o pagamento.";
        }
        else if (errorMessage.includes("cc_rejected_bad_filled_card_number")) {
            userFriendlyMessage = "Verifique o número do cartão e tente novamente.";
        }
        else if (errorMessage.includes("cc_rejected_bad_filled_date")) {
            userFriendlyMessage = "Verifique a data de vencimento do cartão.";
        }
        else if (errorMessage.includes("cc_rejected_bad_filled_security_code")) {
            userFriendlyMessage =
                "Verifique o código de segurança (CVV) do cartão.";
        }
        else if (errorMessage.includes("cc_rejected_card_disabled")) {
            userFriendlyMessage =
                "Seu cartão está desabilitado. Entre em contato com o seu banco.";
        }
        else if (errorMessage.includes("cc_rejected_duplicated_payment")) {
            userFriendlyMessage =
                "Este pagamento já foi processado. Use outro cartão ou forma de pagamento.";
        }
        else if (errorMessage.includes("cc_rejected_high_risk")) {
            userFriendlyMessage =
                "Pagamento recusado por segurança. Tente outro meio de pagamento.";
        }
        else if (errorMessage.includes("cc_rejected_max_attempts")) {
            userFriendlyMessage =
                "Muitas tentativas de pagamento. Tente novamente mais tarde.";
        }
        else if (errorMessage.includes("cc_rejected_other_reason")) {
            userFriendlyMessage =
                "Pagamento não autorizado pelo banco. Tente outro cartão.";
        }
        else if (errorMessage.includes("Falha de pagamento")) {
            userFriendlyMessage =
                "Pagamento recusado. Verifique os dados do cartão e tente novamente.";
        }
        res.status(500).json({
            success: false,
            message: userFriendlyMessage,
            error_code: errorMessage.includes("cc_rejected_")
                ? errorMessage.match(/cc_rejected_\w+/)?.[0]
                : undefined,
        });
    }
});
/**
 * Página de sucesso do pagamento
 */
exports.checkoutTransparenteRouter.get("/payment/success", (req, res) => {
    const { orderId, paymentId } = req.query;
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pagamento Aprovado - Cesto d'Amore</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          background: #f5f5f5; 
          margin: 0; 
          padding: 20px;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .success-container { 
          background: white; 
          padding: 40px; 
          border-radius: 10px; 
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          text-align: center;
          max-width: 500px;
        }
        .success-icon { 
          font-size: 60px; 
          color: #4caf50; 
          margin-bottom: 20px;
        }
        h1 { 
          color: #2e7d32; 
          margin-bottom: 10px;
        }
        p { 
          color: #666; 
          margin: 10px 0;
        }
        .order-info {
          background: #f9f9f9;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .button {
          background: #d81b60;
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          margin-top: 20px;
        }
        .button:hover { 
          background: #c2185b;
        }
      </style>
    </head>
    <body>
      <div class="success-container">
        <div class="success-icon">✅</div>
        <h1>Pagamento Aprovado!</h1>
        <p>Seu pagamento foi processado com sucesso.</p>
        
        <div class="order-info">
          <p><strong>Pedido:</strong> ${orderId || "N/A"}</p>
          <p><strong>ID do Pagamento:</strong> ${paymentId || "N/A"}</p>
        </div>
        
        <p>Você receberá um e-mail com os detalhes da sua compra.</p>
        
        <a href="/" class="button">🏠 Voltar ao Início</a>
      </div>
    </body>
    </html>
  `);
});
/**
 * Página de falha do pagamento
 */
exports.checkoutTransparenteRouter.get("/payment/failure", (req, res) => {
    const { orderId } = req.query;
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pagamento Recusado - Cesto d'Amore</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          background: #f5f5f5; 
          margin: 0; 
          padding: 20px;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .failure-container { 
          background: white; 
          padding: 40px; 
          border-radius: 10px; 
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          text-align: center;
          max-width: 500px;
        }
        .failure-icon { 
          font-size: 60px; 
          color: #f44336; 
          margin-bottom: 20px;
        }
        h1 { 
          color: #c62828; 
          margin-bottom: 10px;
        }
        p { 
          color: #666; 
          margin: 10px 0;
        }
        .button {
          background: #d81b60;
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          margin: 10px 5px;
        }
        .button:hover { 
          background: #c2185b;
        }
        .button.secondary {
          background: #666;
        }
        .button.secondary:hover {
          background: #555;
        }
      </style>
    </head>
    <body>
      <div class="failure-container">
        <div class="failure-icon">❌</div>
        <h1>Pagamento Recusado</h1>
        <p>Não foi possível processar seu pagamento.</p>
        <p>Verifique os dados do cartão ou tente outro meio de pagamento.</p>
        
        <a href="/checkout-transparente?orderId=${orderId || ""}" class="button">🔄 Tentar Novamente</a>
        <a href="/" class="button secondary">🏠 Voltar ao Início</a>
      </div>
    </body>
    </html>
  `);
});
exports.default = exports.checkoutTransparenteRouter;
