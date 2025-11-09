"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCardIssuers = getCardIssuers;
exports.createCardToken = createCardToken;
const mercadopago_1 = require("mercadopago");
const axios_1 = __importDefault(require("axios"));
async function getCardIssuers(req, res) {
    try {
        const { bin, paymentMethodId } = req.body;
        if (!bin || bin.length !== 6) {
            return res.status(400).json({
                success: false,
                message: "BIN (6 primeiros dígitos) é obrigatório",
            });
        }
        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!accessToken) {
            throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado");
        }
        // Detectar automaticamente o payment method baseado no BIN
        let detectedPaymentMethodId = paymentMethodId || "master";
        const firstDigit = bin.charAt(0);
        if (firstDigit === "4") {
            detectedPaymentMethodId = "visa";
        }
        else if (firstDigit === "5") {
            detectedPaymentMethodId = "master";
        }
        else if (firstDigit === "3") {
            detectedPaymentMethodId = "amex";
        }
        else if (firstDigit === "6") {
            detectedPaymentMethodId = "elo";
        }
        console.log("🔍 Detectando payment method:", {
            bin,
            firstDigit,
            providedMethod: paymentMethodId,
            detectedMethod: detectedPaymentMethodId,
        });
        const issuersResponse = await axios_1.default.get(`https://api.mercadopago.com/v1/payment_methods/card_issuers`, {
            params: {
                payment_method_id: detectedPaymentMethodId,
            },
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const issuers = issuersResponse.data;
        if (issuers && Array.isArray(issuers) && issuers.length > 0) {
            const issuer = issuers[0];
            console.log("✅ Emissor encontrado:", {
                issuer_id: issuer.id,
                issuer_name: issuer.name,
                payment_method_id: detectedPaymentMethodId,
            });
            return res.status(200).json({
                success: true,
                issuer_id: issuer.id.toString(),
                issuer_name: issuer.name,
                payment_method_id: detectedPaymentMethodId,
                all_issuers: issuers.map((i) => ({
                    id: i.id.toString(),
                    name: i.name,
                })),
            });
        }
        return res.status(404).json({
            success: false,
            message: "Emissor não encontrado para este cartão",
        });
    }
    catch (error) {
        console.error("❌ Erro ao buscar emissor do cartão:", error);
        const errorMessage = error && typeof error === "object" && "message" in error
            ? error.message
            : "Erro desconhecido ao buscar emissor";
        return res.status(500).json({
            success: false,
            message: errorMessage,
        });
    }
}
async function createCardToken(req, res) {
    try {
        const { cardNumber, securityCode, expirationMonth, expirationYear, cardholderName, identificationType, identificationNumber, } = req.body;
        console.log("💳 Criando token de cartão:", {
            cardNumberLength: cardNumber?.length,
            hasSecurityCode: !!securityCode,
            expirationMonth,
            expirationYear,
            cardholderName,
            identificationType,
            identificationNumberLength: identificationNumber?.replace(/\D/g, "")
                .length,
        });
        if (!cardNumber ||
            !securityCode ||
            !expirationMonth ||
            !expirationYear ||
            !cardholderName ||
            !identificationType ||
            !identificationNumber) {
            return res.status(400).json({
                success: false,
                message: "Todos os campos do cartão são obrigatórios",
            });
        }
        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!accessToken) {
            throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado");
        }
        const client = new mercadopago_1.MercadoPagoConfig({
            accessToken: accessToken,
            options: {
                timeout: 5000,
            },
        });
        const cardTokenClient = new mercadopago_1.CardToken(client);
        const tokenPayload = {
            card_number: cardNumber,
            security_code: securityCode,
            expiration_month: parseInt(expirationMonth),
            expiration_year: parseInt(expirationYear),
            cardholder: {
                name: cardholderName,
                identification: {
                    type: identificationType,
                    number: identificationNumber.replace(/\D/g, ""), // ✅ Remover formatação
                },
            },
        };
        console.log("📤 Enviando payload para criar token:", {
            card_number_length: tokenPayload.card_number.length,
            expiration_month: tokenPayload.expiration_month,
            expiration_year: tokenPayload.expiration_year,
            cardholder_name: tokenPayload.cardholder.name,
            identification_type: tokenPayload.cardholder.identification.type,
            identification_number: tokenPayload.cardholder.identification.number, // ✅ Log completo
            identification_number_length: tokenPayload.cardholder.identification.number.length,
        });
        // Criar token com estrutura correta (cardholder como objeto aninhado)
        const tokenResponse = await cardTokenClient.create({
            body: tokenPayload,
        });
        console.log("✅ Token criado com sucesso:", {
            id: tokenResponse.id,
            first_six_digits: tokenResponse.first_six_digits,
            last_four_digits: tokenResponse.last_four_digits,
        });
        return res.status(200).json({
            success: true,
            id: tokenResponse.id,
            first_six_digits: tokenResponse.first_six_digits,
            last_four_digits: tokenResponse.last_four_digits,
        });
    }
    catch (error) {
        console.error("❌ Erro ao criar token de cartão:", error);
        const errorMessage = error && typeof error === "object" && "message" in error
            ? error.message
            : "Erro desconhecido ao criar token";
        return res.status(500).json({
            success: false,
            message: errorMessage,
        });
    }
}
