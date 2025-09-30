import { config } from "dotenv";
import { payment } from "../config/mercadopago";

config();

type MercadoPagoCard = {
  first_six_digits?: string;
  last_four_digits?: string;
  cardholder?: {
    name?: string;
  };
};

type MercadoPagoResponse = {
  id?: string | number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  date_approved?: string | null;
  payment_method_id?: string;
  payment_type_id?: string;
  card?: MercadoPagoCard;
  [key: string]: unknown;
};

export interface MercadoPagoPaymentRequest {
  transaction_amount: number;
  token?: string; // Opcional para PIX
  description: string;
  installments: number;
  payment_method_id: string;
  email: string;
}

export interface MercadoPagoPaymentResult {
  httpStatus: number;
  id: string;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  date_approved?: string | null;
  payment_method_id: string;
  payment_type_id?: string;
  first_six_digits?: string;
  last_four_digits?: string;
  cardholder_name?: string;
  raw: MercadoPagoResponse;
}

class MercadoPagoDirectService {
  async execute(
    request: MercadoPagoPaymentRequest
  ): Promise<MercadoPagoPaymentResult> {
    try {
      const {
        transaction_amount,
        token,
        description,
        installments,
        payment_method_id,
        email,
      } = request;

      console.log("🔄 Criando pagamento no Mercado Pago:", {
        transaction_amount,
        payment_method_id,
        email: email?.substring(0, 3) + "***", // Log parcial do email para privacidade
        description,
        installments,
        hasToken: !!token,
      });

      const body: Record<string, unknown> = {
        transaction_amount,
        description,
        installments,
        payment_method_id,
        payer: {
          email,
        },
        // Metadados para identificar ambiente de teste
        metadata: {
          integration_test: process.env.NODE_ENV === "development",
          test_environment: true,
          source: "cesto_d_amore_test",
        },
      };

      if (token) {
        body.token = token;
      }

      // Adicionar configuração específica para teste se em desenvolvimento
      if (process.env.NODE_ENV === "development") {
        body.capture = true; // Força captura imediata em testes
      }

      const paymentResponse = (await payment.create({
        body,
      })) as unknown as MercadoPagoResponse;

      console.log("✅ Resposta do Mercado Pago:", {
        id: paymentResponse.id,
        status: paymentResponse.status,
        payment_method_id: paymentResponse.payment_method_id,
      });

      if (!paymentResponse || !paymentResponse.id) {
        throw new Error("Retorno inválido ao criar pagamento no Mercado Pago");
      }

      const httpStatus = 201;

      return {
        httpStatus,
        id: String(paymentResponse.id),
        status: paymentResponse.status,
        status_detail: paymentResponse.status_detail,
        transaction_amount: paymentResponse.transaction_amount,
        date_approved: paymentResponse.date_approved,
        payment_method_id:
          paymentResponse.payment_method_id ?? request.payment_method_id,
        payment_type_id: paymentResponse.payment_type_id,
        first_six_digits: paymentResponse.card?.first_six_digits,
        last_four_digits: paymentResponse.card?.last_four_digits,
        cardholder_name: paymentResponse.card?.cardholder?.name,
        raw: paymentResponse,
      };
    } catch (error: any) {
      console.error("❌ Erro detalhado no Mercado Pago:", {
        message: error?.message,
        code: error?.code,
        status: error?.status,
        cause: error?.cause,
        details: error?.details || error?.body,
      });

      // Re-lançar o erro original para manter compatibilidade
      throw error;
    }
  }
}

export const mercadoPagoDirectService = new MercadoPagoDirectService();
export default mercadoPagoDirectService;
