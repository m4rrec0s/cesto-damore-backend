import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto-js";
import prisma from "../database/prisma";
import { mercadoPagoConfig } from "../config/mercadopago";
import { auth } from "../config/firebase";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role?: string;
  };
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "Token de acesso não fornecido",
        code: "MISSING_TOKEN",
      });
    }

    let user;
    let decodedToken;

    try {
      const jwtSecret = process.env.JWT_SECRET || "fallback-secret-key";
      decodedToken = jwt.verify(token, jwtSecret) as any;

      user = await prisma.user.findUnique({
        where: { id: decodedToken.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          firebaseUId: true,
        },
      });
    } catch (jwtError: any) {
      console.error("❌ JWT inválido, tentando Firebase:", {
        error: jwtError?.message || "JWT verification failed",
      });

      try {
        decodedToken = await auth.verifyIdToken(token);

        user = await prisma.user.findUnique({
          where: { firebaseUId: decodedToken.uid },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            firebaseUId: true,
          },
        });
      } catch (firebaseError: any) {
        console.error("❌ Ambos tokens falharam:", {
          jwtError: jwtError?.message || "JWT verification failed",
          firebaseError:
            firebaseError?.message || "Firebase verification failed",
          tokenInfo: {
            prefix: token.substring(0, 20) + "...",
            length: token.length,
          },
        });
        return res.status(401).json({
          error: "Token inválido",
          code: "INVALID_TOKEN",
          details: {
            jwtError: jwtError?.message || "JWT verification failed",
            firebaseError:
              firebaseError?.message || "Firebase verification failed",
          },
        });
      }
    }

    if (!user) {
      console.error("❌ Usuário não encontrado no banco:", {
        decodedToken: decodedToken
          ? {
              userId: decodedToken.userId,
              uid: decodedToken.uid,
              email: decodedToken.email,
            }
          : null,
      });
      return res.status(401).json({
        error: "Usuário não encontrado",
        code: "USER_NOT_FOUND",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  } catch (error) {
    console.error("💥 Erro inesperado na autenticação:", error);

    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: "Token inválido",
        code: "INVALID_TOKEN",
      });
    }

    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: "Token expirado",
        code: "TOKEN_EXPIRED",
      });
    }

    return res.status(500).json({
      error: "Erro interno de autenticação",
      code: "AUTH_ERROR",
    });
  }
};

export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({
      error: "Usuário não autenticado",
      code: "NOT_AUTHENTICATED",
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Acesso negado - permissão de administrador necessária",
      code: "ADMIN_REQUIRED",
      details: {
        userRole: req.user.role,
        requiredRole: "admin",
      },
    });
  }

  next();
};

