import { CustomizationType } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../database/prisma";
import googleDriveService from "./googleDriveService";
import logger from "../utils/logger";
import fs from "fs";
import path from "path";
import axios from "axios";
import tempFileService from "./tempFileService";

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
  base64Detected?: boolean; // If any lingering base64/data URIs detected after sanitization
  base64AffectedIds?: string[]; // List of customization ids that still had base64 after sanitization
}

interface ArtworkAsset {
  base64?: string;
  base64Data?: string;
  mimeType?: string;
  fileName?: string;
}

class OrderCustomizationService {
  async saveOrderItemCustomization(input: SaveOrderCustomizationInput) {
    const ruleId = input.customizationRuleId || "default";
    const componentId = input.customizationData.componentId || null;

    const allCustomizations = await prisma.orderItemCustomization.findMany({
      where: {
        order_item_id: input.orderItemId,
      },
    });

    const existing = allCustomizations.find((c) => {
      try {
        const val = this.parseCustomizationData(c.value);

        // Matching robusto para evitar duplicidades
        const dbRuleId = c.customization_id;
        const jsonRuleId =
          val.customizationRuleId || val.customization_id || val.ruleId;
        const currentComponentId = val.componentId || null;

        const matchesRule =
          ruleId === dbRuleId ||
          ruleId === jsonRuleId ||
          (dbRuleId && ruleId.startsWith(dbRuleId)) || // Para casos de ID:Componente
          (jsonRuleId && ruleId.startsWith(jsonRuleId));

        const matchesComponent = currentComponentId === componentId;

        return matchesRule && matchesComponent;
      } catch {
        return false;
      }
    });

    const customizationValue: any = {
      ...input.customizationData,
      customizationRuleId: ruleId,
      customization_type: input.customizationType,
      title: input.title,
      selected_layout_id: input.selectedLayoutId,
      componentId: componentId, // Garantir que está no JSON
    };

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
        ruleId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          ruleId,
        ) &&
        !componentId
          ? ruleId
          : null,
      value: valueStr,
    };

    let record;
    if (existing) {
      // ✅ ATUALIZAR BY ID para evitar duplicatas
      logger.info(
        `📝 [saveOrderItemCustomization] Atualizando customização existente ID: ${existing.id}`,
      );
      record = await prisma.orderItemCustomization.update({
        where: { id: existing.id },
        data: {
          value: valueStr,
          customization_id: payload.customization_id, // Atualizar FK se necessário
          updated_at: new Date(),
        },
      });
    } else {
      // ✅ CRIAR se não existe
      logger.info(
        `🆕 [saveOrderItemCustomization] Criando nova customização para regra: ${ruleId}`,
      );
      record = await prisma.orderItemCustomization.create({
        data: payload,
      });
    }

    // ✅ DELETAR arquivos antigos
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

    return record;
  }

  /**
   * Helper para verificar se a customização está realmente preenchida de forma válida.
   * Regras simplificadas (alinhadas com frontend):
   * - TEXT: valor preenchido.
   * - MULTIPLE_CHOICE: opção e nome da mesma.
   * - IMAGES: quantidade de imagens > 0 e URLs válidas (não blob/data).
   * - DYNAMIC_LAYOUT: arte final + fabric state.
   */
  private isCustomizationValid(type: string, data: any): boolean {
    if (!data) return false;

    // ✅ NOVO: Verificar apenas formato de URL (não existência física no disco)
    // Alinhado com validação do frontend para evitar falsos negativos após reload
    const checkValidUrl = (url: string | undefined): boolean => {
      if (!url) return false;
      // Verificar que não é blob ou data URL (significa que foi salvo no servidor)
      return !url.startsWith("blob:") && !url.startsWith("data:");
    };

    switch (type) {
      case "TEXT":
        return typeof data.text === "string" && data.text.trim().length > 0;

      case "MULTIPLE_CHOICE":
        // Relaxado: ter opção OU label já conta como preenchido para evitar falsos negativos no segundo GET
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
        // ✅ Relaxado: Se tem fotos, verificamos se não são blobs
        return photos.some((p: any) => {
          const url =
            p?.preview_url || p?.url || (typeof p === "string" ? p : null);
          return url && checkValidUrl(url);
        });

      case "DYNAMIC_LAYOUT":
        // Arte final + Fabric state
        const artworkUrl =
          data.image?.preview_url ||
          data.previewUrl ||
          data.text ||
          data.final_artwork?.preview_url ||
          data.finalArtwork?.preview_url ||
          data.final_artworks?.[0]?.preview_url;
        // ✅ Relaxado: Arte OU Fabric OU Label já conta como válido
        const hasArtwork = !!artworkUrl && checkValidUrl(artworkUrl);
        const hasLabelDL = !!(
          data.selected_item_label ||
          data.label_selected ||
          data.label
        );
        return !!hasArtwork || !!data.fabricState || hasLabelDL;

      default:
        // Qualquer objeto com dados é considerado preenchido
        return data && Object.keys(data).length > 0;
    }
  }

  /**
   * ✅ NOVO: Consolida dados de customização para revisão no carrinho/checkout
   * Busca itens do pedido, seus produtos, regras disponíveis por componente e dados preenchidos.
   */
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

    const result = orderItems.map((item) => {
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

      // Filtrar apenas customizações que REALMENTE têm valor preenchido e evitar duplicatas
      const seen = new Set();
      const filledCustomizations = item.customizations
        .map((c: any) => {
          const parsedValue = this.parseCustomizationData(c.value);
          const type = (c.customization_type ||
            parsedValue.customization_type ||
            "TEXT") as string;

          if (!this.isCustomizationValid(type, parsedValue)) {
            return null;
          }

          const ruleId =
            c.customization_id ||
            parsedValue.customizationRuleId ||
            parsedValue.customization_id ||
            "default";

          return {
            id: c.id,
            order_item_id: c.order_item_id,
            customization_id: ruleId,
            value: parsedValue,
            componentId: parsedValue.componentId, // Important to expose componentId
          };
        })
        .filter((c: any) => {
          if (!c) return false;
          // Deduplicar: se já temos esse RuleID para o mesmo ComponentID, ignorar o posterior
          const key = `${c.customization_id}-${c.componentId || "default"}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      return {
        orderItemId: item.id,
        productId: item.product_id,
        productName: item.product.name,
        availableCustomizations: allAvailable,
        filledCustomizations: filledCustomizations,
      };
    });

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

    // Parsear o valor existente
    const existingData = this.parseCustomizationData(existing.value);

    // ✅ NOVO: Coletar URLs temporárias antigas para deletar se forem substituídas
    const oldTempFiles: string[] = [];

    // Coletar arquivos antigos que serão substituídos
    if (
      input.customizationData?.image?.preview_url &&
      existingData.image?.preview_url &&
      input.customizationData.image.preview_url !==
        existingData.image.preview_url
    ) {
      // Se o novo canvas preview é diferente do antigo, deletar o antigo
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

    // Mesclar com novos dados de customização
    const mergedCustomizationData = {
      ...existingData,
      ...(input.customizationData ?? {}),
    };

    // Se input tem título ou tipo, atualizar também
    if (input.title) {
      mergedCustomizationData.title = input.title;
    }
    if (input.customizationType) {
      mergedCustomizationData.customization_type = input.customizationType;
    }
    if (input.selectedLayoutId) {
      mergedCustomizationData.selected_layout_id = input.selectedLayoutId;
    }

    // Recompute label_selected when updating
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
      // If no label can be computed, ensure we don't accidentally keep stale labels
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
    } catch (err) {
      /* ignore logging errors */
    }

    const result = await prisma.orderItemCustomization.update({
      where: { id: customizationId },
      data: updateData,
    });

    // ✅ NOVO: Deletar arquivos temporários antigos (não bloqueia se falhar)
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
        // Não falha o processo se não conseguir deletar
      }
    }

    return result;
  }

  /**
   * ✅ NOVO: Após fazer upload para Google Drive, deletar arquivos temporários
   * Extrai filenames de /uploads/temp/ URLs e deleta os arquivos
   */
  /**
   * 🔥 NOVO: Criar backup redundante antes de deletar arquivos temp
   */
  private async backupTempFilesBeforeDelete(
    files: string[],
  ): Promise<{ success: number; failed: number }> {
    const baseStorageDir = path.join(process.cwd(), "storage");

    const tempDir = path.join(baseStorageDir, "temp");
    const backupDir = path.join(baseStorageDir, "backup");

    // Criar diretório de backup se não existir
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      logger.info(`📁 Diretório de backup criado: ${backupDir}`);
    }

    let success = 0;
    let failed = 0;

    for (const filename of files) {
      try {
        const sourcePath = path.join(tempDir, filename);

        // Verificar se arquivo existe
        if (!fs.existsSync(sourcePath)) {
          logger.warn(`⚠️ Arquivo não encontrado para backup: ${filename}`);
          failed++;
          continue;
        }

        // Criar nome único com timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupFilename = `${timestamp}_${filename}`;
        const backupPath = path.join(backupDir, backupFilename);

        // Copiar arquivo (não mover)
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
        // Se a URL é do temp storage, extrair o filename
        if (asset.url && asset.url.includes("/uploads/temp/")) {
          const filename = asset.url.split("/uploads/temp/").pop();
          if (filename && filename.length > 0) {
            tempFilesToDelete.push(filename);
          }
        }
      }

      if (tempFilesToDelete.length > 0) {
        // 🔥 NOVO: Criar backup antes de deletar
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
      // Não falha o processo se não conseguir deletar
    }
  }

  async finalizeOrderCustomizations(orderId: string): Promise<FinalizeResult> {
    logger.debug(
      `🧩 Iniciando finalizeOrderCustomizations para orderId=${orderId}`,
    );

    // ✅ VERIFICAÇÃO DE IDEMPOTÊNCIA: Se a pasta já foi criada, retornar dados existentes
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

    let mainFolderId: string | null = null;
    let uploadedFiles = 0;
    let base64Detected = false;
    const base64AffectedIds: string[] = [];
    const subfolderMap: Record<string, string> = {}; // Map folder name -> subfolder ID

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
      logger.info(
        `📁 Subpasta criada para ${folderName}: ${subfolderId}`,
      );
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

        // ✅ NOVO: extractArtworkAssets agora retorna Promise<{ url, filename, mimeType }[]>
        const artworkUrls = await this.extractArtworkAssets(data);

        if (artworkUrls.length === 0) {
          continue;
        }

        const targetFolder = await ensureSubfolder(folderName);

        // ✅ NOVO: uploadArtworkFromUrl em vez de uploadArtwork
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

        // Recompute label_selected for DYNAMIC_LAYOUT / MULTIPLE_CHOICE if missing
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

        // Defense: ensure no lingering base64 fields anywhere in the JSON
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

        // Verification: read back the saved value and ensure it doesn't contain base64
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
            // Try an additional pass: parse and remove any lingering base64 fields and resave
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

                // verify again
                const refetch = await prisma.orderItemCustomization.findUnique({
                  where: { id: customization.id },
                  select: { value: true },
                });
                const refVal = refetch ? String(refetch.value) : "";
                if (!dataUriPattern.test(refVal)) {
                  logger.info(
                    `✅ Re-sanitization successful for customization ${customization.id}`,
                  );
                  // remove from base64AffectedIds since it was fixed
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

    if (!mainFolderId) {
      return { uploadedFiles: 0 };
    }

    const folderUrl = googleDriveService.getFolderUrl(mainFolderId);

    // ✅ NOVO: Deletar temp files após finalização completa
    try {
      const allAssets: Array<{ url: string; filename?: string }> = [];

      for (const item of order.items) {
        for (const customization of item.customizations) {
          const data = this.parseCustomizationData(customization.value);

          // Coletar preview_url de todos os campos possíveis
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
      // Não falha o processo se não conseguir deletar
    }

    base64Detected = base64AffectedIds.length > 0;

    // ✅ NOVO: Atualizar o status de processamento do pedido para idempotência
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

    // Sanitizar valores de customização antes de retornar (remover base64)
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
          // Caso parsing falhe, retornar o registro sem alteração
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

    // MULTIPLE_CHOICE — find the option label using provided options or DB rule
    if (customizationType === "MULTIPLE_CHOICE") {
      const selectedOption =
        customizationData.selected_option ||
        (Array.isArray(customizationData.selected_options)
          ? customizationData.selected_options[0]
          : undefined);

      if (!selectedOption) return undefined;

      // First try options provided by the frontend in the customization data
      const options = customizationData.options || undefined;

      if (Array.isArray(options)) {
        const opt = options.find((o: any) => o.id === selectedOption);
        if (opt) return opt.label || opt.name || opt.title;
      }

      // Fallback: fetch customization rule and options from DB
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
          // ignore DB errors and return undefined
          console.warn(
            "computeLabelSelected: erro ao buscar customization rule",
            error,
          );
        }
      }

      return undefined;
    }

    // DYNAMIC_LAYOUT — use the provided layout id or selected_layout_id to get layout name
    if (customizationType === "DYNAMIC_LAYOUT") {
      // Try typical fields then recursively search the object for common keys
      const layoutId =
        selectedLayoutId ||
        customizationData.layout_id ||
        customizationData.DYNAMIC_LAYOUT_id ||
        this.findLayoutIdInObject(customizationData);
      if (!layoutId) return undefined;

      try {
        // Tabela layout foi removida. Tentar buscar em DynamicLayout ou LayoutBase se necessário.
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

  // Search recursively for layout id in nested JSON structure
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

    // ✅ DYNAMIC_LAYOUT: Prioridade máxima para design final
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

    // Suporte para campo "photos" (IMAGES type)
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

    // Suporte para "images" array (compatibilidade genérica se não for DYNAMIC_LAYOUT já processado)
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

  /**
   * ✅ NOVO: Upload de arquivo a partir de URL temporária (armazenado em /storage/temp)
   * Busca o arquivo da VPS e faz upload para o Google Drive
   */
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

      // Se for URL temporária local (/uploads/temp/...)
      if (url.startsWith("/uploads/temp/")) {
        const tempFileName = url.replace("/uploads/temp/", "");
        const baseStorageDir = path.join(process.cwd(), "storage");
        const filePath = path.join(baseStorageDir, "temp", tempFileName);

        // Validação de segurança: garantir que não está tentando fazer path traversal
        if (!filePath.startsWith(path.join(baseStorageDir, "temp"))) {
          throw new Error(`Invalid file path: ${filePath}`);
        }

        if (!fs.existsSync(filePath)) {
          logger.error(`❌ Arquivo temporário não encontrado: ${filePath}`);
          throw new Error(`Temporary file not found: ${tempFileName}`);
        }

        fileBuffer = fs.readFileSync(filePath);
        logger.debug(
          `✅ Arquivo lido do temp: ${tempFileName} (${fileBuffer.length} bytes)`,
        );
      }
      // Se for URL HTTP (para compatibilidade/fallback)
      else if (url.startsWith("http")) {
        logger.debug(`📥 Baixando arquivo de URL: ${url}`);
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
        });
        fileBuffer = Buffer.from(response.data);
        logger.debug(`✅ Arquivo baixado: ${fileBuffer.length} bytes`);
      }
      // Se for base64 (para compatibilidade durante migração)
      else if (url.startsWith("data:")) {
        logger.warn(
          `⚠️ Asset ainda contém base64 (devia ter sido migrado): ${filename}`,
        );
        // Extrair base64
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

      // Upload para Google Drive
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

      // ⚠️ NOTA: Temp files deletados no final do ciclo de vida (status DELIVERED)
      // Não deletar aqui pois causa erro 404 ao fazer requisições HTTP
      // A deleção é feita em updateOrderStatus quando status = DELIVERED

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

    // Normalizar finalArtwork (camelCase) para final_artwork (snake_case)
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

    // photos may follow final_artwork/final_artworks in the upload sequence.
    // We must compute the correct upload index offset based on the number of
    // final_artwork and final_artworks that were present.
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
        // Apenas buscar no array de uploads se o tipo for de fato IMAGES
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
          // Só avisar se for o tipo esperado e falhar
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

    // ✅ NOVO: Sanitizar LAYOUT_BASE images array
    if (Array.isArray(sanitized.images)) {
      const isDynamic = sanitized.customization_type === "DYNAMIC_LAYOUT";

      sanitized.images = sanitized.images.map((image: any, idx: number) => {
        // Para DYNAMIC_LAYOUT, as imagens individuais dos slots não sobem para o Drive
        // (apenas a arte final sobe), então não buscamos info de upload para elas.
        const upload = !isDynamic ? uploads[uploadIndex + idx] : undefined;

        const newImage = {
          ...image,
          url: undefined, // Remove base64 URL
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
          // Só logar aviso se não for dinâmico, pois no dinâmico é esperado não ter upload individual
          logger.warn(
            `⚠️ LAYOUT_BASE image[${idx}] sanitized but no upload info found`,
          );
        }

        return newImage;
      });

      // Apenas avançar o ponteiro de uploads se as imagens foram de fato carregadas
      if (!isDynamic) {
        uploadIndex += sanitized.images.length;
      }
    }

    // ✅ NOVO: Remover base64 do campo text se for uma URL base64
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

      // Check for data URI strings
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

  /**
   * ✅ NOVO: Valida a existência física dos arquivos de customização.
   * Retorna um mapa { [customizationId]: isValid }.
   */
  async validateOrderCustomizationsFiles(
    orderId: string,
  ): Promise<{ files: Record<string, boolean> }> {
    const orderItems = await prisma.orderItem.findMany({
      where: { order_id: orderId },
      include: { customizations: true },
    });

    const fileStatus: Record<string, boolean> = {};

    for (const item of orderItems) {
      for (const custom of item.customizations) {
        let isValid = true;
        const data = this.parseCustomizationData(custom.value);

        const urls: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extractUrls = (obj: any) => {
          if (!obj) return;
          if (typeof obj === "object") {
            if (obj.preview_url) urls.push(obj.preview_url);
            if (obj.url) urls.push(obj.url); // Legacy

            // Recursively search
            if (Array.isArray(obj)) {
              obj.forEach(extractUrls);
            } else {
              Object.values(obj).forEach(extractUrls);
            }
          }
        };
        extractUrls(data);

        for (const url of urls) {
          if (
            url &&
            (url.includes("/uploads/temp/") ||
              url.includes("/images/customizations/"))
          ) {
            const filePath = this.getFilePathFromUrl(url);
            // Se path foi resolvido mas arquivo não existe
            if (filePath && !fs.existsSync(filePath)) {
              isValid = false;
              break;
            }
          }
        }

        fileStatus[custom.id] = isValid;
      }
    }
    return { files: fileStatus };
  }

  private getFilePathFromUrl(url: string): string | null {
    try {
      // Remover domínio se houver
      const urlPath = url.replace(/^https?:\/\/[^\/]+/, "");

      // Ajustar caminhos baseados na configuração do projeto
      // Assumindo estrutura padrão vista em uploadController ou rotas
      // Rota: /uploads/temp -> process.cwd()/storage/temp (conforme routes.ts getTempUploadsPath)
      // OU process.cwd()/uploads/temp (conforme lógica de delete no próprio service)

      if (urlPath.includes("/uploads/temp/")) {
        const filename = urlPath.split("/uploads/temp/").pop();
        if (!filename) return null;

        // Tentar locations comuns
        const path1 = path.join(process.cwd(), "uploads", "temp", filename);
        const path2 = path.join(process.cwd(), "storage", "temp", filename);

        if (fs.existsSync(path1)) return path1;
        if (fs.existsSync(path2)) return path2;

        // Se não existe em lugar nenhum, retorna path1 como default para falhar a checagem
        return path1;
      }

      if (urlPath.includes("/images/customizations/")) {
        const parts = urlPath.split("/images/customizations/");
        const relativePath = parts[1];
        if (!relativePath) return null;

        // Decodificar URI parts (espaços, etc)
        const safeRelative = decodeURIComponent(relativePath);

        return path.join(
          process.cwd(),
          "images",
          "customizations",
          safeRelative,
        );
      }
      return null;
    } catch {
      return null;
    }
  }
}

export default new OrderCustomizationService();
