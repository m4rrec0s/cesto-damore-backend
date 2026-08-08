import { Request } from "express";
import { createHmac } from "crypto";

function getSecret() {
  const secret = process.env.GUEST_ORDER_TOKEN_SECRET;
  if (!secret) throw new Error("GUEST_ORDER_TOKEN_SECRET não configurado");
  return secret;
}

function hash(value: string, scope: string) {
  return createHmac("sha256", getSecret())
    .update(`${scope}:${value}`)
    .digest("hex");
}

export function getGuestOrderIdentity(req: Request, email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase();
  const ip = (req.ip || req.socket.remoteAddress || "").replace("::ffff:", "");

  if (!normalizedEmail || !ip) return undefined;

  return {
    guestEmailHash: hash(normalizedEmail, "guest-email"),
    guestIpHash: hash(ip, "guest-ip"),
  };
}
