import { CustomizationType, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../database/prisma";
import googleDriveService from "./googleDriveService";
import logger from "../utils/logger";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import axios from "axios";
import tempFileService from "./tempFileService";
import { generateCartinhaBuffer } from "../utils/cartinhaGenerator";

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
  base64Detected?: boolean;
  base64AffectedIds?: string[];
}

interface ArtworkAsset {
  base64?: string;
  base64Data?: string;
  mimeType?: string;
  fileName?: string;
}

interface RequiredCustomizationDescriptor {
  id: string;
  name: string;
  type: string;
  componentId: string;
  itemName: string;
  productName: string;
  orderItemId: string;
}

interface CheckoutValidationIssue {
  orderItemId: string;
  productName: string;
  itemName?: string;
  componentId?: string;
  customizationId?: string;
  customizationName?: string;
  reason: string;
}

interface CheckoutValidationResult {
  valid: boolean;
  files: Record<string, boolean>;
  hasValidContent: boolean;
  missingRequired: CheckoutValidationIssue[];
  invalidCustomizations: CheckoutValidationIssue[];
  recommendations: string[];
}

class OrderCustomizationService {
  async saveOrderItemCustomization(input: SaveOrderCustomizationInput) {
    logger.info(`🔍 [SERVICE DEBUG] Recebendo save com orderItemId: ${input.orderItemId}`);
    
    const orderItem = await prisma.orderItem.findUnique({
      where: { id: input.orderItemId },
      select: { order_id: true },
    });
    
    if (!orderItem) {
      logger.error(`❌ [SERVICE DEBUG] OrderItem não encontrado: ${input.orderItemId}`);
      throw new Error("Item do pedido não encontrado");
    }
    
    logger.info(`✅ [SERVICE DEBUG] OrderItem encontrado para order: ${orderItem.order_id}`);

    const rawInputRuleId =
      input.customizationRuleId ||
      input.customizationData.customizationRuleId ||
      input.customizationData.customization_rule_id ||
      input.customizationData.customization_id ||
      input.customizationData.ruleId ||
      null;
    const normalizedInputRuleId = this.normalizeRuleId(rawInputRuleId);
    const ruleId = normalizedInputRuleId || "default";
    const componentIdRaw =
      input.customizationData.componentId ||
      input.customizationData.component_id ||
      null;
    const componentId =
      typeof componentIdRaw === "string" && componentIdRaw.trim().length > 0
        ? componentIdRaw
        : null;

    const allCustomizations = await prisma.orderItemCustomization.findMany({
      where: {
        order_item_id: input.orderItemId,
      },
    });

    const targetRuleId = this.normalizeRuleId(ruleId);
    const targetDedupKey = this.getCustomizationDedupKey({
      customizationId: targetRuleId,
      componentId,
      customizationType: input.customizationType,
      title: input.title,
      data: input.customizationData,
    });
    const mappedCustomizations = allCustomizations.map((c) => {
      const val = this.parseCustomizationData(c.value);
      const parsedComponentRaw = val.componentId || val.component_id || null;
      const parsedComponent =
        typeof parsedComponentRaw === "string" &&
        parsedComponentRaw.trim().length > 0
          ? parsedComponentRaw
          : null;
      const rawRuleId =
        c.customization_id ||
        val.customizationRuleId ||
        val.customization_id ||
        val.ruleId;

      return {
        record: c,
        data: val,
        componentId: parsedComponent,
        normalizedRuleId: this.normalizeRuleId(rawRuleId as string | undefined),
        customizationType:
          typeof val.customization_type === "string"
            ? String(val.customization_type).trim().toUpperCase()
            : "",
        title:
          typeof val.title === "string" ? val.title.trim().toLowerCase() : "",
        dedupKey: this.getCustomizationDedupKey({
          customizationId: c.customization_id,
          componentId: parsedComponent,
          customizationType:
            (val.customization_type as string) ||
            (val.customizationType as string) ||
            undefined,
          title: val.title,
          label:
            val.label_selected ||
            val.selected_item_label ||
            val.selected_option_label,
          data: val,
        }),
      };
    });

    let existing = mappedCustomizations.find(
      (c) => c.dedupKey === targetDedupKey,
    )?.record;

    const sameRuleCandidates = mappedCustomizations.filter(
      (c) => c.normalizedRuleId && c.normalizedRuleId === targetRuleId,
    );

    if (!existing) {
      existing = sameRuleCandidates.find(
        (c) => c.componentId === componentId,
      )?.record;
    }

    // Backward compatibility: older rows may not have componentId persisted.
    if (!existing && componentId) {
      existing = sameRuleCandidates.find((c) => !c.componentId)?.record;
    }

    if (!existing && !componentId && sameRuleCandidates.length === 1) {
      existing = sameRuleCandidates[0].record;
    }

    // Final fallback by title to avoid duplicated rows when rule id is missing/legacy.
    if (!existing) {
      const targetTitle =
        typeof input.title === "string" ? input.title.trim().toLowerCase() : "";

      existing = mappedCustomizations.find((c) => {
        if (!targetTitle || c.title !== targetTitle) return false;
        if (!componentId || !c.componentId) return true;
        return c.componentId === componentId;
      })?.record;
    }

    const customizationValue: any = {
      ...input.customizationData,
      customizationRuleId: ruleId,
      customization_id: ruleId,
      customization_type: input.customizationType,
      title: input.title,
      selected_layout_id: input.selectedLayoutId,
      componentId: componentId,
    };
    
    logger.info(`📦 [SERVICE DEBUG] Customization value antes de salvar:`, {
      hasFinalArtwork: !!customizationValue.final_artwork,
      finalArtworkPreview: customizationValue.final_artwork?.preview_url,
      hasImage: !!customizationValue.image,
      imagePreview: customizationValue.image?.preview_url,
      hasImages: !!customizationValue.images,
      imagesCount: customizationValue.images?.length,
      firstImagePreview: customizationValue.images?.[0]?.preview_url,
      hasText: !!customizationValue.text,
    });

    const oldTempFiles: string[] = [];
    if (existing) {
      try {
        const existingData = this.parseCustomizationData(existing.value);

        if (input.customizationType === "DYNAMIC_LAYOUT") {
          if (
            existingData.image?.preview_url &&
            existingData.image.preview_url.includes("/uploads/temp/") &&
            input.customizationData.image?.preview_url !==
              existingData.image.preview_url
          ) {
            const oldFilename = existingData.image.preview_url
              .split("/uploads/temp/")
              .pop();
            if (oldFilename) oldTempFiles.push(oldFilename);
          }

          if (existingData.images && Array.isArray(existingData.images)) {
            existingData.images.forEach((img: any) => {
              if (img.preview_url?.includes("/uploads/temp/")) {
                const oldFilename = img.preview_url
                  .split("/uploads/temp/")
                  .pop();
                if (oldFilename) {
                  const stillExists = input.customizationData.images?.some(
                    (newImg: any) => newImg.preview_url === img.preview_url,
                  );
                  if (!stillExists) {
                    oldTempFiles.push(oldFilename);
                  }
                }
              }
            });
          }
        }

        if (input.customizationType === "IMAGES" && existingData.photos) {
          const oldPhotos = Array.isArray(existingData.photos)
            ? existingData.photos
            : [];
          oldPhotos.forEach((photo: any) => {
            if (photo.preview_url?.includes("/uploads/temp/")) {
              const oldFilename = photo.preview_url
                .split("/uploads/temp/")
                .pop();
              if (oldFilename) {
                const stillExists = input.customizationData.photos?.some(
                  (newPhoto: any) => newPhoto.preview_url === photo.preview_url,
                );
                if (!stillExists) {
                  oldTempFiles.push(oldFilename);
                }
              }
            }
          });
        }
      } catch (err) {
        logger.warn("⚠️ Erro ao coletar arquivos antigos para deleção:", err);
      }
    }

    const computedLabel = await this.computeLabelSelected(
      input.customizationType,
      input.customizationData,
      input.customizationRuleId,
      input.selectedLayoutId,
    );

    if (computedLabel) {
      customizationValue.label_selected = computedLabel;
      if (input.customizationType === "MULTIPLE_CHOICE") {
        customizationValue.selected_option_label = computedLabel;
      }
      if (input.customizationType === "DYNAMIC_LAYOUT") {
        customizationValue.selected_item_label = computedLabel;
      }
    }

    const valueStr = JSON.stringify(customizationValue);

    const payload: any = {
      order_item_id: input.orderItemId,
      customization_id:
        normalizedInputRuleId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          normalizedInputRuleId,
        ) &&
        !componentId
          ? normalizedInputRuleId
          : null,
      value: valueStr,
    };

