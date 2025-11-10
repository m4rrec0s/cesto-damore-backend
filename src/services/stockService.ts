import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import whatsappService from "./whatsappService";
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
  /**
   * Decrementa o estoque dos produtos e adicionais de um pedido
   * ⚠️ TEMPORARIAMENTE DESABILITADO - Mantém validações mas não decrementa
   */
  async decrementOrderStock(orderItems: OrderItemData[]): Promise<void> {
    console.log("⚠️ DECREMENTO DE ESTOQUE DESABILITADO - Pedido criado sem alterar estoque");
    return; // ✅ Desabilitado temporariamente
    
    /* CÓDIGO ORIGINAL (COMENTADO):
    try {
      for (const item of orderItems) {
        // 1. Decrementar estoque dos componentes do produto (NOVA LÓGICA)
        await this.decrementProductStock(item.product_id, item.quantity);

        // 2. Decrementar estoque dos adicionais
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
    */
  }

  /**
   * Decrementa estoque de um produto através dos seus componentes
   */
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

    // NOVA LÓGICA: Se o produto tem componentes, decrementar estoque dos items
    if (product.components.length > 0) {
      await productComponentService.decrementComponentsStock(
        productId,
        quantity
      );
      return;
    }

    // LÓGICA LEGADA: Se não tem componentes, decrementar estoque direto do produto
    if (product.stock_quantity === null) {
      console.warn(`Produto ${product.name} não possui controle de estoque`);
      return;
    }

    // Verifica se tem estoque suficiente
    if (product.stock_quantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${product.name}. Disponível: ${product.stock_quantity}, Solicitado: ${quantity}`
      );
    }

    // Decrementa estoque direto
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
    quantity: number
  ): Promise<void> {
    // O schema atual unificou "additional" no modelo Item.
    // Aqui tentamos ler como Item e, caso não exista uma tabela de cores
    // (additionalColor) no schema atual, fazemos fallback para decrementar
    // o estoque total do Item.
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

    // Cores legadas removidas: decrementa sempre do estoque unificado do Item

    // Valida estoque total do item
    if (item.stock_quantity === null || item.stock_quantity === undefined) {
      console.warn(`Item ${item.name} não possui controle de estoque`);
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
   * ✅ CRÍTICO: Busca dados frescos do banco sem cache
   */
  async validateOrderStock(orderItems: OrderItemData[]): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    for (const item of orderItems) {
      // Validar produto - ✅ Força refresh com $queryRaw
      try {
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
      } catch (error) {
        console.error(
          `Erro ao validar estoque do produto ${item.product_id}:`,
          error
        );
        errors.push(`Erro ao validar produto ${item.product_id}`);
      }

      // Validar adicionais - ✅ Força refresh com $queryRaw
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

            // Validar estoque total do item
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
