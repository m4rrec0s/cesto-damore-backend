import prisma from "../database/prisma";
import logger from "../utils/logger";

interface CustomizationStillValid {
  customizationId: string;
  isValid: boolean;
  hasContent: boolean;
}

class CustomizationCleanupService {
  async detectAndCleanDeletedCustomizations(
    orderId: string,
  ): Promise<{ cleanedCount: number; shouldDeleteOrder: boolean }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            customizations: true,
            product: true,
          },
        },
      },
    });

    if (!order) {
      return { cleanedCount: 0, shouldDeleteOrder: false };
    }

    let cleanedCount = 0;
    const itemsWithValidCustomizations: string[] = [];

    for (const item of order.items) {
      const itemHasValidCustomizations = item.customizations.some((cust) => {
        const hasContent = this.checkCustomizationHasContent(cust.value);
        return hasContent;
      });

      if (itemHasValidCustomizations) {
        itemsWithValidCustomizations.push(item.id);
      } else if (item.customizations.length > 0) {
        // Item has customizations but they're all empty - delete them
        for (const cust of item.customizations) {
          await prisma.orderItemCustomization.delete({
            where: { id: cust.id },
          });
          cleanedCount++;
        }
      }
    }

    // If all items have no valid customizations and order is still PENDING, delete it
    const shouldDeleteOrder =
      order.status === "PENDING" && itemsWithValidCustomizations.length === 0;

    if (shouldDeleteOrder) {
      logger.info(
        `🗑️ Deletando pedido ${orderId} pois não tem customizações válidas`,
      );
      await this.deleteOrderAndCleanup(orderId);
    }

    return { cleanedCount, shouldDeleteOrder };
  }

  private checkCustomizationHasContent(value: string | any): boolean {
    try {
      let data: any;

      if (typeof value === "string") {
        if (!value || value.trim() === "") return false;
        try {
          data = JSON.parse(value);
        } catch {
          return false;
        }
      } else {
        data = value;
      }

      if (!data || typeof data !== "object") {
        return false;
      }

      // Check for actual content
      const hasTitle = data.title && String(data.title).trim().length > 0;
      const hasData =
        data.data &&
        Object.keys(data.data).length > 0 &&
        Object.values(data.data).some(
          (v) => v !== null && v !== undefined && v !== "",
        );

      const customizationValue =
        data.customizationData || data.data || data.value;

      const hasPreviewUrl =
        data.image?.preview_url ||
        data.previewUrl ||
        data.preview_url ||
        (Array.isArray(data.final_artworks) &&
          data.final_artworks.some((a: any) => a.preview_url));

      const hasPhotos =
        (Array.isArray(data.photos) && data.photos.length > 0) ||
        (Array.isArray(data.images) && data.images.length > 0);

      const hasText =
        (data.text && String(data.text).trim().length > 0) ||
        (data.texts && Array.isArray(data.texts) && data.texts.length > 0);

      return !!(hasTitle || hasData || hasPreviewUrl || hasPhotos || hasText);
    } catch (error) {
      logger.warn("Erro ao verificar conteúdo da customização:", error);
      return false;
    }
  }

  private async deleteOrderAndCleanup(orderId: string): Promise<void> {
    await prisma.order.delete({
      where: { id: orderId },
    });
  }
}

export default new CustomizationCleanupService();