    let record;
    if (existing) {
      logger.info(
        `📝 [saveOrderItemCustomization] Atualizando customização existente ID: ${existing.id}`,
      );
      record = await prisma.orderItemCustomization.update({
        where: { id: existing.id },
        data: {
          value: valueStr,
          customization_id: payload.customization_id,
          updated_at: new Date(),
        },
      });
    } else {
      logger.info(
        `🆕 [saveOrderItemCustomization] Criando nova customização para regra: ${ruleId}`,
      );
      try {
        record = await prisma.orderItemCustomization.create({
          data: payload,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002" &&
          payload.customization_id
        ) {
          logger.warn(
            `⚠️ [saveOrderItemCustomization] Conflito de unicidade para order_item_id=${input.orderItemId} customization_id=${payload.customization_id}. Reutilizando registro existente.`,
          );

          const conflicted = await prisma.orderItemCustomization.findFirst({
            where: {
              order_item_id: input.orderItemId,
              customization_id: payload.customization_id,
            },
            orderBy: { updated_at: "desc" },
          });

          if (!conflicted) {
            throw error;
          }

          record = await prisma.orderItemCustomization.update({
            where: { id: conflicted.id },
            data: {
              value: valueStr,
              customization_id: payload.customization_id,
              updated_at: new Date(),
            },
          });
        } else {
          throw error;
        }
      }
    }

    if (oldTempFiles.length > 0) {
      try {
        const result = tempFileService.deleteFiles(oldTempFiles);
        logger.info(
          `🗑️ [saveOrderItemCustomization] ${result.deleted} arquivos temporários deletados, ${result.failed} falharam`,
        );
      } catch (err) {
        logger.warn("⚠️ Erro ao deletar arquivos antigos:", err);
      }
    }

    try {
      await this.cleanupDuplicateOrderItemCustomizations(
        input.orderItemId,
        record.id,
      );
    } catch (error) {
      logger.warn(
        "⚠️ Erro ao limpar customizações duplicadas após salvar:",
        error,
      );
    }

    if (orderItem?.order_id) {
      const deletedPendingPayments = await prisma.payment.deleteMany({
        where: {
          order_id: orderItem.order_id,
          status: {
            in: ["PENDING", "IN_PROCESS", "REJECTED", "CANCELLED"],
          },
        },
      });

      if (deletedPendingPayments.count > 0) {
        logger.info(
          `🧾 [saveOrderItemCustomization] Pagamentos pendentes invalidados: ${deletedPendingPayments.count}`,
        );
      }
    }

    return record;
  }

  private isCustomizationValid(type: string, data: any): boolean {
    if (!data) return false;

    const checkValidUrl = (url: string | undefined): boolean => {
      if (!url) return false;

      return !url.startsWith("blob:") && !url.startsWith("data:");
    };

    switch (type) {
      case "TEXT":
        return typeof data.text === "string" && data.text.trim().length > 0;

      case "MULTIPLE_CHOICE":
        const hasOption = !!(
          data.selected_option ||
          data.id ||
          data.selected_option_id
        );
        const hasLabel = !!(
          data.selected_option_label ||
          data.label_selected ||
          data.label
        );
        return hasOption || hasLabel;

      case "IMAGES":
        const photos = data.photos || data.files || [];
        if (!Array.isArray(photos) || photos.length === 0) return false;

        return photos.some((p: any) => {
          const url =
            p?.preview_url || p?.url || (typeof p === "string" ? p : null);
          return url && checkValidUrl(url);
        });

      case "DYNAMIC_LAYOUT":
        const artworkUrl =
          data.image?.preview_url ||
          data.previewUrl ||
          data.text ||
          data.final_artwork?.preview_url ||
          data.finalArtwork?.preview_url ||
          data.final_artworks?.[0]?.preview_url;

        const hasArtwork = !!artworkUrl && checkValidUrl(artworkUrl);
        const hasLayoutAsset =
          hasArtwork ||
          (Array.isArray(data.images) &&
            data.images.some((image: any) => {
              const url =
                image?.preview_url ||
                image?.url ||
                (typeof image === "string" ? image : null);
              return url && checkValidUrl(url);
            }));

        return !!hasLayoutAsset || !!data.fabricState;

      default:
        return data && Object.keys(data).length > 0;
    }
  }

  private getNormalizedCustomizationType(
    rawType: unknown,
    data?: Record<string, any>,
  ): string {
    const dataType =
      typeof data?.customization_type === "string"
        ? data.customization_type
        : typeof data?.customizationType === "string"
          ? data.customizationType
          : "";
    const type = String(rawType || dataType || "TEXT").trim().toUpperCase();
    return type;
  }

  async getOrderReviewData(orderId: string) {
    const orderItems = await prisma.orderItem.findMany({
      where: { order_id: orderId },
      include: {
        product: {
          include: {
            components: {
              include: {
                item: {
                  include: {
                    customizations: true,
                  },
                },
              },
            },
          },
        },
        customizations: true,
        additionals: {
          include: {
            additional: {
              include: {
                customizations: true,
              },
            },
          },
        },
      },
    });

    const result = await Promise.all(
      orderItems.map(async (item) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allAvailable: any[] = [];

      if (item.product.components) {
        for (const component of item.product.components) {
          const itemCustomizations = component.item.customizations || [];
          const mapped = itemCustomizations.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            isRequired: c.isRequired,
            itemId: component.item_id,
            itemName: component.item.name || "Item",
            componentId: component.id,
          }));
          allAvailable.push(...mapped);
        }
      }

