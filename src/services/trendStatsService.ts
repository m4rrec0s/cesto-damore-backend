import { Request } from "express";
import { startOfDay, subDays } from "date-fns";
import { OrderStatus } from "@prisma/client";
import prisma from "../database/prisma";
import logger from "../utils/logger";

const DEFAULT_DAYS = 30;

const getStartOfDay = (date: Date) => startOfDay(date);
const getDateOnly = (date: Date) => startOfDay(date);

const normalizeIp = (ip: string) => ip.replace("::ffff:", "");

const getRequestIp = (req: Request): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"] as string | undefined;
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0];
  const candidate = (raw || realIp || req.ip || req.socket.remoteAddress || "")
    .trim();
  if (!candidate) return null;
  return normalizeIp(candidate);
};

const getRequestRegion = (req: Request): string | null => {
  const header = (name: string) => req.headers[name] as string | undefined;
  const region =
    header("cf-ipcountry") ||
    header("x-vercel-ip-country") ||
    header("x-country-code") ||
    header("x-geo-country") ||
    header("x-geo-region") ||
    header("x-region");
  if (!region) return null;
  const normalized = region.toUpperCase();
  if (normalized === "XX" || normalized === "UNKNOWN") return null;
  return normalized;
};

const buildScopeKey = (payload: {
  statType: string;
  entityType: string;
  entityKey: string;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
}) => {
  const startKey = payload.periodStart.toISOString().split("T")[0];
  const endKey = payload.periodEnd.toISOString().split("T")[0];
  return [
    payload.statType,
    payload.entityType,
    payload.entityKey,
    payload.periodType,
    startKey,
    endKey,
  ].join(":");
};

class TrendStatsService {
  private async upsertIncrement(params: {
    statType: "PRODUCT_VIEW" | "PRODUCT_SALE" | "LAYOUT_VIEW" | "ACCESS";
    entityType: "PRODUCT" | "LAYOUT" | "REGION" | "IP";
    entityKey: string;
    periodType: "DAILY" | "ROLLING_30D";
    periodStart: Date;
    periodEnd: Date;
    increment: number;
  }) {
    const scopeKey = buildScopeKey({
      statType: params.statType,
      entityType: params.entityType,
      entityKey: params.entityKey,
      periodType: params.periodType,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    });

    await prisma.trendStat.upsert({
      where: { scope_key: scopeKey },
      update: {
        count: {
          increment: params.increment,
        },
      },
      create: {
        stat_type: params.statType,
        entity_type: params.entityType,
        entity_key: params.entityKey,
        period_type: params.periodType,
        period_start: params.periodStart,
        period_end: params.periodEnd,
        count: params.increment,
        scope_key: scopeKey,
      },
    });
  }

  private async upsertSet(params: {
    statType: "PRODUCT_VIEW" | "PRODUCT_SALE" | "LAYOUT_VIEW" | "ACCESS";
    entityType: "PRODUCT" | "LAYOUT" | "REGION" | "IP";
    entityKey: string;
    periodType: "DAILY" | "ROLLING_30D";
    periodStart: Date;
    periodEnd: Date;
    value: number;
  }) {
    const scopeKey = buildScopeKey({
      statType: params.statType,
      entityType: params.entityType,
      entityKey: params.entityKey,
      periodType: params.periodType,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    });

    await prisma.trendStat.upsert({
      where: { scope_key: scopeKey },
      update: {
        count: params.value,
      },
      create: {
        stat_type: params.statType,
        entity_type: params.entityType,
        entity_key: params.entityKey,
        period_type: params.periodType,
        period_start: params.periodStart,
        period_end: params.periodEnd,
        count: params.value,
        scope_key: scopeKey,
      },
    });
  }

  private getDailyPeriod(date: Date = new Date()) {
    return {
      periodStart: getStartOfDay(date),
      periodEnd: getDateOnly(date),
    };
  }

  private getRollingPeriod(days: number = DEFAULT_DAYS) {
    const now = new Date();
    const startDate = getStartOfDay(subDays(now, days - 1));
    const endDate = getDateOnly(now);
    return { periodStart: startDate, periodEnd: endDate, rangeEnd: now };
  }

  private shouldSkipRequest(req: Request) {
    const user = (req as { user?: { role?: string } }).user;
    return user?.role === "admin" || user?.role === "ADMIN";
  }

  async recordAccess(req: Request) {
    try {
      if (this.shouldSkipRequest(req)) return;

      const { periodStart, periodEnd } = this.getDailyPeriod();
      const ip = getRequestIp(req);
      const region = getRequestRegion(req);

      const operations: Promise<void>[] = [];

      if (ip) {
        operations.push(
          this.upsertIncrement({
            statType: "ACCESS",
            entityType: "IP",
            entityKey: ip,
            periodType: "DAILY",
            periodStart,
            periodEnd,
            increment: 1,
          }),
        );
      }

      if (region) {
        operations.push(
          this.upsertIncrement({
            statType: "ACCESS",
            entityType: "REGION",
            entityKey: region,
            periodType: "DAILY",
            periodStart,
            periodEnd,
            increment: 1,
          }),
        );
      }

      await Promise.all(operations);
    } catch (error) {
      logger.error("❌ [TrendStats] Falha ao registrar acesso:", error);
    }
  }

