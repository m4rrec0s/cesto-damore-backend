"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logFinancialOperation = exports.validatePaymentData = exports.paymentRateLimit = exports.validateMercadoPagoWebhook = exports.requireAdmin = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const prisma_1 = __importDefault(require("../database/prisma"));
const mercadopago_1 = require("../config/mercadopago");
const firebase_1 = require("../config/firebase");
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers["authorization"];
        const token = authHeader && authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({
                error: "Token de acesso não fornecido",
                code: "MISSING_TOKEN",
            });
        }
        console.log("🔐 Tentando autenticar token:", {
            hasAuthHeader: !!authHeader,
            tokenPrefix: token ? token.substring(0, 20) + "..." : "NO_TOKEN",
            tokenLength: token ? token.length : 0,
            route: req.path,
            method: req.method,
        });
        let user;
        let decodedToken;
        // 1. Primeiro tenta JWT da aplicação (appToken - 7 dias)
        try {
            const jwtSecret = process.env.JWT_SECRET || "fallback-secret-key";
            decodedToken = jsonwebtoken_1.default.verify(token, jwtSecret);
            console.log("✅ JWT válido detectado:", {
                userId: decodedToken.userId,
                type: decodedToken.type,
                exp: new Date(decodedToken.exp * 1000).toISOString(),
            });
            user = await prisma_1.default.user.findUnique({
                where: { id: decodedToken.userId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    firebaseUId: true,
                },
            });
            if (user) {
                console.log("✅ Usuário encontrado via JWT:", {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                });
            }
        }
        catch (jwtError) {
            console.log("❌ JWT inválido, tentando Firebase:", {
                error: jwtError?.message || "JWT verification failed",
            });
            // 2. Se JWT falhou, tenta Firebase ID Token
            try {
                decodedToken = await firebase_1.auth.verifyIdToken(token);
                console.log("✅ Firebase token válido:", {
                    uid: decodedToken.uid,
                    email: decodedToken.email,
                });
                user = await prisma_1.default.user.findUnique({
                    where: { firebaseUId: decodedToken.uid },
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        role: true,
                        firebaseUId: true,
                    },
                });
                if (user) {
                    console.log("✅ Usuário encontrado via Firebase:", {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                    });
                }
            }
            catch (firebaseError) {
                console.error("❌ Ambos tokens falharam:", {
                    jwtError: jwtError?.message || "JWT verification failed",
                    firebaseError: firebaseError?.message || "Firebase verification failed",
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
                        firebaseError: firebaseError?.message || "Firebase verification failed",
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
        console.log("✅ Autenticação bem-sucedida:", {
            userId: user.id,
            userEmail: user.email,
            userRole: user.role,
            route: req.path,
        });
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        };
        next();
    }
    catch (error) {
        console.error("💥 Erro inesperado na autenticação:", error);
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            return res.status(401).json({
                error: "Token inválido",
                code: "INVALID_TOKEN",
            });
        }
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
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
exports.authenticateToken = authenticateToken;
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        console.error("❌ requireAdmin: Usuário não autenticado", {
            route: req.path,
            method: req.method,
        });
        return res.status(401).json({
            error: "Usuário não autenticado",
            code: "NOT_AUTHENTICATED",
        });
    }
    console.log("🔐 Verificando permissão admin:", {
        userId: req.user.id,
        userEmail: req.user.email,
        userRole: req.user.role,
        route: req.path,
        method: req.method,
    });
    if (req.user.role !== "admin") {
        console.error("❌ requireAdmin: Acesso negado", {
            userId: req.user.id,
            userEmail: req.user.email,
            userRole: req.user.role,
            requiredRole: "admin",
            route: req.path,
        });
        return res.status(403).json({
            error: "Acesso negado - permissão de administrador necessária",
            code: "ADMIN_REQUIRED",
            details: {
                userRole: req.user.role,
                requiredRole: "admin",
            },
        });
    }
    console.log("✅ Acesso admin autorizado:", {
        userId: req.user.id,
        userEmail: req.user.email,
        route: req.path,
    });
    next();
};
exports.requireAdmin = requireAdmin;
const validateMercadoPagoWebhook = (req, res, next) => {
    try {
        if (!mercadopago_1.mercadoPagoConfig.security.enableWebhookValidation) {
            return next();
        }
        if (mercadopago_1.mercadoPagoConfig.security.enableIPWhitelist) {
            const clientIP = req.ip || req.connection.remoteAddress || "";
            const isAllowedIP = mercadopago_1.mercadoPagoConfig.security.allowedIPs.some((allowedRange) => {
                return clientIP.includes(allowedRange.split("/")[0]);
            });
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
        const signature = req.headers["x-signature"];
        const requestId = req.headers["x-request-id"];
        if (signature && mercadopago_1.mercadoPagoConfig.webhookSecret) {
            const isValidSignature = validateWebhookSignature(req.body, signature, mercadopago_1.mercadoPagoConfig.webhookSecret);
            if (!isValidSignature) {
                console.warn("Webhook rejeitado - assinatura inválida");
                return res.status(403).json({
                    error: "Assinatura de webhook inválida",
                    code: "INVALID_SIGNATURE",
                });
            }
        }
        next();
    }
    catch (error) {
        console.error("Erro na validação do webhook:", error);
        res.status(500).json({
            error: "Erro na validação do webhook",
            code: "WEBHOOK_VALIDATION_ERROR",
        });
    }
};
exports.validateMercadoPagoWebhook = validateMercadoPagoWebhook;
function validateWebhookSignature(payload, signature, secret) {
    try {
        const payloadString = JSON.stringify(payload);
        const expectedSignature = crypto_js_1.default
            .HmacSHA256(payloadString, secret)
            .toString();
        return signature === expectedSignature;
    }
    catch (error) {
        console.error("Erro ao validar assinatura:", error);
        return false;
    }
}
exports.paymentRateLimit = (() => {
    const requests = new Map();
    const WINDOW_SIZE = 15 * 60 * 1000;
    const MAX_REQUESTS = 10;
    return (req, res, next) => {
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
const validatePaymentData = (req, res, next) => {
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
        if (paymentMethodId &&
            !["pix", "credit_card", "debit_card"].includes(paymentMethodId)) {
            return res.status(400).json({
                error: "Forma de pagamento inválida",
                code: "INVALID_PAYMENT_METHOD",
            });
        }
        next();
    }
    catch (error) {
        console.error("Erro na validação de dados de pagamento:", error);
        res.status(500).json({
            error: "Erro na validação de dados",
            code: "VALIDATION_ERROR",
        });
    }
};
exports.validatePaymentData = validatePaymentData;
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
const logFinancialOperation = (operation) => {
    return (req, res, next) => {
        const startTime = Date.now();
        console.log(`[FINANCIAL_OP] ${operation} iniciada por usuário ${req.user?.id} - IP: ${req.ip}`);
        const originalSend = res.send;
        res.send = function (data) {
            const duration = Date.now() - startTime;
            const success = res.statusCode < 400;
            console.log(`[FINANCIAL_OP] ${operation} ${success ? "SUCESSO" : "ERRO"} - ${duration}ms - Status: ${res.statusCode}`);
            return originalSend.call(this, data);
        };
        next();
    };
};
exports.logFinancialOperation = logFinancialOperation;
