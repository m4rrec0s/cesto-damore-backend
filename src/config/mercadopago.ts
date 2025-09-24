import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { config } from "dotenv";

config();

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

// Configuração do cliente Mercado Pago
const client = new MercadoPagoConfig({
  accessToken,
  options: {
    timeout: 5000,
    idempotencyKey: "unique-key",
  },
});

// Instâncias dos serviços
export const payment = new Payment(client);
export const preference = new Preference(client);

// Configurações
export const mercadoPagoConfig = {
  accessToken,
  publicKey,
  webhookSecret,
  client,
  // URLs base para webhooks e notificações
  baseUrl: process.env.BASE_URL || "http://localhost:8080",
  // Configurações de segurança
  security: {
    enableWebhookValidation: true,
    enableIPWhitelist: process.env.NODE_ENV === "production",
    allowedIPs: ["209.225.49.0/24", "216.33.197.0/24", "216.33.196.0/24"],
  },
  // Configurações de desenvolvimento
  development: {
    skipBackUrls: process.env.NODE_ENV !== "production",
    useTestUrls: process.env.NODE_ENV !== "production",
  },
};

// Configurações de ambiente
export const environmentConfig = {
  isProduction: process.env.NODE_ENV === "production",
  integrator_id: process.env.MERCADO_PAGO_INTEGRATOR_ID,
  corporation_id: process.env.MERCADO_PAGO_CORPORATION_ID,
  platform_id: process.env.MERCADO_PAGO_PLATFORM_ID,
};

export default client;
