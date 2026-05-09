import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import logger from "../utils/logger";

interface OrderItemData {
  product_id: string;
  quantity: number;
  additionals?: {
    additional_id: string;
    quantity: number;
  }[];
}

class ReservationService {
  /**
   * Creates a stock reservation for an order with automatic expiration
   */
  async createReservation(
    orderId: string,
    items: OrderItemData[],
    expirationMinutes: number,
  ): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

      // Use transaction with Serializable isolation to prevent race conditions
      await prisma.$transaction(
        async (tx: any) => {
          // Process each item in the order
          for (const item of items) {
            // Lock product row to ensure consistency
            const product = (await tx.$queryRaw`
              SELECT stock_quantity FROM "Product"
              WHERE id = ${item.product_id}
              FOR UPDATE
            `) as any[];

            if (!product || product.length === 0) {
              throw new Error(`Product ${item.product_id} not found`);
            }

            // Get total reserved quantity for this product
            const [{ total_reserved }] = (await tx.$queryRaw`
              SELECT COALESCE(SUM(quantity_reserved), 0)::INTEGER as total_reserved
              FROM "StockReservationItem" sri
              JOIN "StockReservation" sr ON sri.reservation_id = sr.id
              WHERE sri.product_id = ${item.product_id}
              AND sr.status = 'active'
              AND sr.expires_at > now()
            `) as any[];

            const physicalStock = product[0].stock_quantity || 0;
            const availableStock = physicalStock - total_reserved;

            if (availableStock < item.quantity) {
              throw new Error(
                `Insufficient stock for product ${item.product_id}. ` +
                  `Available: ${availableStock}, Requested: ${item.quantity}`,
              );
            }

            // Create reservation item for product
            await tx.stockReservationItem.create({
              data: {
                reservation: {
                  connectOrCreate: {
                    where: { order_id: orderId },
                    create: {
                      order_id: orderId,
                      expires_at: expiresAt,
                      status: "active",
                    },
                  },
                },
                product_id: item.product_id,
                quantity_reserved: item.quantity,
                item_type: "product",
              },
            });

            // Process additionals if present
            if (item.additionals && item.additionals.length > 0) {
              for (const additional of item.additionals) {
                // Lock item row
                const itemData = (await tx.$queryRaw`
                  SELECT stock_quantity FROM "Item"
                  WHERE id = ${additional.additional_id}
                  FOR UPDATE
                `) as any[];

                if (!itemData || itemData.length === 0) {
                  throw new Error(
                    `Additional item ${additional.additional_id} not found`,
                  );
                }

                // Get reserved quantity for this item
                const [{ total_reserved: item_reserved }] = (await tx.$queryRaw`
                  SELECT COALESCE(SUM(quantity_reserved), 0)::INTEGER as total_reserved
                  FROM "StockReservationItem" sri
                  JOIN "StockReservation" sr ON sri.reservation_id = sr.id
                  WHERE sri.item_id = ${additional.additional_id}
                  AND sr.status = 'active'
                  AND sr.expires_at > now()
                `) as any[];

                const itemPhysicalStock = itemData[0].stock_quantity || 0;
                const itemAvailableStock = itemPhysicalStock - item_reserved;

                if (itemAvailableStock < additional.quantity) {
                  throw new Error(
                    `Insufficient stock for additional item ${additional.additional_id}. ` +
                      `Available: ${itemAvailableStock}, Requested: ${additional.quantity}`,
                  );
                }

                // Create reservation item for additional
                await tx.stockReservationItem.create({
                  data: {
                    reservation_id: (await tx.stockReservation.findUnique({
                      where: { order_id: orderId },
                    }))!.id,
                    item_id: additional.additional_id,
                    quantity_reserved: additional.quantity,
                    item_type: "additional",
                  },
                });
              }
            }
          }
        },
        { isolationLevel: "Serializable" },
      );

