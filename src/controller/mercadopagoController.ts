import type { Request, Response } from "express";
import { CardToken, MercadoPagoConfig } from "mercadopago";
import axios from "axios";

export async function getCardIssuers(req: Request, res: Response) {
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

    const detectedPaymentMethodId = paymentMethodId || "master";

    const issuersResponse = await axios.get(
      `https://api.mercadopago.com/v1/payment_methods/card_issuers`,
      {
        params: {
          payment_method_id: detectedPaymentMethodId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const issuers = issuersResponse.data;

    if (issuers && Array.isArray(issuers) && issuers.length > 0) {
      const issuer = issuers[0];

      return res.status(200).json({
        success: true,
        issuer_id: issuer.id.toString(),
        issuer_name: issuer.name,
        payment_method_id: detectedPaymentMethodId,
        all_issuers: issuers.map((i: { id: number; name: string }) => ({
          id: i.id.toString(),
          name: i.name,
        })),
      });
    }

    return res.status(404).json({
      success: false,
      message: "Emissor não encontrado para este cartão",
    });
  } catch (error: unknown) {
    console.error("❌ Erro ao buscar emissor do cartão:", error);

    const errorMessage =
      error && typeof error === "object" && "message" in error
        ? (error as { message: string }).message
        : "Erro desconhecido ao buscar emissor";

    return res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
}

export async function createCardToken(req: Request, res: Response) {
  try {
    const {
      cardNumber,
      securityCode,
      expirationMonth,
      expirationYear,
      cardholderName,
      identificationType,
      identificationNumber,
    } = req.body;

    if (
      !cardNumber ||
      !securityCode ||
      !expirationMonth ||
      !expirationYear ||
      !cardholderName ||
      !identificationType ||
      !identificationNumber
    ) {
      return res.status(400).json({
        success: false,
        message: "Todos os campos do cartão são obrigatórios",
      });
    }

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado");
    }

    const client = new MercadoPagoConfig({
      accessToken: accessToken,
      options: {
        timeout: 5000,
      },
    });

    const cardTokenClient = new CardToken(client);

    // Criar token com estrutura correta (cardholder como objeto aninhado)
    const tokenResponse = await cardTokenClient.create({
      body: {
        card_number: cardNumber,
        security_code: securityCode,
        expiration_month: parseInt(expirationMonth),
        expiration_year: parseInt(expirationYear),
        cardholder: {
          name: cardholderName,
          identification: {
            type: identificationType,
            number: identificationNumber,
          },
        },
      } as never,
    });

    return res.status(200).json({
      success: true,
      id: tokenResponse.id,
      first_six_digits: tokenResponse.first_six_digits,
      last_four_digits: tokenResponse.last_four_digits,
    });
  } catch (error: unknown) {
    console.error("❌ Erro ao criar token de cartão:", error);

    const errorMessage =
      error && typeof error === "object" && "message" in error
        ? (error as { message: string }).message
        : "Erro desconhecido ao criar token";

    return res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
}
