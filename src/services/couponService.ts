import prisma from "../database/prisma";
import logger from "../utils/logger";

export type CouponErrorCode =
  | "COUPON_NOT_FOUND"
  | "COUPON_INACTIVE"
  | "COUPON_EXPIRED"
  | "COUPON_EXHAUSTED"
  | "BELOW_MIN_PURCHASE"
  | "COUPON_NOT_FOR_USER"
  | "NOT_FIRST_PURCHASE"
  | "ALREADY_USED";

export class CouponError extends Error {
  constructor(public code: CouponErrorCode) {
    super(code);
  }
}

interface ValidationContext {
  userId?: string;
  email: string;
  cartTotal: number;
  shipping: number;
}

export class CouponService {
  static async validateCoupon(code: string, ctx: ValidationContext) {
    const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!coupon) throw new CouponError("COUPON_NOT_FOUND");
    if (coupon.status !== "ACTIVE") throw new CouponError("COUPON_INACTIVE");
    if (coupon.valid_from > new Date()) throw new CouponError("COUPON_INACTIVE");
    if (coupon.valid_until && coupon.valid_until < new Date()) throw new CouponError("COUPON_EXPIRED");
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) throw new CouponError("COUPON_EXHAUSTED");
    if (coupon.min_purchase_amount && ctx.cartTotal < coupon.min_purchase_amount) throw new CouponError("BELOW_MIN_PURCHASE");

    if (coupon.coupon_type === "INDIVIDUAL") {
      const emailMatch = coupon.email?.toLowerCase() === ctx.email.toLowerCase();
      const userMatch = coupon.user_id && coupon.user_id === ctx.userId;
      if (!emailMatch && !userMatch) throw new CouponError("COUPON_NOT_FOR_USER");
    }

    if (coupon.coupon_type === "PRIMEIRA_COMPRA" && ctx.userId) {
      const paidOrders = await prisma.order.count({
        where: { user_id: ctx.userId, status: "PAID" },
      });
      if (paidOrders > 0) throw new CouponError("NOT_FIRST_PURCHASE");
    }

    const alreadyUsed = await prisma.couponUsage.findFirst({
      where: { coupon_id: coupon.id, email_used: ctx.email.toLowerCase() },
    });
    if (alreadyUsed) throw new CouponError("ALREADY_USED");

    const discountAmount = this.calculateDiscount(coupon, ctx);
    return { coupon, discountAmount };
  }

  static calculateDiscount(
    coupon: { discount_type: string; discount_value: number; max_discount_cap: number | null },
    ctx: { cartTotal: number; shipping: number },
  ): number {
    switch (coupon.discount_type) {
      case "PORCENTAGEM": {
        const raw = (ctx.cartTotal * coupon.discount_value) / 100;
        return coupon.max_discount_cap ? Math.min(raw, coupon.max_discount_cap) : raw;
      }
      case "VALOR_FIXO":
        return Math.min(coupon.discount_value, ctx.cartTotal);
      case "FRETE_GRATIS":
        if (coupon.discount_value > 0) return Math.min(coupon.discount_value, ctx.shipping);
        return ctx.shipping;
      default:
        return 0;
    }
  }

  static async confirmUsage(couponId: string, orderId: string, email: string, discountApplied: number, userId?: string) {
    await prisma.$transaction([
      prisma.couponUsage.create({
        data: { coupon_id: couponId, order_id: orderId, email_used: email.toLowerCase(), discount_applied: discountApplied, user_id: userId },
      }),
      prisma.coupon.update({
        where: { id: couponId },
        data: { used_count: { increment: 1 } },
      }),
    ]);
    logger.info(`🎟️ Cupom ${couponId} usado no pedido ${orderId}, desconto: R$${discountApplied.toFixed(2)}`);
  }
}

export default CouponService;
