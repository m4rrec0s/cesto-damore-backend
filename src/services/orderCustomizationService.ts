import { CustomizationType } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../database/prisma";
import googleDriveService from "./googleDriveService";

interface SaveOrderCustomizationInput {
  orderItemId: string;
  customizationRuleId?: string | null;
  customizationType: CustomizationType;
  title: string;
  customizationData: Record<string, any>;
  selectedLayoutId?: string | null;
}

interface FinalizeResult {
  folderId?: string;
  folderUrl?: string;
  uploadedFiles: number;
}

interface ArtworkAsset {
  base64?: string;
  base64Data?: string;
  mimeType?: string;
  fileName?: string;
}

class OrderCustomizationService {
  async saveOrderItemCustomization(input: SaveOrderCustomizationInput) {
    const payload: any = {
      order_item_id: input.orderItemId,
      customization_rule_id: input.customizationRuleId ?? null,
      customization_type: input.customizationType,
      title: input.title,
      customization_data: JSON.stringify(input.customizationData ?? {}),
    };

    return prisma.orderItemCustomization.create({
      data: payload,
    });
  }

  async ensureOrderItem(orderId: string, orderItemId: string) {
    const orderItem = await prisma.orderItem.findFirst({
      where: {
        id: orderItemId,
        order_id: orderId,
      },
      include: {
        product: true,
      },
    });

    if (!orderItem) {
      throw new Error("Item do pedido não encontrado");
    }

    return orderItem;
  }

  async updateOrderItemCustomization(
    customizationId: string,
    input: Partial<SaveOrderCustomizationInput>
  ) {
    const existing = await prisma.orderItemCustomization.findUnique({
      where: { id: customizationId },
    });

    if (!existing) {
      throw new Error("Customização não encontrada");
    }

    const mergedData = {
      ...JSON.parse(existing.value || "{}"),
      ...(input.customizationData ?? {}),
    };

    const updateData: any = {
      customization_id: input.customizationRuleId ?? existing.customization_id,
      value: JSON.stringify(mergedData),
    };

    return prisma.orderItemCustomization.update({
      where: { id: customizationId },
      data: updateData,
    });
  }

  async finalizeOrderCustomizations(orderId: string): Promise<FinalizeResult> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            product: true,
            customizations: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    let folderId: string | null = null;
    let uploadedFiles = 0;

    const ensureFolder = async () => {
      if (folderId) return folderId;

      const safeCustomerName = (order.user?.name || "Cliente")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 40);

      const folderName = `Pedido_${safeCustomerName}_${
        new Date().toISOString().split("T")[0]
      }_${orderId.substring(0, 8)}`;

      folderId = await googleDriveService.createFolder(folderName);
      await googleDriveService.makeFolderPublic(folderId);
      return folderId;
    };

    for (const item of order.items) {
      for (const customization of item.customizations) {
        const data = this.parseCustomizationData(customization.value);
        const artworks = this.extractArtworkAssets(data);

        if (artworks.length === 0) {
          continue;
        }

        const targetFolder = await ensureFolder();
        const uploads = await Promise.all(
          artworks.map((asset) =>
            this.uploadArtwork(asset, { id: customization.id }, targetFolder)
          )
        );

        uploadedFiles += uploads.length;

        const sanitizedData = this.removeBase64FromData(data, uploads);

        await prisma.orderItemCustomization.update({
          where: { id: customization.id },
          data: {
            value: JSON.stringify(sanitizedData),
            google_drive_folder_id: targetFolder,
            google_drive_url: googleDriveService.getFolderUrl(targetFolder),
          },
        });
      }
    }

    if (!folderId) {
      return { uploadedFiles: 0 };
    }

    return {
      folderId,
      folderUrl: googleDriveService.getFolderUrl(folderId),
      uploadedFiles,
    };
  }

  async listOrderCustomizations(orderId: string) {
    return prisma.orderItem.findMany({
      where: { order_id: orderId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
          },
        },
        customizations: true,
      },
    });
  }

  private parseCustomizationData(raw: string | null): Record<string, any> {
    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch (error) {
      return {};
    }
  }

  private extractArtworkAssets(data: Record<string, any>): ArtworkAsset[] {
    const assets: ArtworkAsset[] = [];

    const single = data?.final_artwork;
    if (single) {
      assets.push(single as ArtworkAsset);
    }

    const multiple = Array.isArray(data?.final_artworks)
      ? data.final_artworks
      : [];

    multiple.forEach((asset: any) => assets.push(asset as ArtworkAsset));

    return assets.filter((asset) => Boolean(this.getBase64Content(asset)));
  }

  private async uploadArtwork(
    asset: ArtworkAsset,
    customization: { id: string },
    folderId: string
  ) {
    const base64Content = this.getBase64Content(asset);
    if (!base64Content) {
      throw new Error("Conteúdo base64 da arte final ausente");
    }

    const fileBuffer = Buffer.from(base64Content, "base64");
    const mimeType = asset.mimeType || "image/png";
    const extension = this.resolveExtension(mimeType);

    const fileName =
      asset.fileName ||
      `customization-${customization.id.slice(0, 8)}-${randomUUID().slice(
        0,
        8
      )}.${extension}`;

    const upload = await googleDriveService.uploadBuffer(
      fileBuffer,
      fileName,
      folderId,
      mimeType
    );

    return {
      ...upload,
      mimeType,
      fileName,
    };
  }

  private removeBase64FromData(
    data: Record<string, any>,
    uploads: Array<{
      id: string;
      webContentLink: string;
      fileName: string;
      mimeType: string;
    }>
  ) {
    const sanitized = { ...data };

    if (sanitized.final_artwork) {
      sanitized.final_artwork = {
        ...sanitized.final_artwork,
        base64: undefined,
        base64Data: undefined,
        mimeType: uploads[0]?.mimeType,
        fileName: uploads[0]?.fileName,
        google_drive_file_id: uploads[0]?.id,
        google_drive_url: uploads[0]?.webContentLink,
      };
    }

    if (Array.isArray(sanitized.final_artworks)) {
      sanitized.final_artworks = sanitized.final_artworks.map(
        (entry: any, index: number) => ({
          ...entry,
          base64: undefined,
          base64Data: undefined,
          mimeType: uploads[index]?.mimeType || entry?.mimeType,
          fileName: uploads[index]?.fileName || entry?.fileName,
          google_drive_file_id: uploads[index]?.id,
          google_drive_url: uploads[index]?.webContentLink,
        })
      );
    }

    return sanitized;
  }

  private getBase64Content(asset: ArtworkAsset): string | null {
    const raw = asset.base64 || asset.base64Data;
    if (!raw) {
      return null;
    }

    const prefixPattern = /^data:[^;]+;base64,/;
    return raw.replace(prefixPattern, "");
  }

  private resolveExtension(mimeType: string): string {
    const map: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "application/pdf": "pdf",
    };

    return map[mimeType] || "png";
  }

  private slugify(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[-\s]+/g, "-")
      .toLowerCase();
  }
}

export default new OrderCustomizationService();
