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
    } catch (jwtError) {
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
      } catch (firebaseError) {
        console.error("Erro na verificação de token:", {
          jwtError,
          firebaseError,
        });
        return res.status(401).json({
          error: "Token inválido",
          code: "INVALID_TOKEN",
        });
      }
    }

    if (!user) {
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
    console.error("Erro na autenticação:", error);

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
    if (!mercadoPagoConfig.security.enableWebhookValidation) {
      return next();
    }

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

    const { type, data } = req.body;

    if (!type || !data || !data.id) {
      return res.status(400).json({
        error: "Estrutura de webhook inválida",
        code: "INVALID_WEBHOOK_STRUCTURE",
      });
    }

    const signature = req.headers["x-signature"] as string;
    const requestId = req.headers["x-request-id"] as string;

    if (signature && mercadoPagoConfig.webhookSecret) {
      const isValidSignature = validateWebhookSignature(
        req.body,
        signature,
        mercadoPagoConfig.webhookSecret
      );
      if (!isValidSignature) {
        console.warn("Webhook rejeitado - assinatura inválida");
        return res.status(403).json({
          error: "Assinatura de webhook inválida",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    next();
  } catch (error) {
    console.error("Erro na validação do webhook:", error);
    res.status(500).json({
      error: "Erro na validação do webhook",
      code: "WEBHOOK_VALIDATION_ERROR",
    });
  }
};

function validateWebhookSignature(
  payload: any,
  signature: string,
  secret: string
): boolean {
  try {
    const payloadString = JSON.stringify(payload);
    const expectedSignature = crypto
      .HmacSHA256(payloadString, secret)
      .toString();

    return signature === expectedSignature;
  } catch (error) {
    console.error("Erro ao validar assinatura:", error);
    return false;
  }
}

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
    const { orderId, amount, payerEmail } = req.body;

    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({
        error: "ID do pedido é obrigatório e deve ser uma string",
        code: "INVALID_ORDER_ID",
      });
    }

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({
        error: "Valor é obrigatório e deve ser um número positivo",
        code: "INVALID_AMOUNT",
      });
    }

    if (!payerEmail || !isValidEmail(payerEmail)) {
      return res.status(400).json({
        error: "Email do pagador é obrigatório e deve ser válido",
        code: "INVALID_PAYER_EMAIL",
      });
    }

    const MAX_AMOUNT = 50000;
    if (amount > MAX_AMOUNT) {
      return res.status(400).json({
        error: `Valor excede o limite máximo de R$ ${MAX_AMOUNT}`,
        code: "AMOUNT_EXCEEDS_LIMIT",
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

    console.log(
      `[FINANCIAL_OP] ${operation} iniciada por usuário ${req.user?.id} - IP: ${req.ip}`
    );

    const originalSend = res.send;
    res.send = function (data) {
      const duration = Date.now() - startTime;
      const success = res.statusCode < 400;

      console.log(
        `[FINANCIAL_OP] ${operation} ${
          success ? "SUCESSO" : "ERRO"
        } - ${duration}ms - Status: ${res.statusCode}`
      );

      return originalSend.call(this, data);
    };

    next();
  };
};
