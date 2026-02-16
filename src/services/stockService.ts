import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import whatsappService from "./whatsappService";
import logger from "../utils/logger";
import productComponentService from "./productComponentService";

interface OrderItemData {
  product_id: string;
  quantity: number;
  additionals?: {
    additional_id: string;
    quantity: number;
  }[];
}

class StockService {
  

  async decrementOrderStock(orderItems: OrderItemData[]): Promise<void> {
    try {
      for (const item of orderItems) {

        await this.decrementProductStock(item.product_id, item.quantity);

        if (item.additionals && item.additionals.length > 0) {
          for (const additional of item.additionals) {
            await this.decrementAdditionalStock(
              additional.additional_id,
              additional.quantity
            );
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Erro ao decrementar estoque";
      throw new Error(`Erro ao decrementar estoque: ${errorMessage}`);
    }
  }

  

  private async decrementProductStock(
    productId: string,
    quantity: number
  ): Promise<void> {
    const product = await withRetry(() =>
      prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
          components: {
            include: {
              item: true,
            },
          },
        },
      })
    );

    if (!product) {
      throw new Error(`Produto ${productId} não encontrado`);
    }

    if (product.components.length > 0) {
      await productComponentService.decrementComponentsStock(
        productId,
        quantity
      );
      return;
    }

    if (product.stock_quantity === null) {
      logger.warn(`Produto ${product.name} não possui controle de estoque`);
      return;
    }

    if (product.stock_quantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${product.name}. Disponível: ${product.stock_quantity}, Solicitado: ${quantity}`
      );
    }

    await withRetry(() =>
      prisma.product.update({
        where: { id: productId },
        data: {
          stock_quantity: {
            decrement: quantity,
          },
        },
      })
    );

    const newStock = (product.stock_quantity || 0) - quantity;
    await this.checkAndNotifyLowStock(
      productId,
      product.name,
      newStock,
      "product"
    );
  }

  

  private async decrementAdditionalStock(
    additionalId: string,
    quantity: number
  ): Promise<void> {

    const item = await withRetry(() =>
      prisma.item.findUnique({
        where: { id: additionalId },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
        },
      })
    );

    if (!item) {
      throw new Error(`Adicional/Item ${additionalId} não encontrado`);
    }

    if (item.stock_quantity === null || item.stock_quantity === undefined) {
      logger.warn(`Item ${item.name} não possui controle de estoque`);
      return;
    }

    if (item.stock_quantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${item.name}. Disponível: ${item.stock_quantity}, Solicitado: ${quantity}`
      );
    }

    await withRetry(() =>
      prisma.item.update({
        where: { id: additionalId },
        data: { stock_quantity: { decrement: quantity } },
      })
    );

    const newStock = (item.stock_quantity || 0) - quantity;
    await this.checkAndNotifyLowStock(
      additionalId,
      item.name,
      newStock,
      "additional"
    );
  }

  

  private async checkAndNotifyLowStock(
    itemId: string,
    itemName: string,
    currentStock: number,
    itemType: "product" | "additional" | "color",
    colorInfo?: { name: string; hex: string; additionalName: string }
  ): Promise<void> {
    const CRITICAL_THRESHOLD = 0;
    const LOW_THRESHOLD = 5;

    try {

      if (currentStock === CRITICAL_THRESHOLD) {
        await whatsappService.sendCriticalStockAlert(
          itemId,
          itemName,
          itemType,
          colorInfo
        );
      }

      else if (currentStock > 0 && currentStock <= LOW_THRESHOLD) {
        await whatsappService.sendLowStockAlert(
          itemId,
          itemName,
          currentStock,
          LOW_THRESHOLD,
          itemType,
          colorInfo
        );
      }
    } catch (error) {

      logger.error("Erro ao enviar notificação de estoque baixo:", error);
    }
  }

  

  async validateOrderStock(orderItems: OrderItemData[]): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    for (const item of orderItems) {

      try {
        const componentCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint as count
          FROM "ProductComponent"
          WHERE product_id = ${item.product_id}
        `;

        const hasComponents = Number(componentCount[0]?.count || 0) > 0;

        if (hasComponents) {
          logger.info(
            `⚠️ Produto ${item.product_id} usa sistema de components - validação de estoque via components (já feita anteriormente)`
          );

        } else {

          const productResult = await prisma.$queryRaw<
            Array<{
              name: string;
              stock_quantity: number | null;
            }>
          >`
            SELECT name, stock_quantity 
            FROM "Product" 
            WHERE id = ${item.product_id}
          `;

          const product = productResult[0];

          if (product && product.stock_quantity !== null) {
            if (product.stock_quantity < item.quantity) {
              errors.push(
                `Produto ${product.name}: estoque insuficiente (disponível: ${product.stock_quantity})`
              );
            }
          }
        }
      } catch (error) {
        logger.error(
          `Erro ao validar estoque do produto ${item.product_id}:`,
          error
        );
        errors.push(`Erro ao validar produto ${item.product_id}`);
      }

      if (item.additionals) {
        for (const additional of item.additionals) {
          try {
            const additionalResult = await prisma.$queryRaw<
              Array<{
                name: string;
                stock_quantity: number | null;
              }>
            >`
              SELECT name, stock_quantity 
              FROM "Item" 
              WHERE id = ${additional.additional_id}
            `;

            const additionalData = additionalResult[0];

            if (!additionalData) continue;

            if (
              additionalData.stock_quantity !== null &&
              additionalData.stock_quantity < additional.quantity
            ) {
              errors.push(
                `Adicional ${additionalData.name}: estoque insuficiente (disponível: ${additionalData.stock_quantity})`
              );
            }
          } catch (error) {
            errors.push(
              `Erro ao validar adicional ${additional.additional_id}`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default new StockService();
