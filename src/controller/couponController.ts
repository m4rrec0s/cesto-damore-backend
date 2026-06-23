import { Request, Response } from "express";
import { CouponService, CouponError } from "../services/couponService";
import prisma from "../database/prisma";

class CouponController {
  async validate(req: Request, res: Response) {
    try {
      const { code } = req.body;
      const userId = (req as any).user?.id;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

      const order = await prisma.order.findFirst({
        where: { user_id: userId, status: "PENDING", source: "customer" },
        include: { items: { include: { additionals: true } } },
      });
      if (!order) return res.status(400).json({ error: "Nenhum pedido pendente" });

      const cartTotal = order.items.reduce((sum, item) => {
        const base = Number(item.price) * item.quantity;
        const adds = item.additionals.reduce((a, ad) => a + Number(ad.price) * ad.quantity, 0);
        return sum + base + adds;
      }, 0);

      const result = await CouponService.validateCoupon(code, {
        userId,
        email: user.email,
        cartTotal,
        shipping: order.shipping_price ?? 0,
      });

      return res.json({
        valid: true,
        discount_amount: Math.round(result.discountAmount * 100) / 100,
        discount_type: result.coupon.discount_type,
        coupon_code: result.coupon.code,
        description: result.coupon.description,
      });
    } catch (err) {
      if (err instanceof CouponError) {
        return res.status(400).json({ valid: false, error_code: err.code });
      }
      return res.status(500).json({ error: "Erro interno" });
    }
  }

  async available(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

      const now = new Date();
      const coupons = await prisma.coupon.findMany({
        where: {
          status: "ACTIVE",
          is_visible: true,
          valid_from: { lte: now },
          OR: [
            { valid_until: null },
            { valid_until: { gte: now } },
          ],
          AND: [
            {
              OR: [
                { coupon_type: "GLOBAL" },
                { coupon_type: "EVENTO" },
                { coupon_type: "PRIMEIRA_COMPRA" },
                { email: user.email.toLowerCase() },
                { user_id: userId },
              ],
            },
          ],
        },
        select: {
          code: true,
          description: true,
          coupon_type: true,
          discount_type: true,
          discount_value: true,
          max_discount_cap: true,
          min_purchase_amount: true,
          valid_until: true,
        },
      });

      return res.json(coupons);
    } catch {
      return res.status(500).json({ error: "Erro interno" });
    }
  }

  async adminCreate(req: Request, res: Response) {
    try {
      const data = req.body;
      const coupon = await prisma.coupon.create({
        data: {
          code: data.code.toUpperCase(),
          description: data.description,
          coupon_type: data.coupon_type,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          max_discount_cap: data.max_discount_cap,
          min_purchase_amount: data.min_purchase_amount,
          usage_limit: data.usage_limit,
          valid_from: new Date(data.valid_from),
          valid_until: data.valid_until ? new Date(data.valid_until) : null,
          is_visible: data.is_visible ?? false,
          user_id: data.user_id,
          email: data.email?.toLowerCase(),
          status: data.status ?? "ACTIVE",
        },
      });
      return res.status(201).json(coupon);
    } catch (err: any) {
      if (err.code === "P2002") return res.status(409).json({ error: "Código de cupom já existe" });
      return res.status(500).json({ error: "Erro ao criar cupom" });
    }
  }

  async adminUpdate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const coupon = await prisma.coupon.update({
        where: { id },
        data: {
          ...(data.description !== undefined && { description: data.description }),
          ...(data.status && { status: data.status }),
          ...(data.discount_value !== undefined && { discount_value: data.discount_value }),
          ...(data.max_discount_cap !== undefined && { max_discount_cap: data.max_discount_cap }),
          ...(data.min_purchase_amount !== undefined && { min_purchase_amount: data.min_purchase_amount }),
          ...(data.usage_limit !== undefined && { usage_limit: data.usage_limit }),
          ...(data.valid_until !== undefined && { valid_until: data.valid_until ? new Date(data.valid_until) : null }),
          ...(data.is_visible !== undefined && { is_visible: data.is_visible }),
          ...(data.email !== undefined && { email: data.email?.toLowerCase() }),
          ...(data.user_id !== undefined && { user_id: data.user_id }),
        },
      });
      return res.json(coupon);
    } catch {
      return res.status(500).json({ error: "Erro ao atualizar cupom" });
    }
  }

  async adminList(req: Request, res: Response) {
    try {
      const coupons = await prisma.coupon.findMany({
        orderBy: { created_at: "desc" },
        include: { _count: { select: { usages: true } } },
      });
      return res.json(coupons);
    } catch {
      return res.status(500).json({ error: "Erro ao listar cupons" });
    }
  }

  async adminGetStats(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const coupon = await prisma.coupon.findUnique({ where: { id } });
      if (!coupon) return res.status(404).json({ error: "Cupom não encontrado" });

      const usages = await prisma.couponUsage.findMany({
        where: { coupon_id: id },
        include: { order: { select: { grand_total: true, created_at: true } } },
        orderBy: { created_at: "desc" },
      });

      const totalOrders = usages.length;
      const totalDiscount = usages.reduce((sum, u) => sum + u.discount_applied, 0);
      const avgTicket = totalOrders > 0
        ? usages.reduce((sum, u) => sum + (u.order.grand_total ?? 0), 0) / totalOrders
        : 0;

      return res.json({
        coupon,
        stats: { total_orders: totalOrders, total_discount: totalDiscount, avg_ticket: avgTicket },
        recent_usages: usages.slice(0, 20),
      });
    } catch {
      return res.status(500).json({ error: "Erro ao buscar estatísticas" });
    }
  }
}

export default new CouponController();
