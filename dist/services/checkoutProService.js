"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutProService = void 0;
const mercadopago_1 = require("../config/mercadopago");
class CheckoutProService {
    async createPreference(request) {
        try {
            const body = {
                items: request.items.map((item, index) => ({
                    id: `item-${index + 1}`, // ID obrigatório
                    title: item.title,
                    unit_price: item.unit_price,
                    quantity: item.quantity,
                    currency_id: item.currency_id || "BRL",
                })),
                payer: request.payer,
                back_urls: request.back_urls || {
                    success: `${process.env.BASE_URL}/payment/success`,
                    failure: `${process.env.BASE_URL}/payment/failure`,
                    pending: `${process.env.BASE_URL}/payment/pending`,
                },
                auto_return: request.auto_return || "approved",
                payment_methods: {
                    installments: 12,
                },
                metadata: {
                    integration_test: process.env.NODE_ENV === "development",
                    source: "cesto_d_amore",
                },
            };
            const response = await mercadopago_1.preference.create({ body });
            return {
                id: response.id,
                init_point: response.init_point,
                sandbox_init_point: response.sandbox_init_point,
                checkout_url: response.init_point,
            };
        }
        catch (error) {
            console.error("❌ Erro ao criar preferência:", {
                message: error?.message,
                status: error?.status,
                cause: error?.cause,
            });
            throw error;
        }
    }
}
exports.checkoutProService = new CheckoutProService();
exports.default = exports.checkoutProService;