      if (item.additionals) {
        for (const add of item.additionals) {
          const itemCustomizations = add.additional.customizations || [];
          const mapped = itemCustomizations.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            isRequired: c.isRequired,
            itemId: add.additional_id,
            itemName: add.additional.name || "Adicional",
            componentId: add.additional_id,
            isAdditional: true,
          }));
          allAvailable.push(...mapped);
        }
      }

      const sanitizedCustomizations =
        await this.sanitizePersistedCustomizationsForReview(
          item.id,
          item.customizations,
          allAvailable,
        );

      const latestCustomizations = await this.getLatestCustomizationsByIdentity(
        sanitizedCustomizations,
      );

      const filledCustomizations = (
        await Promise.all(
          latestCustomizations.map(async (c: any) => {
            const parsedValue = this.parseCustomizationData(c.value);
            const type = this.getNormalizedCustomizationType(
              c.customization_type,
              parsedValue,
            );
            const fileCheck = await this.validateCustomizationFiles(
              parsedValue,
              type,
            );
            const isValid = this.isCustomizationValid(type, parsedValue) && fileCheck.valid;
            const matchedAvailable = this.findMatchedAvailableCustomization(
              allAvailable,
              parsedValue,
              c.customization_id,
            );
            const ruleId =
              this.normalizeRuleId(c.customization_id) ||
              this.normalizeRuleId(parsedValue.customizationRuleId) ||
              this.normalizeRuleId(parsedValue.customization_id) ||
              this.normalizeRuleId(parsedValue.ruleId);
            const componentId =
              (parsedValue.componentId as string) ||
              (parsedValue.component_id as string) ||
              "";

            // Evita renderizar "lixo histórico" que não corresponde mais a nenhuma regra ativa.
            if (!matchedAvailable) {
              return null;
            }

            return {
              id: c.id,
              order_item_id: c.order_item_id,
              customization_id: ruleId || matchedAvailable.id,
              matched_customization_id: matchedAvailable.id,
              value: parsedValue,
              componentId: componentId || matchedAvailable.componentId,
              is_valid: isValid,
              invalid_reason: isValid ? undefined : fileCheck.reason || "Customização inválida",
            };
          }),
        )
      ).filter((c: any) => !!c);

        return {
          orderItemId: item.id,
          productId: item.product_id,
          productName: item.product.name,
          availableCustomizations: allAvailable,
          filledCustomizations: filledCustomizations,
        };
      }),
    );

    return result;
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
    input: Partial<SaveOrderCustomizationInput>,
  ) {
    const existing = await prisma.orderItemCustomization.findUnique({
      where: { id: customizationId },
    });

    if (!existing) {
      throw new Error("Customização não encontrada");
    }

    const existingData = this.parseCustomizationData(existing.value);

    const oldTempFiles: string[] = [];

    if (
      input.customizationData?.image?.preview_url &&
      existingData.image?.preview_url &&
      input.customizationData.image.preview_url !==
        existingData.image.preview_url
    ) {
      if (existingData.image.preview_url.includes("/uploads/temp/")) {
        const oldFilename = existingData.image.preview_url
          .split("/uploads/temp/")
          .pop();
        if (oldFilename) oldTempFiles.push(oldFilename);
        logger.debug(
          `🗑️ [updateOrderItemCustomization] Marcando canvas antigo para deleção: ${oldFilename}`,
        );
      }
    }

    const mergedCustomizationData = {
      ...existingData,
      ...(input.customizationData ?? {}),
    };

    if (input.title) {
      mergedCustomizationData.title = input.title;
    }
    if (input.customizationType) {
      mergedCustomizationData.customization_type = input.customizationType;
    }
    if (input.selectedLayoutId) {
      mergedCustomizationData.selected_layout_id = input.selectedLayoutId;
    }

    const updatedLabel = await this.computeLabelSelected(
      input.customizationType ?? mergedCustomizationData.customization_type,
      mergedCustomizationData,
      input.customizationRuleId ?? existing.customization_id,
      input.selectedLayoutId ?? mergedCustomizationData.selected_layout_id,
    );

    if (updatedLabel) {
      mergedCustomizationData.label_selected = updatedLabel;
      if (
        (input.customizationType ??
          mergedCustomizationData.customization_type) === "MULTIPLE_CHOICE"
      ) {
        mergedCustomizationData.selected_option_label = updatedLabel;
      }
      if (
        (input.customizationType ??
          mergedCustomizationData.customization_type) === "DYNAMIC_LAYOUT"
      ) {
        mergedCustomizationData.selected_item_label = updatedLabel;
      }
    } else {
      delete mergedCustomizationData.label_selected;
      delete mergedCustomizationData.selected_option_label;
      delete mergedCustomizationData.selected_item_label;
    }

    const updateData: any = {
      customization_id: input.customizationRuleId ?? existing.customization_id,
      value: JSON.stringify(mergedCustomizationData),
    };

    try {
      const containsBase64 = /data:[^;]+;base64,/.test(updateData.value);
      logger.debug(
        `🔍 [updateOrderItemCustomization] containsBase64=${containsBase64}, type=${
          input.customizationType
        }, ruleId=${input.customizationRuleId ?? existing.customization_id}`,
      );
    } catch (err) {}

    const result = await prisma.orderItemCustomization.update({
      where: { id: customizationId },
      data: updateData,
    });

    if (oldTempFiles.length > 0) {
      try {
        const deleteResult = tempFileService.deleteFiles(oldTempFiles);
        logger.debug(
          `🗑️ [updateOrderItemCustomization] ${deleteResult.deleted} arquivos antigos deletados, ${deleteResult.failed} falharam`,
        );
      } catch (error: any) {
        logger.warn(
          `⚠️ Erro ao deletar arquivos antigos na atualização: ${error.message}`,
        );
      }
    }

    return result;
  }

  private async backupTempFilesBeforeDelete(
    files: string[],
  ): Promise<{ success: number; failed: number }> {
    const baseStorageDir = path.join(process.cwd(), "storage");

    const tempDir = path.join(baseStorageDir, "temp");
    const backupDir = path.join(baseStorageDir, "backup");

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      logger.info(`📁 Diretório de backup criado: ${backupDir}`);
    }

    let success = 0;
    let failed = 0;

    for (const filename of files) {
      try {
        const sourcePath = path.join(tempDir, filename);

        if (!fs.existsSync(sourcePath)) {
          logger.warn(`⚠️ Arquivo não encontrado para backup: ${filename}`);
          failed++;
          continue;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupFilename = `${timestamp}_${filename}`;
        const backupPath = path.join(backupDir, backupFilename);

        fs.copyFileSync(sourcePath, backupPath);

        success++;
        logger.debug(`✅ Backup criado: ${backupFilename}`);
      } catch (error) {
        logger.error(`❌ Erro ao fazer backup de ${filename}:`, error);
        failed++;
      }
    }

    logger.info(
      `📦 Backup concluído: ${success} arquivos copiados, ${failed} falharam`,
    );

    return { success, failed };
  }

  private async deleteUploadedTempFiles(
    assets: Array<{ url: string; filename?: string }>,
  ): Promise<void> {
    try {
      const tempFilesToDelete: string[] = [];

      for (const asset of assets) {
        if (asset.url && asset.url.includes("/uploads/temp/")) {
          const filename = asset.url.split("/uploads/temp/").pop();
          if (filename && filename.length > 0) {
            tempFilesToDelete.push(filename);
          }
        }
      }

      if (tempFilesToDelete.length > 0) {
        logger.info(
          `🔄 [finalizeOrderCustomizations] Criando backup de ${tempFilesToDelete.length} arquivos antes de deletar...`,
        );
        await this.backupTempFilesBeforeDelete(tempFilesToDelete);

        logger.info(
          `🗑️ [finalizeOrderCustomizations] Deletando ${tempFilesToDelete.length} arquivos temporários...`,
        );
        const result = tempFileService.deleteFiles(tempFilesToDelete);
        logger.info(
          `✅ [finalizeOrderCustomizations] ${result.deleted} temp files deletados, ${result.failed} falharam`,
        );
      }
    } catch (error: any) {
      logger.warn(
        `⚠️ Erro ao deletar temp files após upload: ${error.message}`,
      );
    }
  }

  async finalizeOrderCustomizations(orderId: string): Promise<FinalizeResult> {
    logger.debug(
      `🧩 Iniciando finalizeOrderCustomizations para orderId=${orderId}`,
    );

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        google_drive_folder_id: true,
        google_drive_folder_url: true,
        customizations_drive_processed: true,
      },
    });

    if (
      existingOrder?.customizations_drive_processed &&
      existingOrder?.google_drive_folder_id
    ) {
      logger.info(
        `🟢 Customizações já foram processadas para ${orderId}, retornando dados existentes`,
      );
      return {
        folderId: existingOrder.google_drive_folder_id,
        folderUrl: existingOrder.google_drive_folder_url || undefined,
        uploadedFiles: 0,
        base64Detected: false,
        base64AffectedIds: [],
      };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            product: {
              include: {
                components: {
                  include: {
                    item: true,
                  },
                },
              },
            },
            customizations: true,
            additionals: {
              include: {
                additional: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    const hasAnyCustomizations = order.items.some(
      (item) => item.customizations.length > 0,
    );

    let mainFolderId: string | null = null;
    let uploadedFiles = 0;
    let base64Detected = false;
    const base64AffectedIds: string[] = [];
    const subfolderMap: Record<string, string> = {};

    const componentNameMap = new Map<string, string>();
    const additionalNameMap = new Map<string, string>();

    for (const item of order.items) {
      if (item.product?.components) {
        item.product.components.forEach((component) => {
          if (component?.id && component?.item?.name) {
            componentNameMap.set(component.id, component.item.name);
          }
        });
      }

      if (item.additionals) {
        item.additionals.forEach((add) => {
          if (add.additional_id && add.additional?.name) {
            additionalNameMap.set(add.additional_id, add.additional.name);
          }
        });
      }
    }

    const ensureMainFolder = async () => {
      if (mainFolderId) return mainFolderId;

      const safeCustomerName = (order.user?.name || "Cliente")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 40);

      const folderName = `Pedido_${safeCustomerName}_${
        new Date().toISOString().split("T")[0]
      }_${orderId.substring(0, 8)}`;

      mainFolderId = await googleDriveService.createFolder(folderName);
      await googleDriveService.makeFolderPublic(mainFolderId);
      logger.info(`📁 Pasta principal criada: ${mainFolderId}`);
      return mainFolderId;
    };

    const ensureSubfolder = async (folderName: string) => {
      if (subfolderMap[folderName]) {
        return subfolderMap[folderName];
      }

      const mainFolder = await ensureMainFolder();
      const subfolderId = await googleDriveService.createFolder(
        folderName,
        mainFolder,
      );
      await googleDriveService.makeFolderPublic(subfolderId);
      subfolderMap[folderName] = subfolderId;
      logger.info(`📁 Subpasta criada para ${folderName}: ${subfolderId}`);
      return subfolderId;
    };

    for (const item of order.items) {
      for (const customization of item.customizations) {
        logger.debug(
          `🔎 processando customization ${customization.id} do item ${item.id}`,
        );
        const data = this.parseCustomizationData(customization.value);
        const customizationType = data.customization_type || "DEFAULT";
        const componentId = data.componentId as string | undefined;

        const folderName = (() => {
          if (componentId && additionalNameMap.has(componentId)) {
            return `${additionalNameMap.get(componentId)} (adicional)`;
          }
          if (componentId && componentNameMap.has(componentId)) {
            return componentNameMap.get(componentId) as string;
          }
          return item.product?.name || customizationType || "Customizacoes";
        })();

        const artworkUrls = await this.extractArtworkAssets(data);

        if (artworkUrls.length === 0) {
          continue;
        }

        const targetFolder = await ensureSubfolder(folderName);

        const uploads = await Promise.all(
          artworkUrls.map((asset) =>
            this.uploadArtworkFromUrl(
              asset,
              { id: customization.id },
              targetFolder,
            ),
          ),
        );

        uploadedFiles += uploads.length;

        const sanitizedData = this.removeBase64FromData(data, uploads);

        try {
          const cType = sanitizedData.customization_type;
          if (
            !sanitizedData.label_selected ||
            sanitizedData.label_selected === ""
          ) {
            if (cType === "DYNAMIC_LAYOUT" || cType === "MULTIPLE_CHOICE") {
              const computed = await this.computeLabelSelected(
                cType,
                sanitizedData,
                customization.customization_id as any,
                sanitizedData.selected_layout_id,
              );
              if (computed) {
                sanitizedData.label_selected = computed;
                if (cType === "MULTIPLE_CHOICE") {
                  sanitizedData.selected_option_label = computed;
                }
                if (cType === "DYNAMIC_LAYOUT") {
                  sanitizedData.selected_item_label = computed;
                }
                logger.info(
                  `🧭 Recomputed label_selected for customization ${customization.id}: ${computed}`,
                );
              }
            }
          }
        } catch (err) {
          logger.warn(
            `⚠️ Falha ao recomputar label_selected para customization ${customization.id}:`,
            err,
          );
        }

        const removedFieldsCount =
          this.removeBase64FieldsRecursive(sanitizedData);
        if (removedFieldsCount > 0) {
          logger.info(
            `✅ Removidos ${removedFieldsCount} campo(s) base64 do payload antes de salvar`,
          );
        }

        await prisma.orderItemCustomization.update({
          where: { id: customization.id },
          data: {
            value: JSON.stringify(sanitizedData),
            google_drive_folder_id: targetFolder,
            google_drive_url: googleDriveService.getFolderUrl(targetFolder),
          },
        });

        try {
          const updated = await prisma.orderItemCustomization.findUnique({
            where: { id: customization.id },
            select: { value: true },
          });

          const updatedVal = updated ? String(updated.value) : "";
          const dataUriPattern = /data:[^;]+;base64,/i;
          if (updatedVal && dataUriPattern.test(updatedVal)) {
            logger.warn(
              "🚨 Detected data URI / base64 content in saved customization value after sanitization:",
              customization.id,
            );
            base64Detected = true;
            base64AffectedIds.push(customization.id);

            try {
              const parsed = JSON.parse(updatedVal);
              const removed = this.removeBase64FieldsRecursive(parsed);
              if (removed > 0) {
                logger.info(
                  `🔁 Re-sanitizing customization ${customization.id}, removed ${removed} lingering base64 fields`,
                );
                await prisma.orderItemCustomization.update({
                  where: { id: customization.id },
                  data: { value: JSON.stringify(parsed) },
                });

                const refetch = await prisma.orderItemCustomization.findUnique({
                  where: { id: customization.id },
                  select: { value: true },
                });
                const refVal = refetch ? String(refetch.value) : "";
                if (!dataUriPattern.test(refVal)) {
                  logger.info(
                    `✅ Re-sanitization successful for customization ${customization.id}`,
                  );

                  const idx = base64AffectedIds.indexOf(customization.id);
                  if (idx >= 0) base64AffectedIds.splice(idx, 1);
                }
              }
            } catch (err) {
              logger.warn(
                `⚠️ Falha ao re-sanitizar customization ${customization.id}:`,
                err,
              );
            }
          }
        } catch (verifyErr) {
          logger.error(
            "Erro ao verificar registro após sanitização:",
            verifyErr,
          );
        }
      }
    }

    if (!mainFolderId && hasAnyCustomizations) {
      await ensureMainFolder();
    }

    if (!mainFolderId) {
      return { uploadedFiles: 0 };
    }

    const folderUrl = googleDriveService.getFolderUrl(mainFolderId);

    try {
      const allAssets: Array<{ url: string; filename?: string }> = [];

      for (const item of order.items) {
        for (const customization of item.customizations) {
          const data = this.parseCustomizationData(customization.value);

          if (data?.photos && Array.isArray(data.photos)) {
            data.photos.forEach((p: any) => {
              if (p.preview_url) {
                allAssets.push({
                  url: p.preview_url,
                  filename: p.temp_file_id,
                });
              }
            });
          }
          if (data?.final_artwork?.preview_url) {
            allAssets.push({ url: data.final_artwork.preview_url });
          }
          if (data?.final_artworks && Array.isArray(data.final_artworks)) {
            data.final_artworks.forEach((a: any) => {
              if (a.preview_url) {
                allAssets.push({ url: a.preview_url });
              }
            });
          }
          if (data?.image?.preview_url) {
            allAssets.push({ url: data.image.preview_url });
          }
        }
      }

      if (allAssets.length > 0) {
        await this.deleteUploadedTempFiles(allAssets);
      }
    } catch (error: any) {
      logger.warn(`⚠️ Erro ao limpar temp files: ${error.message}`);
    }

    base64Detected = base64AffectedIds.length > 0;

    try {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          google_drive_folder_id: mainFolderId,
          google_drive_folder_url: folderUrl,
          customizations_drive_processed: true,
          customizations_drive_processed_at: new Date(),
        },
      });
      logger.info(`💾 Pedido ${orderId} atualizado com metadados do Drive`);
    } catch (saveError) {
      logger.error(
        `❌ Erro ao salvar metadados do Drive no pedido ${orderId}:`,
        saveError,
      );
    }

    // ── Cartinha .docx ──────────────────────────────────────────────
    if (mainFolderId) {
      try {
        const textMessages: string[] = [];
        for (const item of order.items) {
          for (const customization of item.customizations) {
            const data = this.parseCustomizationData(customization.value);
            if (data.customization_type === 'TEXT' && data.text) {
              const msg = typeof data.text === 'string' ? data.text.trim() : '';
              if (msg.length > 0) textMessages.push(msg);
            }
          }
        }

        if (textMessages.length > 0) {
          const combinedMessage = textMessages.join('\n\n---\n\n');
          const buffer = await generateCartinhaBuffer({ message: combinedMessage });
          const fileName = `Cartinha_${orderId.slice(0, 8)}.docx`;

          const cartinhaFolderId = await googleDriveService.createFolder(
            'Cartinha',
            mainFolderId,
          );

          const uploadedFile = await googleDriveService.uploadBuffer(
            buffer,
            fileName,
            cartinhaFolderId,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          );

          await googleDriveService.makeFolderPublic(cartinhaFolderId);

          uploadedFiles += 1;
          logger.info({ orderId: order.id, fileId: uploadedFile.id }, 'cartinha_docx_uploaded');
        }
      } catch (cartinhaErr: any) {
        logger.error({ err: cartinhaErr, orderId: order.id }, 'cartinha_docx_failed');
      }
    }

    const result = {
      folderId: mainFolderId,
      folderUrl,
      uploadedFiles,
      base64Detected,
      base64AffectedIds,
    };

    logger.info(
      `✅ finalizeOrderCustomizations concluído orderId=${orderId} uploads=${uploadedFiles} folderId=${mainFolderId}`,
    );

    return result;
  }

  async listOrderCustomizations(orderId: string) {
    const items = await prisma.orderItem.findMany({
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

    const sanitizedItems = items.map((item: any) => ({
      ...item,
      customizations: (item.customizations || []).map((c: any) => {
        try {
          const parsed = JSON.parse(c.value || "{}");
          this.removeBase64FieldsRecursive(parsed);
          return {
            ...c,
            value: JSON.stringify(parsed),
          };
        } catch (err) {
          logger.warn("Erro ao sanitizar customização ao listar:", c.id, err);
          return c;
        }
      }),
    }));

    return sanitizedItems;
  }

  private parseCustomizationData(raw: string | null): Record<string, any> {
    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch (error) {
      return {};
    }
  }

  private async computeLabelSelected(
    customizationType: CustomizationType,
    customizationData: Record<string, any> | undefined,
    customizationRuleId?: string | null,
    selectedLayoutId?: string | null,
  ): Promise<string | undefined> {
    if (!customizationData) return undefined;

    if (customizationType === "MULTIPLE_CHOICE") {
      const selectedOption =
        customizationData.selected_option ||
        (Array.isArray(customizationData.selected_options)
          ? customizationData.selected_options[0]
          : undefined);

      if (!selectedOption) return undefined;

      const options = customizationData.options || undefined;

      if (Array.isArray(options)) {
        const opt = options.find((o: any) => o.id === selectedOption);
        if (opt) return opt.label || opt.name || opt.title;
      }

      if (customizationRuleId) {
        try {
          const rule = await prisma.customization.findUnique({
            where: { id: customizationRuleId },
          });

          const ruleOptions = (rule?.customization_data as any)?.options || [];
          const match = (ruleOptions as any[]).find(
            (o: any) => o.id === selectedOption,
          );
          if (match) return match.label || match.name || match.title;
        } catch (error) {
          logger.warn(
            "computeLabelSelected: erro ao buscar customization rule",
            error,
          );
        }
      }

      return undefined;
    }

    if (customizationType === "DYNAMIC_LAYOUT") {
      const layoutId =
        selectedLayoutId ||
        customizationData.layout_id ||
        customizationData.DYNAMIC_LAYOUT_id ||
        this.findLayoutIdInObject(customizationData);
      if (!layoutId) return undefined;

      try {
        const layout = await prisma.dynamicLayout.findUnique({
          where: { id: layoutId },
        });
        if (layout) return layout.name;

        const layoutBase = await prisma.layoutBase.findUnique({
          where: { id: layoutId },
        });
        return layoutBase?.name || undefined;
      } catch (error) {
        logger.warn("computeLabelSelected: erro ao buscar layout", error);
        return undefined;
      }
    }

    return undefined;
  }

  private findLayoutIdInObject(obj: any): string | undefined {
    if (!obj || typeof obj !== "object") return undefined;
    const keys = [
      "selected_layout_id",
      "layout_id",
      "DYNAMIC_LAYOUT_id",
      "layoutId",
      "baseLayoutId",
    ];
    for (const k of keys) {
      if (obj[k]) return obj[k];
    }
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === "object" && value !== null) {
        const found = this.findLayoutIdInObject(value);
        if (found) return found;
      }
    }
    return undefined;
  }

  private async extractArtworkAssets(data: Record<string, any>): Promise<
    Array<{
      url: string;
      filename: string;
      mimeType: string;
    }>
  > {
    const assets: Array<{ url: string; filename: string; mimeType: string }> =
      [];

    if (data?.customization_type === "DYNAMIC_LAYOUT") {
      const bestUrl =
        data.highQualityUrl ||
        data.high_quality_url ||
        data.final_artwork?.preview_url ||
        data.finalArtwork?.preview_url ||
        data.final_artworks?.[0]?.preview_url ||
        data.image?.preview_url ||
        data.text;

      if (
        bestUrl &&
        typeof bestUrl === "string" &&
        !bestUrl.startsWith("data:") &&
        !bestUrl.startsWith("blob:")
      ) {
        assets.push({
          url: bestUrl,
          filename: `design-final-${Date.now()}.png`,
          mimeType: "image/png",
        });
      }
    }

    if (data?.customization_type === "IMAGES") {
      const photos = Array.isArray(data?.photos) ? data.photos : [];
      photos.forEach((photo: any, index: number) => {
        if (photo && typeof photo === "object") {
          const imageUrl =
            photo.preview_url || photo.base64 || photo.base64Data;

          if (
            imageUrl &&
            typeof imageUrl === "string" &&
            !imageUrl.startsWith("data:") &&
            !imageUrl.startsWith("blob:")
          ) {
            assets.push({
              url: imageUrl,
              filename:
                photo.original_name ||
                photo.fileName ||
                `photo-${index + 1}.jpg`,
              mimeType: photo.mime_type || photo.mimeType || "image/jpeg",
            });
          }
        }
      });
    }

    if (data?.customization_type !== "DYNAMIC_LAYOUT") {
      const images = Array.isArray(data?.images) ? data.images : [];
      images.forEach((image: any, index: number) => {
        if (image && typeof image === "object") {
          const imageUrl = image.url || image.base64 || image.base64Data;
          if (
            imageUrl &&
            typeof imageUrl === "string" &&
            !imageUrl.startsWith("data:") &&
            !imageUrl.startsWith("blob:")
          ) {
            assets.push({
              url: imageUrl,
              filename:
                image.fileName ||
                image.original_name ||
                `layout-slot-${image.slot || index}.jpg`,
              mimeType: image.mimeType || image.mime_type || "image/jpeg",
            });
          }
        }
      });
    }

    return assets;
  }

  private async uploadArtworkFromUrl(
    asset: { url: string; filename: string; mimeType: string },
    customization: { id: string },
    folderId: string,
  ) {
    try {
      const { url, filename, mimeType } = asset;

      logger.debug(
        `📤 uploadArtworkFromUrl: ${filename} (${url}) -> Drive folder ${folderId}`,
      );

      let fileBuffer: Buffer | null = null;

      const tempFileName = tempFileService.getTempFilenameFromUrl(url);

      if (tempFileName) {
        const filePath = tempFileService.getExistingFilePath(tempFileName);

        if (!filePath) {
          logger.error(
            `❌ Arquivo temporário não encontrado no diretório configurado: ${tempFileName}`,
          );
          throw new Error(`Temporary file not found: ${tempFileName}`);
        }

        fileBuffer = fs.readFileSync(filePath);
        logger.debug(
          `✅ Arquivo lido do temp: ${tempFileName} (${fileBuffer.length} bytes)`,
        );
      } else if (url.startsWith("http")) {
        logger.debug(`📥 Baixando arquivo de URL: ${url}`);
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
        });
        fileBuffer = Buffer.from(response.data);
        logger.debug(`✅ Arquivo baixado: ${fileBuffer.length} bytes`);
      } else if (url.startsWith("data:")) {
        logger.warn(
          `⚠️ Asset ainda contém base64 (devia ter sido migrado): ${filename}`,
        );

        const matches = url.match(/data:[^;]*;base64,(.*)/);
        if (!matches || !matches[1]) {
          throw new Error("Invalid base64 format");
        }
        fileBuffer = Buffer.from(matches[1], "base64");
      } else {
        throw new Error(`Unsupported URL format: ${url}`);
      }

      if (!fileBuffer) {
        throw new Error("Failed to load file buffer");
      }

      const extension = this.resolveExtension(mimeType);
      const fileName =
        filename ||
        `customization-${customization.id.slice(0, 8)}-${randomUUID().slice(
          0,
          8,
        )}.${extension}`;

      const upload = await googleDriveService.uploadBuffer(
        fileBuffer,
        fileName,
        folderId,
        mimeType,
      );

      logger.info(
        `✅ Arquivo enviado para Drive: ${fileName} (id=${upload.id}, size=${fileBuffer.length})`,
      );

      return {
        ...upload,
        mimeType,
        fileName,
      };
    } catch (error: any) {
      logger.error(
        `❌ Erro ao fazer upload de artwork: ${asset.filename}`,
        error,
      );
      throw error;
    }
  }

  private async uploadArtwork(
    asset: ArtworkAsset,
    customization: { id: string },
    folderId: string,
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
        8,
      )}.${extension}`;

    const upload = await googleDriveService.uploadBuffer(
      fileBuffer,
      fileName,
      folderId,
      mimeType,
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
    }>,
  ) {
    const sanitized = { ...data };

    if (sanitized.finalArtwork && !sanitized.final_artwork) {
      sanitized.final_artwork = sanitized.finalArtwork;
      delete sanitized.finalArtwork;
    }

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
      if (uploads[0]) {
        logger.info(
          `✅ final_artwork sanitized and uploaded: ${uploads[0]?.fileName} (driveId=${uploads[0]?.id})`,
        );
      } else {
        logger.warn(`⚠️ final_artwork sanitized but no upload info found`);
      }
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
        }),
      );
      sanitized.final_artworks.forEach((entry: any, index: number) => {
        const up = uploads[index];
        if (up) {
          logger.info(
            `✅ final_artworks[${index}] sanitized and uploaded: ${up.fileName} (driveId=${up.id})`,
          );
        } else {
          logger.warn(
            `⚠️ final_artworks[${index}] sanitized but no upload info found`,
          );
        }
      });
    }

    let uploadIndex = 0;
    if (sanitized.final_artwork) {
      uploadIndex += 1;
    }
    if (Array.isArray(sanitized.final_artworks)) {
      uploadIndex += sanitized.final_artworks.length;
    }

    if (Array.isArray(sanitized.photos)) {
      const isImagesType = sanitized.customization_type === "IMAGES";

      sanitized.photos = sanitized.photos.map((photo: any, idx: number) => {
        const upload = isImagesType ? uploads[uploadIndex + idx] : undefined;

        const newPhoto = {
          ...photo,
          base64: undefined,
          base64Data: undefined,
          mimeType: upload?.mimeType || photo?.mimeType,
          fileName: upload?.fileName || photo?.fileName || photo?.original_name,
          google_drive_file_id: upload?.id,
          google_drive_url: upload?.webContentLink,
        };

        if (upload) {
          logger.info(
            `✅ Photo sanitized and uploaded: ${newPhoto.fileName} (driveId=${upload.id})`,
          );
        } else if (isImagesType) {
          logger.warn(
            `⚠️ Photo sanitized but no upload info found for index ${idx}`,
          );
        }

        return newPhoto;
      });

      if (isImagesType) {
        uploadIndex += sanitized.photos.length;
      }
    }

    if (Array.isArray(sanitized.images)) {
      const isDynamic = sanitized.customization_type === "DYNAMIC_LAYOUT";

      sanitized.images = sanitized.images.map((image: any, idx: number) => {
        const upload = !isDynamic ? uploads[uploadIndex + idx] : undefined;

        const newImage = {
          ...image,
          url: undefined,
          base64: undefined,
          base64Data: undefined,
          mimeType: upload?.mimeType || image?.mimeType,
          fileName: upload?.fileName || image?.fileName,
          google_drive_file_id: upload?.id,
          google_drive_url: upload?.webContentLink,
        };

        if (upload) {
          logger.info(
            `✅ LAYOUT_BASE image[${idx}] (slot: ${
              image.slot || "unknown"
            }) sanitized and uploaded: ${upload.fileName} (driveId=${
              upload.id
            })`,
          );
        } else if (!isDynamic) {
          logger.warn(
            `⚠️ LAYOUT_BASE image[${idx}] sanitized but no upload info found`,
          );
        }

        return newImage;
      });

      if (!isDynamic) {
        uploadIndex += sanitized.images.length;
      }
    }

    if (
      sanitized.text &&
      typeof sanitized.text === "string" &&
      sanitized.text.startsWith("data:image")
    ) {
      logger.info("✅ Removendo base64 do campo 'text'");
      delete sanitized.text;
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

  private removeBase64FieldsRecursive(obj: any): number {
    if (!obj || typeof obj !== "object") return 0;
    let removedCount = 0;

    if (Array.isArray(obj)) {
      obj.forEach(
        (item) => (removedCount += this.removeBase64FieldsRecursive(item) || 0),
      );
      return removedCount;
    }

    for (const key of Object.keys(obj)) {
      if (key === "base64" || key === "base64Data") {
        delete obj[key];
        removedCount++;
        continue;
      }

      const value = obj[key];

      if (typeof value === "string" && value.startsWith("data:image")) {
        delete obj[key];
        removedCount++;
        continue;
      }

      if (typeof value === "object" && value !== null) {
        removedCount += this.removeBase64FieldsRecursive(value) || 0;
      }
    }
    return removedCount;
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

  async validateOrderCustomizationsFiles(orderId: string): Promise<{
    files: Record<string, boolean>;
    hasValidContent: boolean;
    recommendations?: string[];
    valid?: boolean;
    missingRequired?: CheckoutValidationIssue[];
    invalidCustomizations?: CheckoutValidationIssue[];
  }> {
    const result = await this.validateOrderForCheckout(orderId);
    return {
      files: result.files,
      hasValidContent: result.hasValidContent,
      recommendations:
        result.recommendations.length > 0 ? result.recommendations : undefined,
      valid: result.valid,
      missingRequired: result.missingRequired,
      invalidCustomizations: result.invalidCustomizations,
    };
  }

  async validateOrderForCheckout(
    orderId: string,
  ): Promise<CheckoutValidationResult> {
    const orderItems = await prisma.orderItem.findMany({
      where: { order_id: orderId },
      include: {
        product: {
          include: {
            components: {
              include: {
                item: {
                  include: {
                    customizations: true,
                  },
                },
              },
            },
          },
        },
        additionals: {
          include: {
            additional: {
              include: {
                customizations: true,
              },
            },
          },
        },
        customizations: true,
      },
    });

    const files: Record<string, boolean> = {};
    const missingRequired: CheckoutValidationIssue[] = [];
    const invalidCustomizations: CheckoutValidationIssue[] = [];
    const recommendations: string[] = [];
    let hasValidContent = false;

    for (const item of orderItems) {
      const requiredRules = this.getRequiredCustomizationDescriptors(item);
      const availableForSanitization = requiredRules.map((required) => ({
        id: required.id,
        name: required.name,
        componentId: required.componentId,
      }));
      const sanitizedCustomizations =
        await this.sanitizePersistedCustomizationsForReview(
          item.id,
          item.customizations,
          availableForSanitization,
        );
      const latestCustomizations = await this.getLatestCustomizationsByIdentity(
        sanitizedCustomizations,
      );
      const parsedCustomizations = await Promise.all(
        latestCustomizations.map(async (custom) => {
          const parsed = this.parseCustomizationData(custom.value);
          const customType = String(
            parsed.customization_type || parsed.customizationType || "TEXT",
          );
          const hasMeaningful = this.hasMeaningfulCustomizationData(parsed);
          const dataValid = this.isCustomizationValid(customType, parsed);
          const fileCheck = await this.validateCustomizationFiles(parsed);
          const isValid = dataValid && fileCheck.valid;
          files[custom.id] = isValid;

          if (isValid && hasMeaningful) {
            hasValidContent = true;
          }

          if (!isValid && hasMeaningful) {
            invalidCustomizations.push({
              orderItemId: item.id,
              productName: item.product?.name || "Produto",
              componentId: (parsed.componentId as string) || undefined,
              customizationId: custom.id,
              customizationName: String(
                parsed.title || parsed._customizationName || "Personalização",
              ),
              reason: fileCheck.reason || "Customização inválida ou incompleta",
            });
          }

          return {
            id: custom.id,
            dbCustomizationId: custom.customization_id || undefined,
            componentId: (parsed.componentId as string) || undefined,
            title: String(parsed.title || parsed._customizationName || ""),
            label: String(
              parsed.label_selected ||
                parsed.selected_item_label ||
                parsed.selected_option_label ||
                "",
            ),
            data: parsed,
            dataValid,
            fileValid: fileCheck.valid,
          };
        }),
      );

      for (const required of requiredRules) {
        const found = parsedCustomizations.find((filled) =>
          this.matchesRequiredCustomization(required, filled),
        );

        const isFoundAndValid = !!found && found.dataValid && found.fileValid;

        if (!isFoundAndValid) {
          missingRequired.push({
            orderItemId: required.orderItemId,
            productName: required.productName,
            itemName: required.itemName,
            componentId: required.componentId,
            customizationName: required.name,
            reason: `Customização obrigatória pendente: ${required.name}`,
          });
        }
      }
    }

    missingRequired.forEach((issue) => recommendations.push(issue.reason));
    invalidCustomizations.forEach((issue) =>
      recommendations.push(
        `Customização inválida "${issue.customizationName || "sem título"}": ${
          issue.reason
        }`,
      ),
    );

    const valid =
      missingRequired.length === 0 && invalidCustomizations.length === 0;
    return {
      valid,
      files,
      hasValidContent,
      missingRequired,
      invalidCustomizations,
      recommendations,
    };
  }

  private getRequiredCustomizationDescriptors(
    item: any,
  ): RequiredCustomizationDescriptor[] {
    const required: RequiredCustomizationDescriptor[] = [];

    if (item.product?.components) {
      for (const component of item.product.components) {
        const rules = component.item?.customizations || [];
        for (const rule of rules) {
          if (!rule.isRequired) continue;
          required.push({
            id: rule.id,
            name: rule.name,
            type: rule.type,
            componentId: component.id || component.item_id,
            itemName: component.item?.name || "Item",
            productName: item.product?.name || "Produto",
            orderItemId: item.id,
          });
        }
      }
    }

    if (item.additionals) {
      for (const add of item.additionals) {
        const rules = add.additional?.customizations || [];
        for (const rule of rules) {
          if (!rule.isRequired) continue;
          required.push({
            id: rule.id,
            name: rule.name,
            type: rule.type,
            componentId: add.additional_id,
            itemName: `${add.additional?.name || "Adicional"} (adicional)`,
            productName: item.product?.name || "Produto",
            orderItemId: item.id,
          });
        }
      }
    }

    return required;
  }

  private normalizeRuleId(raw?: string | null): string {
    if (!raw) return "";
    return String(raw).split(":")[0];
  }

  private getCustomizationDedupKey(input: {
    customizationId?: string | null;
    componentId?: string | null;
    customizationType?: string | null;
    title?: string | null;
    label?: string | null;
    data?: Record<string, any>;
  }): string {
    const data = input.data || {};
    const rawRuleId =
      input.customizationId ||
      data.customizationRuleId ||
      data.customization_rule_id ||
      data.customization_id ||
      data.ruleId ||
      "";
    const normalizedRuleId = this.normalizeRuleId(rawRuleId);
    const normalizedTitle = String(
      input.title || input.label || data.title || data._customizationName || "",
    )
      .trim()
      .toLowerCase();
    const componentId = String(
      input.componentId || data.componentId || data.component_id || "default",
    );
    const type = this.getNormalizedCustomizationType(
      input.customizationType || data.customization_type || data.customizationType,
      data,
    );

    return `${type}:${normalizedRuleId || normalizedTitle || "default"}:${componentId}`;
  }

  private async cleanupDuplicateOrderItemCustomizations(
    orderItemId: string,
    keepCustomizationId: string,
  ): Promise<void> {
    const customizations = await prisma.orderItemCustomization.findMany({
      where: { order_item_id: orderItemId },
      orderBy: [
        { updated_at: "desc" },
        { created_at: "desc" },
        { id: "desc" },
      ],
    });

    const byKey = new Map<string, string[]>();

    for (const customization of customizations) {
      const parsed = this.parseCustomizationData(customization.value);
      const key = this.getCustomizationDedupKey({
        customizationId: customization.customization_id,
        componentId: (parsed.componentId as string) || (parsed.component_id as string) || undefined,
        customizationType:
          (parsed.customization_type as string) ||
          (parsed.customizationType as string) ||
          undefined,
        title: parsed.title,
        label:
          parsed.label_selected ||
          parsed.selected_item_label ||
          parsed.selected_option_label,
        data: parsed,
      });

      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key)!.push(customization.id);
    }

    const idsToDelete = new Set<string>();
    for (const ids of byKey.values()) {
      if (ids.length <= 1) continue;
      const survivor = ids.includes(keepCustomizationId)
        ? keepCustomizationId
        : ids[0];
      for (const id of ids) {
        if (id !== survivor) {
          idsToDelete.add(id);
        }
      }
    }

    if (idsToDelete.size === 0) return;

    await prisma.orderItemCustomization.deleteMany({
      where: { id: { in: [...idsToDelete] } },
    });
  }

  private findMatchedAvailableCustomization(
    allAvailable: any[],
    parsedValue: Record<string, any>,
    dbCustomizationId?: string | null,
  ) {
    const ruleId =
      this.normalizeRuleId(dbCustomizationId) ||
      this.normalizeRuleId(parsedValue.customizationRuleId) ||
      this.normalizeRuleId(parsedValue.customization_id) ||
      this.normalizeRuleId(parsedValue.ruleId);
    const componentId =
      (parsedValue.componentId as string) ||
      (parsedValue.component_id as string) ||
      "";
    const normalizedTitle = String(
      parsedValue.title ||
        parsedValue.label_selected ||
        parsedValue.selected_item_label ||
        parsedValue.selected_option_label ||
        "",
    )
      .trim()
      .toLowerCase();

    return allAvailable.find((available) => {
      const availableId = this.normalizeRuleId(available.id);
      const availableName = String(available.name || "")
        .trim()
        .toLowerCase();
      const availableComponentId = String(
        available.componentId || available.itemId || "",
      );
      const componentMatches =
        !availableComponentId ||
        !componentId ||
        availableComponentId === componentId;
      if (!componentMatches) return false;
      if (ruleId && availableId && availableId === ruleId) return true;
      return !!normalizedTitle && normalizedTitle === availableName;
    });
  }

  private async sanitizePersistedCustomizationsForReview(
    orderItemId: string,
    customizations: any[],
    allAvailable: any[],
  ) {
    if (!Array.isArray(customizations) || customizations.length === 0) {
      return [];
    }

    const latestCustomizations =
      await this.getLatestCustomizationsByIdentity(customizations);
    const latestIds = new Set(latestCustomizations.map((c) => c.id));
    const idsToDelete = new Set<string>();
    const sanitizedCustomizations: any[] = [];

    for (const customization of customizations) {
      if (!latestIds.has(customization.id)) {
        idsToDelete.add(customization.id);
      }
    }

    for (const customization of latestCustomizations) {
      if (allAvailable.length === 0) {
        sanitizedCustomizations.push(customization);
        continue;
      }

      const parsedValue = this.parseCustomizationData(customization.value);
      const matchedAvailable = this.findMatchedAvailableCustomization(
        allAvailable,
        parsedValue,
        customization.customization_id,
      );

      if (!matchedAvailable) {
        idsToDelete.add(customization.id);
        continue;
      }

      sanitizedCustomizations.push(customization);
    }

    if (idsToDelete.size > 0) {
      await prisma.orderItemCustomization.deleteMany({
        where: {
          order_item_id: orderItemId,
          id: { in: [...idsToDelete] },
        },
      });

      logger.info(
        `🧹 [getOrderReviewData] Sanitizadas ${idsToDelete.size} customizações inválidas/duplicadas do item ${orderItemId}`,
      );
    }

    return sanitizedCustomizations;
  }

  private async getLatestCustomizationsByIdentity(customizations: any[]) {
    if (!Array.isArray(customizations) || customizations.length === 0) {
      return [];
    }

    const latestByKey = new Map<string, any>();

    for (const customization of customizations) {
      const parsed = this.parseCustomizationData(customization.value);
      const key = this.getCustomizationDedupKey({
        customizationId: customization.customization_id,
        componentId: (parsed.componentId as string) || (parsed.component_id as string) || undefined,
        customizationType:
          (parsed.customization_type as string) ||
          (parsed.customizationType as string) ||
          undefined,
        title: parsed.title,
        label:
          parsed.label_selected ||
          parsed.selected_item_label ||
          parsed.selected_option_label,
        data: parsed,
      });

      const current = latestByKey.get(key);
      if (!current) {
        latestByKey.set(key, customization);
        continue;
      }

      const currentUpdatedAt = new Date(current.updated_at || 0).getTime();
      const nextUpdatedAt = new Date(customization.updated_at || 0).getTime();

      if (nextUpdatedAt >= currentUpdatedAt) {
        latestByKey.set(key, customization);
      }
    }

    return [...latestByKey.values()];
  }

  private matchesRequiredCustomization(
    required: RequiredCustomizationDescriptor,
    filled: {
      dbCustomizationId?: string;
      componentId?: string;
      title: string;
      label: string;
      data: Record<string, any>;
    },
  ): boolean {
    const requiredId = this.normalizeRuleId(required.id);
    const data = filled.data || {};
    const rawRuleId =
      filled.dbCustomizationId ||
      data.customizationRuleId ||
      data.customization_id ||
      data.ruleId;
    const filledRuleId = this.normalizeRuleId(rawRuleId as string | undefined);

    const componentMatches =
      !required.componentId ||
      !filled.componentId ||
      required.componentId === filled.componentId;

    const byId = !!filledRuleId && filledRuleId === requiredId;
    const byName =
      filled.title.toLowerCase() === required.name.toLowerCase() ||
      filled.label.toLowerCase() === required.name.toLowerCase();

    if (!componentMatches) return false;
    if (byId) return true;
    if (filledRuleId) return false;
    return byName;
  }

  private hasMeaningfulCustomizationData(data: Record<string, any>): boolean {
    if (!data || typeof data !== "object") return false;

    const hasText =
      typeof data.text === "string" && data.text.trim().length > 0;
    const hasPhotos = Array.isArray(data.photos) && data.photos.length > 0;
    const hasImages = Array.isArray(data.images) && data.images.length > 0;
    const hasSelection =
      !!data.selected_option ||
      !!data.selected_item_label ||
      !!data.selected_option_label ||
      !!data.label_selected;
    const hasPreview =
      !!data.image?.preview_url ||
      !!data.final_artwork?.preview_url ||
      !!data.finalArtwork?.preview_url ||
      !!data.previewUrl;

    return hasText || hasPhotos || hasImages || hasSelection || hasPreview;
  }

  private collectCandidateUrls(data: Record<string, any>): string[] {
    const urls = new Set<string>();

    const walk = (obj: any) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }
      if (typeof obj !== "object") return;

      if (typeof obj.preview_url === "string") urls.add(obj.preview_url);
      if (typeof obj.url === "string") urls.add(obj.url);
      if (typeof obj.google_drive_url === "string") {
        urls.add(obj.google_drive_url);
      }
      if (typeof obj.webContentLink === "string") {
        urls.add(obj.webContentLink);
      }
      if (typeof obj.webViewLink === "string") {
        urls.add(obj.webViewLink);
      }
      if (typeof obj.text === "string") {
        const textValue = obj.text.trim();
        if (
          textValue.startsWith("/uploads/") ||
          textValue.startsWith("http://") ||
          textValue.startsWith("https://") ||
          textValue.startsWith("data:")
        ) {
          urls.add(textValue);
        }
      }

      Object.values(obj).forEach(walk);
    };

    walk(data);
    return Array.from(urls);
  }

  private collectActiveUrlsByType(
    data: Record<string, any>,
    customizationType: string,
  ): string[] {
    const urls = new Set<string>();
    const add = (value?: string | null) => {
      if (typeof value === "string" && value.trim().length > 0) {
        urls.add(value.trim());
      }
    };

    if (customizationType === "IMAGES") {
      if (Array.isArray(data.photos)) {
        data.photos.forEach((photo: any) => {
          if (typeof photo === "string") {
            add(photo);
            return;
          }
          add(photo?.preview_url);
          add(photo?.url);
        });
      }
      if (Array.isArray(data.previews)) {
        data.previews.forEach((preview: any) => {
          if (typeof preview === "string") add(preview);
        });
      }
      if (Array.isArray(data.images)) {
        data.images.forEach((image: any) => {
          if (typeof image === "string") {
            add(image);
            return;
          }
          add(image?.preview_url);
          add(image?.url);
          add(image?.source);
        });
      }
      return Array.from(urls);
    }

    if (customizationType === "DYNAMIC_LAYOUT") {
      add(data.final_artwork?.preview_url);
      add(data.finalArtwork?.preview_url);
      add(data.final_artwork?.url);
      add(data.finalArtwork?.url);
      add(data.image?.preview_url);
      add(data.image?.url);
      add(data.previewUrl);
      if (typeof data.text === "string") {
        const textValue = data.text.trim();
        if (
          textValue.startsWith("/uploads/") ||
          textValue.startsWith("http://") ||
          textValue.startsWith("https://") ||
          textValue.startsWith("blob:") ||
          textValue.startsWith("data:")
        ) {
          add(textValue);
        }
      }
      if (Array.isArray(data.final_artworks)) {
        data.final_artworks.forEach((artwork: any) => {
          add(artwork?.preview_url);
          add(artwork?.url);
        });
      }
      if (Array.isArray(data.images)) {
        data.images.forEach((image: any) => {
          add(image?.preview_url);
          add(image?.url);
          add(image?.source);
        });
      }
      return Array.from(urls);
    }

    return this.collectCandidateUrls(data);
  }

  private async validateCustomizationFiles(
    data: Record<string, any>,
    rawCustomizationType?: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const customizationType = this.getNormalizedCustomizationType(
      rawCustomizationType,
      data,
    );

    if (customizationType === "MULTIPLE_CHOICE" || customizationType === "TEXT") {
      return { valid: true };
    }

    const urls = this.collectActiveUrlsByType(data, customizationType);

    if (
      (customizationType === "IMAGES" || customizationType === "DYNAMIC_LAYOUT") &&
      urls.length === 0
    ) {
      return {
        valid: false,
        reason: "Arquivo de imagem ausente ou não persistido no pedido",
      };
    }

    let hasValidUrl = false;
    let firstInvalidReason: string | undefined;

    for (const rawUrl of urls) {
      if (!rawUrl || rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) {
        firstInvalidReason = firstInvalidReason || "Arquivo ainda está local (blob/base64)";
        continue;
      }

      const exists = await this.checkUrlExistsOnStorage(rawUrl);
      if (exists) {
        hasValidUrl = true;
        continue;
      }

      firstInvalidReason =
        firstInvalidReason || `Arquivo não encontrado no armazenamento: ${rawUrl}`;
    }

    if (hasValidUrl) {
      return { valid: true };
    }

    if (
      customizationType === "IMAGES" ||
      customizationType === "DYNAMIC_LAYOUT"
    ) {
      return {
        valid: false,
        reason: firstInvalidReason || "Arquivo de imagem ausente ou não persistido no pedido",
      };
    }

    return { valid: true };
  }

  private async checkUrlExistsOnStorage(url: string): Promise<boolean> {
    const normalizedPath = url.replace(/^https?:\/\/[^\/]+/, "");

    if (normalizedPath.includes("/uploads/temp/")) {
      const filename = normalizedPath.split("/uploads/temp/").pop();
      if (!filename) return false;

      const uploadRecord = await prisma.tempUpload.findFirst({
        where: {
          filename,
          deletedAt: null,
        },
        orderBy: { uploadedAt: "desc" },
      });

      if (uploadRecord) {
        const isExpired = uploadRecord.expiresAt < new Date();
        if (!isExpired && fs.existsSync(uploadRecord.filePath)) {
          return true;
        }
      }

      const candidates = [
        path.join(process.cwd(), "uploads", "temp", filename),
        path.join(process.cwd(), "storage", "temp", filename),
        path.join(
          path.resolve(
            process.env.TEMP_UPLOADS_DIR ||
              path.join(process.cwd(), "storage", "temp"),
          ),
          filename,
        ),
      ];
      return candidates.some((candidate) => fs.existsSync(candidate));
    }

    if (normalizedPath.includes("/images/customizations/")) {
      const parts = normalizedPath.split("/images/customizations/");
      const relativePath = parts[1];
      if (!relativePath) return false;
      const safeRelative = decodeURIComponent(relativePath);
      const fullPath = path.join(
        process.cwd(),
        "images",
        "customizations",
        safeRelative,
      );
      return fs.existsSync(fullPath);
    }

    try {
      const headResponse = await axios.head(url, {
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (headResponse.status >= 200 && headResponse.status < 400) {
        return true;
      }
    } catch (headError) {
      try {
        const getResponse = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 5000,
          validateStatus: (status) => status >= 200 && status < 400,
        });

        return getResponse.status >= 200 && getResponse.status < 400;
      } catch (getError) {
        logger.debug(`🔎 URL inacessível durante validação: ${url}`, {
          headError: headError instanceof Error ? headError.message : headError,
          getError: getError instanceof Error ? getError.message : getError,
        });
      }
    }

    return false;
  }
}

export default new OrderCustomizationService();