  async recordProductView(productId: string, req: Request) {
    try {
      if (!productId || this.shouldSkipRequest(req)) return;

      const { periodStart, periodEnd } = this.getDailyPeriod();

      await Promise.all([
        this.upsertIncrement({
          statType: "PRODUCT_VIEW",
          entityType: "PRODUCT",
          entityKey: productId,
          periodType: "DAILY",
          periodStart,
          periodEnd,
          increment: 1,
        }),
        this.recordAccess(req),
      ]);
    } catch (error) {
      logger.error("❌ [TrendStats] Falha ao registrar view de produto:", error);
    }
  }

  async recordLayoutView(layoutId: string, req: Request) {
    try {
      if (!layoutId || this.shouldSkipRequest(req)) return;

      const { periodStart, periodEnd } = this.getDailyPeriod();

      await Promise.all([
        this.upsertIncrement({
          statType: "LAYOUT_VIEW",
          entityType: "LAYOUT",
          entityKey: layoutId,
          periodType: "DAILY",
          periodStart,
          periodEnd,
          increment: 1,
        }),
        this.recordAccess(req),
      ]);
    } catch (error) {
      logger.error("❌ [TrendStats] Falha ao registrar view de layout:", error);
    }
  }

  async refreshRollingTrends(days: number = DEFAULT_DAYS) {
    const { periodStart, periodEnd, rangeEnd } = this.getRollingPeriod(days);

    try {
      const paidStatuses: OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED"];

      const topSales = await prisma.orderItem.groupBy({
        by: ["product_id"],
        _sum: {
          quantity: true,
        },
        where: {
          order: {
            status: { in: paidStatuses },
            created_at: {
              gte: periodStart,
              lte: rangeEnd,
            },
          },
        },
        orderBy: {
          _sum: { quantity: "desc" },
        },
        take: 50,
      });

      const dailyViews = await prisma.trendStat.groupBy({
        by: ["entity_key"],
        _sum: { count: true },
        where: {
          stat_type: "PRODUCT_VIEW",
          entity_type: "PRODUCT",
          period_type: "DAILY",
          period_start: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        orderBy: {
          _sum: { count: "desc" },
        },
        take: 50,
      });

      const layoutViews = await prisma.trendStat.groupBy({
        by: ["entity_key"],
        _sum: { count: true },
        where: {
          stat_type: "LAYOUT_VIEW",
          entity_type: "LAYOUT",
          period_type: "DAILY",
          period_start: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        orderBy: {
          _sum: { count: "desc" },
        },
        take: 50,
      });

      const regionAccess = await prisma.trendStat.groupBy({
        by: ["entity_key"],
        _sum: { count: true },
        where: {
          stat_type: "ACCESS",
          entity_type: "REGION",
          period_type: "DAILY",
          period_start: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        orderBy: {
          _sum: { count: "desc" },
        },
        take: 20,
      });

      const ipAccess = await prisma.trendStat.groupBy({
        by: ["entity_key"],
        _sum: { count: true },
        where: {
          stat_type: "ACCESS",
          entity_type: "IP",
          period_type: "DAILY",
          period_start: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        orderBy: {
          _sum: { count: "desc" },
        },
        take: 20,
      });

      await Promise.all([
        ...topSales.map((entry) =>
          this.upsertSet({
            statType: "PRODUCT_SALE",
            entityType: "PRODUCT",
            entityKey: entry.product_id,
            periodType: "ROLLING_30D",
            periodStart,
            periodEnd,
            value: entry._sum?.quantity ?? 0,
          }),
        ),
        ...dailyViews.map((entry) =>
          this.upsertSet({
            statType: "PRODUCT_VIEW",
            entityType: "PRODUCT",
            entityKey: entry.entity_key,
            periodType: "ROLLING_30D",
            periodStart,
            periodEnd,
            value: entry._sum.count || 0,
          }),
        ),
        ...layoutViews.map((entry) =>
          this.upsertSet({
            statType: "LAYOUT_VIEW",
            entityType: "LAYOUT",
            entityKey: entry.entity_key,
            periodType: "ROLLING_30D",
            periodStart,
            periodEnd,
            value: entry._sum.count || 0,
          }),
        ),
        ...regionAccess.map((entry) =>
          this.upsertSet({
            statType: "ACCESS",
            entityType: "REGION",
            entityKey: entry.entity_key,
            periodType: "ROLLING_30D",
            periodStart,
            periodEnd,
            value: entry._sum.count || 0,
          }),
        ),
        ...ipAccess.map((entry) =>
          this.upsertSet({
            statType: "ACCESS",
            entityType: "IP",
            entityKey: entry.entity_key,
            periodType: "ROLLING_30D",
            periodStart,
            periodEnd,
            value: entry._sum.count || 0,
          }),
        ),
      ]);
    } catch (error: any) {
      logger.error("❌ [TrendStats] Falha ao atualizar tendencias:", error);
    }
  }

  async getRollingStats(params: {
    statType: "PRODUCT_VIEW" | "PRODUCT_SALE" | "LAYOUT_VIEW" | "ACCESS";
    entityType: "PRODUCT" | "LAYOUT" | "REGION" | "IP";
    limit: number;
  }) {
    const { periodStart, periodEnd } = this.getRollingPeriod();
    return prisma.trendStat.findMany({
      where: {
        stat_type: params.statType,
        entity_type: params.entityType,
        period_type: "ROLLING_30D",
        period_start: periodStart,
        period_end: periodEnd,
      },
      orderBy: {
        count: "desc",
      },
      take: params.limit,
    });
  }

  async getTopSellingProducts(limit: number = 4) {
    const rolling = await this.getRollingStats({
      statType: "PRODUCT_SALE",
      entityType: "PRODUCT",
      limit,
    });

    if (!rolling.length) {
      const { periodStart, rangeEnd } = this.getRollingPeriod();
      const paidStatuses: OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED"];
      const fallback = await prisma.orderItem.groupBy({
        by: ["product_id"],
        _sum: { quantity: true },
        where: {
          order: {
            status: { in: paidStatuses },
            created_at: {
              gte: periodStart,
              lte: rangeEnd,
            },
          },
        },
        orderBy: { _sum: { quantity: "desc" } },
        take: limit,
      });

      return fallback.map((entry) => ({
        product_id: entry.product_id,
        total_sold: entry._sum?.quantity ?? 0,
      }));
    }

    return rolling.map((entry) => ({
      product_id: entry.entity_key,
      total_sold: entry.count,
    }));
  }

  async getTrendSummary() {
    const { periodStart, periodEnd } = this.getRollingPeriod();

    const [
      topSales,
      topViews,
      topLayouts,
      topRegions,
      topIps,
    ] = await Promise.all([
      this.getRollingStats({
        statType: "PRODUCT_SALE",
        entityType: "PRODUCT",
        limit: 10,
      }),
      this.getRollingStats({
        statType: "PRODUCT_VIEW",
        entityType: "PRODUCT",
        limit: 10,
      }),
      this.getRollingStats({
        statType: "LAYOUT_VIEW",
        entityType: "LAYOUT",
        limit: 10,
      }),
      this.getRollingStats({
        statType: "ACCESS",
        entityType: "REGION",
        limit: 10,
      }),
      this.getRollingStats({
        statType: "ACCESS",
        entityType: "IP",
        limit: 10,
      }),
    ]);

    const productIds = Array.from(
      new Set([...topSales, ...topViews].map((entry) => entry.entity_key)),
    );
    const layoutIds = topLayouts.map((entry) => entry.entity_key);

    const [products, layouts] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, image_url: true, price: true },
      }),
      prisma.dynamicLayout.findMany({
        where: { id: { in: layoutIds } },
        select: { id: true, name: true, previewImageUrl: true },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const layoutMap = new Map(layouts.map((l) => [l.id, l]));

    return {
      period: {
        days: DEFAULT_DAYS,
        startDate: periodStart,
        endDate: periodEnd,
      },
      top_products_sold: topSales.map((entry) => ({
        product_id: entry.entity_key,
        name: productMap.get(entry.entity_key)?.name || "Produto desconhecido",
        image_url: productMap.get(entry.entity_key)?.image_url || null,
        total_sold: entry.count,
      })),
      top_products_viewed: topViews.map((entry) => ({
        product_id: entry.entity_key,
        name: productMap.get(entry.entity_key)?.name || "Produto desconhecido",
        image_url: productMap.get(entry.entity_key)?.image_url || null,
        total_views: entry.count,
      })),
      top_layouts_viewed: topLayouts.map((entry) => ({
        layout_id: entry.entity_key,
        name: layoutMap.get(entry.entity_key)?.name || "Layout desconhecido",
        preview_image_url:
          layoutMap.get(entry.entity_key)?.previewImageUrl || null,
        total_views: entry.count,
      })),
      top_regions: topRegions.map((entry) => ({
        region: entry.entity_key,
        total_access: entry.count,
      })),
      top_ips: topIps.map((entry) => ({
        ip: entry.entity_key,
        total_access: entry.count,
      })),
      updated_at: new Date(),
    };
  }
}

export default new TrendStatsService();
