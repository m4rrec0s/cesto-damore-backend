import { Request } from "express";
import jwt from "jsonwebtoken";

const ISSUER = "cda-api";
const AUDIENCE = "guest-order";

interface GuestOrderClaims extends jwt.JwtPayload {
  typ: "guest-order";
  orderId: string;
  userId: string;
}

function getSecret() {
  const secret = process.env.GUEST_ORDER_TOKEN_SECRET;
  if (!secret) throw new Error("GUEST_ORDER_TOKEN_SECRET não configurado");
  return secret;
}

export function createGuestOrderToken(orderId: string, userId: string) {
  return jwt.sign({ typ: "guest-order", orderId, userId }, getSecret(), {
    algorithm: "HS256",
    audience: AUDIENCE,
    expiresIn: "24h",
    issuer: ISSUER,
  });
}

export function getGuestOrderClaims(req: Request): GuestOrderClaims {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Guest ")) {
    throw new Error("Token de acesso do pedido é obrigatório");
  }

  try {
    const claims = jwt.verify(authorization.slice(6), getSecret(), {
      algorithms: ["HS256"],
      audience: AUDIENCE,
      issuer: ISSUER,
    }) as GuestOrderClaims;

    if (
      claims.typ !== "guest-order" ||
      typeof claims.orderId !== "string" ||
      typeof claims.userId !== "string"
    ) {
      throw new Error("invalid claims");
    }
    return claims;
  } catch {
    throw new Error("Token de acesso do pedido inválido ou expirado");
  }
}

export function requireGuestOrderAccess(
  req: Request,
  order: { id: string; user_id: string },
) {
  const claims = getGuestOrderClaims(req);
  if (claims.orderId !== order.id || claims.userId !== order.user_id) {
    throw new Error("Token de acesso não pertence a este pedido");
  }
  return claims;
}
