import prisma from "../database/prisma";
import reservationService from "./reservationService";

export interface InventoryListFilters {
  page?: number;
  perPage?: number;
  search?: string;
  status?: "in_stock" | "low_stock" | "out_of_stock";
}

export interface InventoryAdjustInput {
  entityType?: "item" | "product";
  entityId: string;
  operation: "increment" | "decrement" | "set" | "zero";
  quantity?: number;
  reason: string;
  adminId?: string;
}

class InventoryService {
  private computeStatus(available: number): "in_stock" | "low_stock" | "out_of_stock" {
    if (available <= 0) return "out_of_stock";
    if (available < 30) return "low_stock";
    return "in_stock";
  }

  async listInventory(filters: InventoryListFilters) {
    const page = Math.max(1, filters.page || 1);
    const perPage = Math.min(100, Math.max(1, filters.perPage || 20));
    const search = (filters.search || "").trim();

    const itemWhere: any = {};
    const productWhere: any = {
      stock_mode: "PRODUCT_ONLY",
    };

    if (search) {
      itemWhere.name = { contains: search, mode: "insensitive" };
      productWhere.name = { contains: search, mode: "insensitive" };
    }

    const [items, products] = await Promise.all([
      prisma.item.findMany({
        where: itemWhere,
        select: {
          id: true,
          name: true,
          stock_quantity: true,
          type: true,
          image_url: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.product.findMany({
        where: productWhere,
        select: {
          id: true,
          name: true,
          stock_quantity: true,
          image_url: true,
          type: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const mappedItems = await Promise.all(
      items.map(async (item) => {
        const available = await reservationService.getAvailableStock(undefined, item.id);
        const physical = item.stock_quantity || 0;
        const reserved = Math.max(0, physical - available);
        return {
          entity_type: "item",
          id: item.id,
          name: item.name,
          category: item.type || "-",
          image_url: item.image_url || null,
          physical,
          reserved,
          available,
          status: this.computeStatus(available),
        };
      }),
    );

    const mappedProducts = await Promise.all(
      products.map(async (product) => {
        const available = await reservationService.getAvailableStock(product.id);
        const physical = product.stock_quantity || 0;
        const reserved = Math.max(0, physical - available);
        return {
          entity_type: "product",
          id: product.id,
          name: product.name,
          category: product.type?.name || "-",
          image_url: product.image_url || null,
          physical,
          reserved,
          available,
          status: this.computeStatus(available),
        };
      }),
    );

    let combined = [...mappedProducts, ...mappedItems];

    if (filters.status) {
      combined = combined.filter((entry) => entry.status === filters.status);
    }

    const total = combined.length;
    const start = (page - 1) * perPage;
    const end = start + perPage;

    return {
      data: combined.slice(start, end),
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async adjustStock(input: InventoryAdjustInput) {
    if (!input.reason || !input.reason.trim()) {
      throw new Error("Motivo é obrigatório");
    }

    const quantity = Math.max(0, Math.floor(input.quantity || 0));

    const result = await prisma.$transaction(async (tx) => {
      let currentStock = 0;
      let newStock = 0;
      let movementQuantity = 0;

      const entityType = input.entityType || "item";
      const rows = entityType === "product"
        ? await tx.$queryRaw<Array<{ stock_quantity: number | null }>>`
            SELECT stock_quantity
            FROM "Product"
            WHERE id = ${input.entityId}
            FOR UPDATE
          `
        : await tx.$queryRaw<Array<{ stock_quantity: number | null }>>`
            SELECT stock_quantity
            FROM "Item"
            WHERE id = ${input.entityId}
            FOR UPDATE
          `;

      if (!rows.length) {
        throw new Error(
          entityType === "product" ? "Produto não encontrado" : "Item não encontrado",
        );
      }

      currentStock = rows[0].stock_quantity || 0;

      switch (input.operation) {
        case "increment":
          movementQuantity = quantity;
          newStock = currentStock + quantity;
          break;
        case "decrement":
          movementQuantity = -quantity;
          newStock = Math.max(0, currentStock - quantity);
          break;
        case "zero":
          movementQuantity = -currentStock;
          newStock = 0;
          break;
        case "set":
          movementQuantity = quantity - currentStock;
          newStock = quantity;
          break;
        default:
          throw new Error("Operação inválida");
      }

      if (entityType === "product") {
        await tx.product.update({
          where: { id: input.entityId },
          data: { stock_quantity: newStock },
        });
      } else {
        await tx.item.update({
          where: { id: input.entityId },
          data: { stock_quantity: newStock },
        });
      }

      await tx.inventoryMovement.create({
        data: {
          product_id: entityType === "product" ? input.entityId : undefined,
          item_id: entityType === "item" ? input.entityId : undefined,
          type:
            input.operation === "increment"
              ? "manual_increment"
              : input.operation === "decrement"
                ? "manual_decrement"
                : "adjustment",
          quantity: movementQuantity,
          reason: input.reason.trim(),
          admin_id: input.adminId,
        },
      });

      return {
        entityType,
        entityId: input.entityId,
        previous: currentStock,
        current: newStock,
        delta: movementQuantity,
      };
    });

    return result;
  }

  async getMovementHistory(params: {
    itemId?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.min(100, Math.max(1, params.perPage || 20));

    const where: any = {};
    if (params.itemId) where.item_id = params.itemId;

    const [movements, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          item: { select: { id: true, name: true } },
          admin: { select: { id: true, name: true, email: true } },
        },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.inventoryMovement.count({ where }),
    ]);

    return {
      data: movements,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }
}

export default new InventoryService();