      logger.info(`✅ Stock reservation created for order ${orderId}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Error creating reservation: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Release a reservation (when payment is cancelled/rejected)
   */
  async releaseReservation(orderId: string): Promise<void> {
    try {
      const reservation = await withRetry(() =>
        prisma.stockReservation.findUnique({
          where: { order_id: orderId },
        }),
      );

      if (!reservation) {
        logger.warn(`Reservation not found for order ${orderId}`);
        return;
      }

      await withRetry(() =>
        prisma.stockReservation.update({
          where: { id: reservation.id },
          data: {
            status: "cancelled",
            released_at: new Date(),
          },
        }),
      );

      logger.info(`✅ Stock reservation released for order ${orderId}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Error releasing reservation: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Confirm a reservation (convert to final stock decrement)
   * This is called when payment is approved
   */
  async confirmReservation(orderId: string): Promise<void> {
    try {
      const reservation = await withRetry(() =>
        prisma.stockReservation.findUnique({
          where: { order_id: orderId },
          include: { items: true },
        }),
      );

      if (!reservation) {
        logger.warn(`Reservation not found for order ${orderId}`);
        return;
      }

      if (reservation.status !== "active") {
        logger.warn(
          `Reservation for order ${orderId} is not active (status: ${reservation.status})`,
        );
        return;
      }

      // Mark reservation as released (it's no longer active after confirmation)
      await withRetry(() =>
        prisma.stockReservation.update({
          where: { id: reservation.id },
          data: {
            status: "released",
            released_at: new Date(),
          },
        }),
      );

      logger.info(`✅ Stock reservation confirmed for order ${orderId}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Error confirming reservation: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Cleanup expired reservations (scheduled job)
   */
  async cleanupExpiredReservations(): Promise<number> {
    try {
      const expiredReservations = await withRetry(() =>
        prisma.stockReservation.updateMany({
          where: {
            status: "active",
            expires_at: {
              lt: new Date(),
            },
          },
          data: {
            status: "expired",
            released_at: new Date(),
          },
        }),
      );

      if (expiredReservations.count > 0) {
        logger.info(
          `🧹 Cleaned up ${expiredReservations.count} expired reservations`,
        );
      }

      return expiredReservations.count;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Error during cleanup: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * Get available stock for a product/item considering active reservations
   */
  async getAvailableStock(
    productId?: string,
    itemId?: string,
  ): Promise<number> {
    try {
      if (!productId && !itemId) {
        throw new Error("Either productId or itemId must be provided");
      }

      if (productId) {
        const product = await withRetry(() =>
          prisma.product.findUnique({
            where: { id: productId },
            select: { stock_quantity: true },
          }),
        );

        if (!product) {
          return 0;
        }

        const physicalStock = product.stock_quantity || 0;

        const [{ total_reserved }] = (await prisma.$queryRaw`
          SELECT COALESCE(SUM(quantity_reserved), 0)::INTEGER as total_reserved
          FROM "StockReservationItem" sri
          JOIN "StockReservation" sr ON sri.reservation_id = sr.id
          WHERE sri.product_id = ${productId}
          AND sr.status = 'active'
          AND sr.expires_at > now()
        `) as any[];

        return physicalStock - total_reserved;
      } else if (itemId) {
        const item = await withRetry(() =>
          prisma.item.findUnique({
            where: { id: itemId },
            select: { stock_quantity: true },
          }),
        );

        if (!item) {
          return 0;
        }

        const physicalStock = item.stock_quantity || 0;

        const [{ total_reserved }] = (await prisma.$queryRaw`
          SELECT COALESCE(SUM(quantity_reserved), 0)::INTEGER as total_reserved
          FROM "StockReservationItem" sri
          JOIN "StockReservation" sr ON sri.reservation_id = sr.id
          WHERE sri.item_id = ${itemId}
          AND sr.status = 'active'
          AND sr.expires_at > now()
        `) as any[];

        return physicalStock - total_reserved;
      }

      return 0;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Error getting available stock: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * Extend the expiration time of a reservation
   */
  async extendReservation(
    orderId: string,
    additionalMinutes: number,
  ): Promise<void> {
    try {
      const reservation = await withRetry(() =>
        prisma.stockReservation.findUnique({
          where: { order_id: orderId },
        }),
      );

      if (!reservation) {
        logger.warn(`Reservation not found for order ${orderId}`);
        return;
      }

      const newExpiresAt = new Date(
        reservation.expires_at.getTime() + additionalMinutes * 60 * 1000,
      );

      await withRetry(() =>
        prisma.stockReservation.update({
          where: { id: reservation.id },
          data: { expires_at: newExpiresAt },
        }),
      );

      logger.info(
        `✅ Reservation extended for order ${orderId} (${additionalMinutes} minutes)`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`❌ Error extending reservation: ${errorMessage}`);
      throw error;
    }
  }
}

export default new ReservationService();
