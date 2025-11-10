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

const client = new MercadoPagoConfig({
  accessToken,
  options: {
    timeout: 10000,
  },
});

export const payment = new Payment(client);
export const preference = new Preference(client);

export const mercadoPagoConfig = {
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
export const environmentConfig = {
  isProduction: process.env.NODE_ENV === "production",
  isTestAccount: accessToken.startsWith("TEST"),
  integrator_id: process.env.MERCADO_PAGO_INTEGRATOR_ID,
  corporation_id: process.env.MERCADO_PAGO_CORPORATION_ID,
  platform_id: process.env.MERCADO_PAGO_PLATFORM_ID,
};

export default client;
