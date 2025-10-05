import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";

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
  /**
   * Gera relatório completo de estoque
   */
  async getStockReport(threshold: number = 5): Promise<StockReport> {
    const lowStockItems: LowStockItem[] = [];

    // 1. Produtos com estoque baixo
    const products = await withRetry(() =>
      prisma.product.findMany({
        where: {
          stock_quantity: {
            lte: threshold,
            not: null,
          },
        },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
        },
      })
    );

    products.forEach((product) => {
      lowStockItems.push({
        id: product.id,
        name: product.name,
        type: "product",
        current_stock: product.stock_quantity || 0,
        threshold,
      });
    });

    // 2. Adicionais com estoque baixo (SEM cores)
    // Buscar todos os adicionais com estoque baixo
    const additionals = await withRetry(() =>
      prisma.additional.findMany({
        where: {
          stock_quantity: {
            lte: threshold,
            not: null,
          },
        },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
          colors: {
            select: {
              color_id: true,
            },
          },
        },
      })
    );

    // Apenas adicionar adicionais que NÃO têm cores
    // Se tem cores, o estoque é gerenciado por cor, não pelo adicional
    additionals.forEach((additional) => {
      if (!additional.colors || additional.colors.length === 0) {
        lowStockItems.push({
          id: additional.id,
          name: additional.name,
          type: "additional",
          current_stock: additional.stock_quantity || 0,
          threshold,
        });
      }
    });

    // 3. Cores de adicionais com estoque baixo
    const colorStocks = await withRetry(() =>
      prisma.additionalColor.findMany({
        where: {
          stock_quantity: {
            lte: threshold,
          },
        },
        select: {
          additional_id: true,
          color_id: true,
          stock_quantity: true,
          additional: {
            select: {
              name: true,
            },
          },
          color: {
            select: {
              name: true,
              hex_code: true,
            },
          },
        },
      })
    );

    colorStocks.forEach((colorStock) => {
      lowStockItems.push({
        id: `${colorStock.additional_id}-${colorStock.color_id}`,
        name: colorStock.color.name,
        type: "color",
        current_stock: colorStock.stock_quantity,
        threshold,
        color_name: colorStock.color.name,
        color_hex_code: colorStock.color.hex_code,
        additional_name: colorStock.additional.name,
      });
    });

    // 4. Contar totais
    const totalProducts = await prisma.product.count();
    const totalAdditionals = await prisma.additional.count();
    const totalColors = await prisma.additionalColor.count();

    const productsOutOfStock = await prisma.product.count({
      where: { stock_quantity: 0 },
    });

    // Contar apenas adicionais SEM cores que estão sem estoque
    const additionalsWithoutColors = await withRetry(() =>
      prisma.additional.findMany({
        where: {
          stock_quantity: 0,
        },
        select: {
          id: true,
          colors: {
            select: {
              color_id: true,
            },
          },
        },
      })
    );

    const additionalsOutOfStock = additionalsWithoutColors.filter(
      (additional) => !additional.colors || additional.colors.length === 0
    ).length;

    const colorsOutOfStock = await prisma.additionalColor.count({
      where: { stock_quantity: 0 },
    });

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

  /**
   * Retorna lista de itens críticos (estoque = 0)
   */
  async getCriticalStock(): Promise<LowStockItem[]> {
    const criticalItems: LowStockItem[] = [];

    // Produtos sem estoque
    const products = await withRetry(() =>
      prisma.product.findMany({
        where: { stock_quantity: 0 },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
        },
      })
    );

    products.forEach((product) => {
      criticalItems.push({
        id: product.id,
        name: product.name,
        type: "product",
        current_stock: 0,
        threshold: 0,
      });
    });

    // Adicionais sem estoque (apenas os que NÃO têm cores)
    const additionals = await withRetry(() =>
      prisma.additional.findMany({
        where: { stock_quantity: 0 },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
          colors: {
            select: {
              color_id: true,
            },
          },
        },
      })
    );

    // Apenas adicionar adicionais que NÃO têm cores
    additionals.forEach((additional) => {
      if (!additional.colors || additional.colors.length === 0) {
        criticalItems.push({
          id: additional.id,
          name: additional.name,
          type: "additional",
          current_stock: 0,
          threshold: 0,
        });
      }
    });

    // Cores sem estoque
    const colorStocks = await withRetry(() =>
      prisma.additionalColor.findMany({
        where: { stock_quantity: 0 },
        select: {
          additional_id: true,
          color_id: true,
          stock_quantity: true,
          additional: {
            select: {
              name: true,
            },
          },
          color: {
            select: {
              name: true,
              hex_code: true,
            },
          },
        },
      })
    );

    colorStocks.forEach((colorStock) => {
      criticalItems.push({
        id: `${colorStock.additional_id}-${colorStock.color_id}`,
        name: colorStock.color.name,
        type: "color",
        current_stock: 0,
        threshold: 0,
        color_name: colorStock.color.name,
        color_hex_code: colorStock.color.hex_code,
        additional_name: colorStock.additional.name,
      });
    });

    return criticalItems;
  }

  /**
   * Verifica se algum item atingiu estoque crítico (necessário para notificações)
   */
  async hasItemsBelowThreshold(threshold: number = 3): Promise<{
    has_critical: boolean;
    items: LowStockItem[];
  }> {
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
