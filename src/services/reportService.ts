import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";

interface LowStockItem {
  id: string;
}

interface LowStockItem {
  id: string;
  name: string;
  type: "product" | "additional" | "color";
  current_stock: number;
  threshold: number;
  color_name?: string;
  color_hex_code?: string;
  additional_name?: string;
}

interface StockReport {
  low_stock_items: LowStockItem[];
  total_products: number;
  total_additionals: number;
  total_colors: number;
  products_out_of_stock: number;
  additionals_out_of_stock: number;
  colors_out_of_stock: number;
}

class ReportService {

  async getStockReport(threshold: number = 5): Promise<StockReport> {
    const lowStockItems: LowStockItem[] = [];

    const products = await withRetry(() =>
      prisma.product.findMany({
        where: { stock_quantity: { lte: threshold } },
        select: { id: true, name: true, stock_quantity: true },
      })
    );

    (products as any[]).forEach((p) =>
      lowStockItems.push({
        id: p.id,
        name: p.name,
        type: "product",
        current_stock: p.stock_quantity || 0,
        threshold,
      })
    );

    const additionals = await withRetry(() =>
      prisma.item.findMany({
        where: { stock_quantity: { lte: threshold } },
        select: { id: true, name: true, stock_quantity: true },
      })
    );

    for (const a of additionals as any[]) {
      lowStockItems.push({
        id: a.id,
        name: a.name,
        type: "additional",
        current_stock: a.stock_quantity || 0,
        threshold,
      });
    }

    const totalProducts = await prisma.product.count();
    const totalAdditionals = await prisma.item.count();
    const totalColors = 0;

    const productsOutOfStock = await prisma.product.count({
      where: { stock_quantity: 0 },
    });

    const additionalsOutOfStock = await prisma.item.count({
      where: { stock_quantity: 0 },
    });

    const colorsOutOfStock = 0;

    return {
      low_stock_items: lowStockItems,
      total_products: totalProducts,
      total_additionals: totalAdditionals,
      total_colors: totalColors,
      products_out_of_stock: productsOutOfStock,
      additionals_out_of_stock: additionalsOutOfStock,
      colors_out_of_stock: colorsOutOfStock,
    };
  }

  async getCriticalStock(): Promise<LowStockItem[]> {
    const criticalItems: LowStockItem[] = [];

    const products = await withRetry(() =>
      prisma.product.findMany({
        where: { stock_quantity: 0 },
        select: { id: true, name: true },
      })
    );
    for (const p of products as any[]) {
      criticalItems.push({
        id: p.id,
        name: p.name,
        type: "product",
        current_stock: 0,
        threshold: 0,
      });
    }

    const additionals = (await withRetry(() =>
      prisma.item.findMany({
        where: { stock_quantity: 0 },
        select: { id: true, name: true },
      })
    )) as any[];

    for (const a of additionals) {
      criticalItems.push({
        id: a.id,
        name: a.name,
        type: "additional",
        current_stock: 0,
        threshold: 0,
      });
    }

    return criticalItems;
  }

  async hasItemsBelowThreshold(
    threshold: number = 3
  ): Promise<{ has_critical: boolean; items: LowStockItem[] }> {
    const criticalItems = await this.getCriticalStock();
    const lowStock = await this.getStockReport(threshold);
    return {
      has_critical:
        criticalItems.length > 0 || lowStock.low_stock_items.length > 0,
      items: [...criticalItems, ...lowStock.low_stock_items],
    };
  }
}

export default new ReportService();
