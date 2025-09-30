import { preference } from "../config/mercadopago";

export interface CheckoutProRequest {
  items: Array<{
    title: string;
    unit_price: number;
    quantity: number;
    currency_id?: string;
  }>;
  payer?: {
    email: string;
    name?: string;
    surname?: string;
  };
  back_urls?: {
    success: string;
    failure: string;
    pending: string;
  };
  auto_return?: "approved" | "all";
}

export interface CheckoutProResult {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
  checkout_url: string;
}

class CheckoutProService {
  async createPreference(
    request: CheckoutProRequest
  ): Promise<CheckoutProResult> {
    try {
      console.log("🔄 Criando preferência do Checkout Pro:", {
        items: request.items.length,
        email: request.payer?.email?.substring(0, 3) + "***",
        total: request.items.reduce(
          (sum, item) => sum + item.unit_price * item.quantity,
          0
        ),
      });

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

      const response = await preference.create({ body });

      console.log("✅ Preferência criada:", {
        id: response.id,
        init_point: response.init_point ? "Gerado" : "Não gerado",
      });

      return {
        id: response.id!,
        init_point: response.init_point!,
        sandbox_init_point: response.sandbox_init_point,
        checkout_url: response.init_point!,
      };
    } catch (error: any) {
      console.error("❌ Erro ao criar preferência:", {
        message: error?.message,
        status: error?.status,
        cause: error?.cause,
      });
      throw error;
    }
  }
}

export const checkoutProService = new CheckoutProService();
export default checkoutProService;
