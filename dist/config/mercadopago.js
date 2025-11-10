"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.environmentConfig = exports.mercadoPagoConfig = exports.preference = exports.payment = void 0;
const mercadopago_1 = require("mercadopago");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const publicKey = process.env.MERCADO_PAGO_PUBLIC_KEY;
const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
if (!accessToken) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN é obrigatório");
}
if (!publicKey) {
    throw new Error("MERCADO_PAGO_PUBLIC_KEY é obrigatório");
}
if (!webhookSecret) {
    throw new Error("MERCADO_PAGO_WEBHOOK_SECRET é obrigatório");
}
const client = new mercadopago_1.MercadoPagoConfig({
    accessToken,
    options: {
        timeout: 10000,
    },
});
exports.payment = new mercadopago_1.Payment(client);
exports.preference = new mercadopago_1.Preference(client);
exports.mercadoPagoConfig = {
    accessToken,
    publicKey,
    webhookSecret,
    client,
    baseUrl: process.env.BASE_URL || "",
    security: {
        enableWebhookValidation: true,
        enableIPWhitelist: false,
        allowedIPs: [
            "209.225.49.0/24",
            "216.33.197.0/24",
            "216.33.196.0/24",
            "185.205.246.213",
        ],
    },
    development: {
        skipBackUrls: process.env.NODE_ENV !== "production",
        useTestUrls: process.env.NODE_ENV !== "production",
    },
};
// Configurações de ambiente
exports.environmentConfig = {
    isProduction: process.env.NODE_ENV === "production",
    isTestAccount: accessToken.startsWith("TEST"),
    integrator_id: process.env.MERCADO_PAGO_INTEGRATOR_ID,
    corporation_id: process.env.MERCADO_PAGO_CORPORATION_ID,
    platform_id: process.env.MERCADO_PAGO_PLATFORM_ID,
};
exports.default = client;
