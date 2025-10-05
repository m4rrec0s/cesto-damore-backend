import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import whatsappService from "./whatsappService";

interface OrderItemData {
  product_id: string;
  quantity: number;
  additionals?: {
    additional_id: string;
    quantity: number;
    color_id?: string; // Cor selecionada para este adicional
  }[];
}

class StockService {
  /**
   * Decrementa o estoque dos produtos e adicionais de um pedido
   */
  async decrementOrderStock(orderItems: OrderItemData[]): Promise<void> {
    try {
      for (const item of orderItems) {
        // 1. Decrementar estoque do produto principal
        await this.decrementProductStock(item.product_id, item.quantity);

        // 2. Decrementar estoque dos adicionais
        if (item.additionals && item.additionals.length > 0) {
          for (const additional of item.additionals) {
            await this.decrementAdditionalStock(
              additional.additional_id,
              additional.quantity,
              additional.color_id
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

  /**
   * Decrementa estoque de um produto
   */
  private async decrementProductStock(
    productId: string,
    quantity: number
  ): Promise<void> {
    const product = await withRetry(() =>
      prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, stock_quantity: true },
      })
    );

    if (!product) {
      throw new Error(`Produto ${productId} não encontrado`);
    }

    // Se não tem controle de estoque, apenas log e continua
    if (product.stock_quantity === null) {
      console.log(`Produto ${product.name} não possui controle de estoque`);
      return;
    }

    // Verifica se tem estoque suficiente
    if (product.stock_quantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${product.name}. Disponível: ${product.stock_quantity}, Solicitado: ${quantity}`
      );
    }

    // Decrementa estoque
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

    console.log(
      `✅ Estoque do produto ${product.name} decrementado em ${quantity} unidades`
    );

    // Verificar e enviar alerta se estoque ficou baixo
    const newStock = (product.stock_quantity || 0) - quantity;
    await this.checkAndNotifyLowStock(
      productId,
      product.name,
      newStock,
      "product"
    );
  }

  /**
   * Decrementa estoque de um adicional (com ou sem cor específica)
   */
  private async decrementAdditionalStock(
    additionalId: string,
    quantity: number,
    colorId?: string
  ): Promise<void> {
    const additional = await withRetry(() =>
      prisma.additional.findUnique({
        where: { id: additionalId },
        select: {
          id: true,
          name: true,
          stock_quantity: true,
          colors: {
            select: {
              color_id: true,
              stock_quantity: true,
              color: { select: { name: true } },
            },
          },
        },
      })
    );

    if (!additional) {
      throw new Error(`Adicional ${additionalId} não encontrado`);
    }

    // Caso 1: Adicional COM cor específica selecionada
    if (colorId && additional.colors.length > 0) {
      const colorStock = additional.colors.find((c) => c.color_id === colorId);

      if (!colorStock) {
        throw new Error(
          `Cor ${colorId} não encontrada para adicional ${additional.name}`
        );
      }

      // Verifica estoque da cor
      if (colorStock.stock_quantity < quantity) {
        throw new Error(
          `Estoque insuficiente da cor ${colorStock.color.name} para ${additional.name}. Disponível: ${colorStock.stock_quantity}, Solicitado: ${quantity}`
        );
      }

      // Decrementa estoque da cor específica
      await withRetry(() =>
        prisma.additionalColor.update({
          where: {
            additional_id_color_id: {
              additional_id: additionalId,
              color_id: colorId,
            },
          },
          data: {
            stock_quantity: {
              decrement: quantity,
            },
          },
        })
      );

      console.log(
        `✅ Estoque da cor ${colorStock.color.name} do adicional ${additional.name} decrementado em ${quantity} unidades`
      );

      // Verificar e enviar alerta se estoque da cor ficou baixo
      const newStock = colorStock.stock_quantity - quantity;
      await this.checkAndNotifyLowStock(
        `${additionalId}-${colorId}`,
        additional.name,
        newStock,
        "color",
        {
          name: colorStock.color.name,
          hex: "", // Não temos o hex aqui, pode ser obtido se necessário
          additionalName: additional.name,
        }
      );

      return;
    }

    // Caso 2: Adicional SEM cor (estoque total)
    if (additional.stock_quantity === null) {
      console.log(
        `Adicional ${additional.name} não possui controle de estoque`
      );
      return;
    }

    // Verifica estoque total
    if (additional.stock_quantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${additional.name}. Disponível: ${additional.stock_quantity}, Solicitado: ${quantity}`
      );
    }

    // Decrementa estoque total
    await withRetry(() =>
      prisma.additional.update({
        where: { id: additionalId },
        data: {
          stock_quantity: {
            decrement: quantity,
          },
        },
      })
    );

    console.log(
      `✅ Estoque do adicional ${additional.name} decrementado em ${quantity} unidades`
    );

    // Verificar e enviar alerta se estoque ficou baixo
    const newStock = (additional.stock_quantity || 0) - quantity;
    await this.checkAndNotifyLowStock(
      additionalId,
      additional.name,
      newStock,
      "additional"
    );
  }

  /**
   * Verifica se o estoque ficou baixo e envia notificação WhatsApp
   */
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
      // Estoque crítico (zerado)
      if (currentStock === CRITICAL_THRESHOLD) {
        await whatsappService.sendCriticalStockAlert(
          itemId,
          itemName,
          itemType,
          colorInfo
        );
      }
      // Estoque baixo (entre 1 e 5)
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
      // Não interrompe o fluxo se a notificação falhar
      console.error("Erro ao enviar notificação de estoque baixo:", error);
    }
  }

  /**
   * Verifica se há estoque disponível antes de criar o pedido
   */
  async validateOrderStock(orderItems: OrderItemData[]): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    for (const item of orderItems) {
      // Validar produto
      try {
        const product = await prisma.product.findUnique({
          where: { id: item.product_id },
          select: { name: true, stock_quantity: true },
        });

        if (product && product.stock_quantity !== null) {
          if (product.stock_quantity < item.quantity) {
            errors.push(
              `Produto ${product.name}: estoque insuficiente (disponível: ${product.stock_quantity})`
            );
          }
        }
      } catch (error) {
        errors.push(`Erro ao validar produto ${item.product_id}`);
      }

      // Validar adicionais
      if (item.additionals) {
        for (const additional of item.additionals) {
          try {
            const additionalData = await prisma.additional.findUnique({
              where: { id: additional.additional_id },
              select: {
                name: true,
                stock_quantity: true,
                colors: {
                  where: additional.color_id
                    ? { color_id: additional.color_id }
                    : undefined,
                  select: {
                    stock_quantity: true,
                    color: { select: { name: true } },
                  },
                },
              },
            });

            if (!additionalData) continue;

            // Se tem cor selecionada, validar estoque da cor
            if (additional.color_id && additionalData.colors.length > 0) {
              const colorStock = additionalData.colors[0];
              if (colorStock.stock_quantity < additional.quantity) {
                errors.push(
                  `Adicional ${additionalData.name} (${colorStock.color.name}): estoque insuficiente (disponível: ${colorStock.stock_quantity})`
                );
              }
            }
            // Senão, validar estoque total
            else if (additionalData.stock_quantity !== null) {
              if (additionalData.stock_quantity < additional.quantity) {
                errors.push(
                  `Adicional ${additionalData.name}: estoque insuficiente (disponível: ${additionalData.stock_quantity})`
                );
              }
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