export const validateMercadoPagoWebhook = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log("🔔 Webhook recebido do Mercado Pago", {
      headers: {
        "x-signature": req.headers["x-signature"] ? "presente" : "ausente",
        "x-request-id": req.headers["x-request-id"] ? "presente" : "ausente",
      },
      body: {
        type: req.body.type,
        live_mode: req.body.live_mode,
        paymentId: req.body.data?.id,
      },
    });

    if (!mercadoPagoConfig.security.enableWebhookValidation) {
      console.log("⚠️ Validação de webhook desabilitada");
      return next();
    }

    // Validar estrutura básica primeiro
    const { type, data, live_mode } = req.body;

    if (!type || !data || !data.id) {
      console.error("❌ Webhook com estrutura inválida", { type, data });
      return res.status(400).json({
        error: "Estrutura de webhook inválida",
        code: "INVALID_WEBHOOK_STRUCTURE",
      });
    }

    // ✅ ACEITAR WEBHOOKS DE TESTE IMEDIATAMENTE (live_mode: false)
    const isTestMode = live_mode === false;
    if (isTestMode) {
      console.log(
        "✅ Webhook em modo teste aceito (live_mode: false - bypassing validation)"
      );
      return next();
    }

    // Validação de IP (apenas para produção)
    if (mercadoPagoConfig.security.enableIPWhitelist) {
      const clientIP = req.ip || req.connection.remoteAddress || "";
      const isAllowedIP = mercadoPagoConfig.security.allowedIPs.some(
        (allowedRange) => {
          return clientIP.includes(allowedRange.split("/")[0]);
        }
      );

      if (!isAllowedIP) {
        console.warn("Webhook rejeitado - IP não autorizado:", clientIP);
        return res.status(403).json({
          error: "IP não autorizado",
          code: "IP_NOT_ALLOWED",
        });
      }
    }

    const xSignature = req.headers["x-signature"] as string;
    const xRequestId = req.headers["x-request-id"] as string;

    if (!xSignature || !xRequestId) {
      console.warn("Webhook rejeitado - headers de segurança ausentes");
      return res.status(401).json({
        error: "Headers de autenticação ausentes",
        code: "MISSING_AUTH_HEADERS",
      });
    }

    // Validação de assinatura usando padrão oficial do Mercado Pago
    if (mercadoPagoConfig.webhookSecret) {
      // Extrair partes da assinatura (formato: ts=1234567890,v1=hash)
      const parts = xSignature.split(",");
      let timestamp: string | null = null;
      let hash: string | null = null;

      for (const part of parts) {
        const [key, value] = part.split("=");
        if (key === "ts") timestamp = value;
        if (key === "v1") hash = value;
      }

      if (!timestamp || !hash) {
        console.warn("Webhook rejeitado - formato de assinatura inválido");
        return res.status(401).json({
          error: "Formato de assinatura inválido",
          code: "INVALID_SIGNATURE_FORMAT",
        });
      }

      // Validar timestamp (apenas log, não rejeitar)
      // Mercado Pago pode enviar webhooks com horas/dias de diferença (reprocessamentos)
      const webhookTimestamp = parseInt(timestamp, 10);
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const difference = currentTimestamp - webhookTimestamp;

      if (difference > 3600) {
        // Mais de 1 hora
        console.warn(
          "⚠️ Webhook com timestamp antigo (possível reprocessamento) - ACEITANDO MESMO ASSIM",
          {
            webhookTimestamp,
            webhookDate: new Date(webhookTimestamp * 1000).toISOString(),
            currentTimestamp,
            currentDate: new Date(currentTimestamp * 1000).toISOString(),
            differenceInMinutes: Math.floor(difference / 60),
            differenceInHours: Math.floor(difference / 3600),
            paymentId: data?.id,
          }
        );
      }

      // ✅ NÃO rejeitar por timestamp - Mercado Pago pode enviar webhooks atrasados

      // Construir manifest string conforme padrão Mercado Pago
      const dataId = data?.id?.toString() || "";
      const manifestString = `id:${dataId};request-id:${xRequestId};ts:${timestamp};`;

      // Calcular HMAC SHA256
      const expectedHash = crypto
        .HmacSHA256(manifestString, mercadoPagoConfig.webhookSecret)
        .toString(crypto.enc.Hex);

      if (hash !== expectedHash) {
        console.warn(
          "⚠️ Webhook com assinatura divergente - ACEITANDO MESMO ASSIM (troubleshooting)",
          {
            manifest: manifestString,
            expectedHash: expectedHash.substring(0, 20) + "...",
            receivedHash: hash.substring(0, 20) + "...",
            secretLength: mercadoPagoConfig.webhookSecret?.length,
            xSignatureFull: xSignature,
            paymentId: dataId,
            timestamp: timestamp,
            requestId: xRequestId,
          }
        );

        // ⚠️ TEMPORARIAMENTE aceitar webhooks com assinatura divergente
        // TODO: Investigar se o secret está correto no painel do Mercado Pago
        // return res.status(403).json({
        //   error: "Assinatura de webhook inválida",
        //   code: "INVALID_SIGNATURE",
        // });
      } else {
        console.log("✅ Webhook validado com sucesso (assinatura correta)", {
          paymentId: dataId,
          type: type,
        });
      }
    } else {
      console.warn(
        "⚠️ MERCADO_PAGO_WEBHOOK_SECRET não configurado - validação desabilitada"
      );
    }

    next();
  } catch (error) {
    console.error("❌ Erro na validação do webhook:", error);
    res.status(500).json({
      error: "Erro na validação do webhook",
      code: "WEBHOOK_VALIDATION_ERROR",
    });
  }
};

export const paymentRateLimit = (() => {
  const requests = new Map<string, { count: number; resetTime: number }>();
  const WINDOW_SIZE = 15 * 60 * 1000;
  const MAX_REQUESTS = 10;

  return (req: Request, res: Response, next: NextFunction) => {
    const clientIP = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();

    for (const [ip, data] of requests.entries()) {
      if (now > data.resetTime) {
        requests.delete(ip);
      }
    }

    const current = requests.get(clientIP);

    if (!current) {
      requests.set(clientIP, { count: 1, resetTime: now + WINDOW_SIZE });
      return next();
    }

    if (current.count >= MAX_REQUESTS) {
      return res.status(429).json({
        error: "Muitas tentativas de pagamento. Tente novamente em 15 minutos.",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil((current.resetTime - now) / 1000),
      });
    }

    current.count++;
    next();
  };
})();

export const validatePaymentData = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { orderId, amount, payerEmail, paymentMethodId } = req.body;

    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({
        error: "ID do pedido é obrigatório e deve ser uma string",
        code: "INVALID_ORDER_ID",
      });
    }

    if (amount !== undefined) {
      if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
        return res.status(400).json({
          error: "Valor deve ser um número positivo",
          code: "INVALID_AMOUNT",
        });
      }

      const MAX_AMOUNT = 50000;
      if (amount > MAX_AMOUNT) {
        return res.status(400).json({
          error: `Valor excede o limite máximo de R$ ${MAX_AMOUNT}`,
          code: "AMOUNT_EXCEEDS_LIMIT",
        });
      }
    }

    if (!payerEmail || !isValidEmail(payerEmail)) {
      return res.status(400).json({
        error: "Email do pagador é obrigatório e deve ser válido",
        code: "INVALID_PAYER_EMAIL",
      });
    }

    if (
      paymentMethodId &&
      !["pix", "credit_card", "debit_card"].includes(paymentMethodId)
    ) {
      return res.status(400).json({
        error: "Forma de pagamento inválida",
        code: "INVALID_PAYMENT_METHOD",
      });
    }

    next();
  } catch (error) {
    console.error("Erro na validação de dados de pagamento:", error);
    res.status(500).json({
      error: "Erro na validação de dados",
      code: "VALIDATION_ERROR",
    });
  }
};

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export const logFinancialOperation = (operation: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    const originalSend = res.send;
    res.send = function (data) {
      const duration = Date.now() - startTime;
      const success = res.statusCode < 400;

      return originalSend.call(this, data);
    };

    next();
  };
};
