import { CustomizationType } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../database/prisma";
import googleDriveService from "./googleDriveService";
import logger from "../utils/logger";
import fs from "fs";
import path from "path";
import axios from "axios";

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

/**
 * Serviço para gerenciar customizações de pedidos
 *
 * NOVO FLUXO (após migração para temp files):
 * 1. Frontend faz upload de imagens para /temp/upload (salva em /storage/temp)
 * 2. Frontend envia customização com URLs temporárias (não base64)
 * 3. Backend salva URLs temporárias no banco
 * 4. Webhook pós-pagamento: finalizeOrderCustomizations() busca arquivos do temp
 * 5. Faz upload para Google Drive
 * 6. Deleta arquivos temporários
 */
class OrderCustomizationService {
  async saveOrderItemCustomization(input: SaveOrderCustomizationInput) {
    // O schema atual tem apenas: order_item_id, customization_id, value
    // Vamos salvar todos os dados extras no campo "value" como JSON
    const customizationValue: any = {
      customization_type: input.customizationType,
      title: input.title,
      selected_layout_id: input.selectedLayoutId,
      // ✅ NOVO: Dados chegam com URLs temporárias em vez de base64
      // O customizationData já contém as URLs do /uploads/temp/
      ...input.customizationData,
    };

    // Compute and include label_selected when possible
    const computedLabel = await this.computeLabelSelected(
      input.customizationType,
      input.customizationData,
      input.customizationRuleId,
      input.selectedLayoutId
    );

    if (computedLabel) {
      customizationValue.label_selected = computedLabel;
      // Keep backward compatibility for frontend that reads specific label fields
      if (input.customizationType === "MULTIPLE_CHOICE") {
        customizationValue.selected_option_label = computedLabel;
      }
      if (input.customizationType === "BASE_LAYOUT") {
        customizationValue.selected_item_label = computedLabel;
      }
    }

    const payload: any = {
      order_item_id: input.orderItemId,
      customization_id: input.customizationRuleId || "default", // Obrigatório no schema
      value: JSON.stringify(customizationValue),
    };

    try {
      // ✅ LOG: Agora deve ter URLs de temp files em vez de base64
      const hasTempUrls = /\/uploads\/temp\//.test(payload.value);
      const containsBase64 = /data:[^;]+;base64,/.test(payload.value);
      logger.debug(
        `🔍 [saveOrderItemCustomization] hasTempUrls=${hasTempUrls}, containsBase64=${containsBase64}, type=${input.customizationType}, ruleId=${input.customizationRuleId}`
      );
    } catch (err) {
      /* ignore logging errors */
    }

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

    // Parsear o valor existente
    const existingData = this.parseCustomizationData(existing.value);

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
      input.selectedLayoutId ?? mergedCustomizationData.selected_layout_id
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
          mergedCustomizationData.customization_type) === "BASE_LAYOUT"
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
        }, ruleId=${input.customizationRuleId ?? existing.customization_id}`
      );
    } catch (err) {
      /* ignore logging errors */
    }

    return prisma.orderItemCustomization.update({
      where: { id: customizationId },
      data: updateData,
    });
  }

  /**
   * ✅ NOVO: Após fazer upload para Google Drive, deletar arquivos temporários
   * Extrai filenames de /uploads/temp/ URLs e deleta os arquivos
   */
  private async deleteUploadedTempFiles(
    assets: Array<{ url: string; filename?: string }>
  ): Promise<void> {
    try {
      const tempFileService = require("./tempFileService").default;
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
        logger.info(
          `🗑️ [finalizeOrderCustomizations] Deletando ${tempFilesToDelete.length} arquivos temporários...`
        );
        const result = tempFileService.deleteFiles(tempFilesToDelete);
        logger.info(
          `✅ [finalizeOrderCustomizations] ${result.deleted} temp files deletados, ${result.failed} falharam`
        );
      }
    } catch (error: any) {
      logger.warn(
        `⚠️ Erro ao deletar temp files após upload: ${error.message}`
      );
      // Não falha o processo se não conseguir deletar
    }
  }

  async finalizeOrderCustomizations(orderId: string): Promise<FinalizeResult> {
    logger.debug(
      `🧩 Iniciando finalizeOrderCustomizations para orderId=${orderId}`
    );
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

    let mainFolderId: string | null = null;
    let uploadedFiles = 0;
    let base64Detected = false;
    const base64AffectedIds: string[] = [];
    const subfolderMap: Record<string, string> = {}; // Map customization type -> subfolder ID

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

    const ensureSubfolder = async (customizationType: string) => {
      // Return existing subfolder for this type
      if (subfolderMap[customizationType]) {
        return subfolderMap[customizationType];
      }

      const mainFolder = await ensureMainFolder();

      // Map type to folder name
      const folderNameMap: Record<string, string> = {
        IMAGES: "IMAGES",
        BASE_LAYOUT: "BASE_LAYOUT",
        MULTIPLE_CHOICE: "MULTIPLE_CHOICE",
        TEXT: "TEXT",
        ADDITIONALS: "ADDITIONALS",
      };

      const subfolderName =
        folderNameMap[customizationType] || customizationType;
      const subfolderId = await googleDriveService.createFolder(
        subfolderName,
        mainFolder
      );
      await googleDriveService.makeFolderPublic(subfolderId);
      subfolderMap[customizationType] = subfolderId;
      logger.info(
        `📁 Subpasta criada para ${customizationType}: ${subfolderId}`
      );
      return subfolderId;
    };

    for (const item of order.items) {
      for (const customization of item.customizations) {
        logger.debug(
          `🔎 processando customization ${customization.id} do item ${item.id}`
        );
        const data = this.parseCustomizationData(customization.value);
        const customizationType = data.customization_type || "DEFAULT";

        // ✅ NOVO: extractArtworkAssets agora retorna Promise<{ url, filename, mimeType }[]>
        const artworkUrls = await this.extractArtworkAssets(data);

        if (artworkUrls.length === 0) {
          continue;
        }

        const targetFolder = await ensureSubfolder(customizationType);

        // ✅ NOVO: uploadArtworkFromUrl em vez de uploadArtwork
        const uploads = await Promise.all(
          artworkUrls.map((asset) =>
            this.uploadArtworkFromUrl(
              asset,
              { id: customization.id },
              targetFolder
            )
          )
        );

        uploadedFiles += uploads.length;

        const sanitizedData = this.removeBase64FromData(data, uploads);

        // Recompute label_selected for BASE_LAYOUT / MULTIPLE_CHOICE if missing
        try {
          const cType = sanitizedData.customization_type;
          if (
            !sanitizedData.label_selected ||
            sanitizedData.label_selected === ""
          ) {
            if (cType === "BASE_LAYOUT" || cType === "MULTIPLE_CHOICE") {
              const computed = await this.computeLabelSelected(
                cType,
                sanitizedData,
                customization.customization_id as any,
                sanitizedData.selected_layout_id
              );
              if (computed) {
                sanitizedData.label_selected = computed;
                if (cType === "MULTIPLE_CHOICE") {
                  sanitizedData.selected_option_label = computed;
                }
                if (cType === "BASE_LAYOUT") {
                  sanitizedData.selected_item_label = computed;
                }
                logger.info(
                  `🧭 Recomputed label_selected for customization ${customization.id}: ${computed}`
                );
              }
            }
          }
        } catch (err) {
          logger.warn(
            `⚠️ Falha ao recomputar label_selected para customization ${customization.id}:`,
            err
          );
        }

        // Defense: ensure no lingering base64 fields anywhere in the JSON
        const removedFieldsCount =
          this.removeBase64FieldsRecursive(sanitizedData);
        if (removedFieldsCount > 0) {
          logger.info(
            `✅ Removidos ${removedFieldsCount} campo(s) base64 do payload antes de salvar`
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
              customization.id
            );
            base64Detected = true;
            base64AffectedIds.push(customization.id);
            // Try an additional pass: parse and remove any lingering base64 fields and resave
            try {
              const parsed = JSON.parse(updatedVal);
              const removed = this.removeBase64FieldsRecursive(parsed);
              if (removed > 0) {
                logger.info(
                  `🔁 Re-sanitizing customization ${customization.id}, removed ${removed} lingering base64 fields`
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
                    `✅ Re-sanitization successful for customization ${customization.id}`
                  );
                  // remove from base64AffectedIds since it was fixed
                  const idx = base64AffectedIds.indexOf(customization.id);
                  if (idx >= 0) base64AffectedIds.splice(idx, 1);
                }
              }
            } catch (err) {
              logger.warn(
                `⚠️ Falha ao re-sanitizar customization ${customization.id}:`,
                err
              );
            }
          }
        } catch (verifyErr) {
          logger.error(
            "Erro ao verificar registro após sanitização:",
            verifyErr
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
    const result = {
      folderId: mainFolderId,
      folderUrl,
      uploadedFiles,
      base64Detected,
      base64AffectedIds,
    };

    logger.info(
      `✅ finalizeOrderCustomizations concluído orderId=${orderId} uploads=${uploadedFiles} folderId=${mainFolderId}`
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
    selectedLayoutId?: string | null
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
            (o: any) => o.id === selectedOption
          );
          if (match) return match.label || match.name || match.title;
        } catch (error) {
          // ignore DB errors and return undefined
          console.warn(
            "computeLabelSelected: erro ao buscar customization rule",
            error
          );
        }
      }

      return undefined;
    }

    // BASE_LAYOUT — use the provided layout id or selected_layout_id to get layout name
    if (customizationType === "BASE_LAYOUT") {
      // Try typical fields then recursively search the object for common keys
      const layoutId =
        selectedLayoutId ||
        customizationData.layout_id ||
        customizationData.base_layout_id ||
        this.findLayoutIdInObject(customizationData);
      if (!layoutId) return undefined;

      try {
        const layout = await prisma.layout.findUnique({
          where: { id: layoutId },
        });
        return (layout?.name as string) || undefined;
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
      "base_layout_id",
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

    // ✅ NOVO: Buscar URLs de arquivos temporários em vez de base64

    // Suporte para campo "photos" - buscar URLs temporárias
    const photos = Array.isArray(data?.photos) ? data.photos : [];

    photos.forEach((photo: any, index: number) => {
      if (photo && typeof photo === "object") {
        // ✅ NOVO: Buscar URL temporária em preview_url ou base64 (para compatibilidade)
        let imageUrl = photo.preview_url || photo.base64 || photo.base64Data;

        if (imageUrl && typeof imageUrl === "string") {
          // Se for base64, ignorar (devia ter sido migrado)
          if (!imageUrl.startsWith("data:") && !imageUrl.startsWith("blob:")) {
            assets.push({
              url: imageUrl,
              filename:
                photo.original_name ||
                photo.fileName ||
                `photo-${index + 1}.jpg`,
              mimeType: photo.mime_type || photo.mimeType || "image/jpeg",
            });
          } else {
            logger.warn(
              `⚠️ Photo ${index} ainda contém base64/blob (devia ter sido migrado)`
            );
          }
        }
      }
    });

    // Suporte para BASE_LAYOUT - buscar URL ou base64 do campo "text"
    if (data?.customization_type === "BASE_LAYOUT" && data?.text) {
      const textContent = data.text;

      if (typeof textContent === "string") {
        // Se for URL temporária
        if (
          textContent.startsWith("/uploads/temp/") ||
          textContent.startsWith("http")
        ) {
          assets.push({
            url: textContent,
            filename: `layout-preview-${Date.now()}.png`,
            mimeType: "image/png",
          });
        }
        // Se for base64, manter suporte (caso chegue durante transição)
        else if (textContent.startsWith("data:image")) {
          logger.warn(
            `⚠️ BASE_LAYOUT ainda contém base64 em campo 'text' (devia ter sido migrado)`
          );
          // Será processado no método uploadArtwork que mantém suporte a base64
          assets.push({
            url: textContent,
            filename: `layout-preview-${Date.now()}.png`,
            mimeType: "image/png",
          });
        }
      }
    }

    // Suporte para "images" array (compatibilidade)
    const images = Array.isArray(data?.images) ? data.images : [];

    images.forEach((image: any, index: number) => {
      if (image && typeof image === "object") {
        let imageUrl = image.url || image.base64 || image.base64Data;

        if (imageUrl && typeof imageUrl === "string") {
          if (!imageUrl.startsWith("data:") && !imageUrl.startsWith("blob:")) {
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
      }
    });

    logger.debug(
      `📦 extractArtworkAssets: ${assets.length} assets extraídos (${photos.length} photos, ${images.length} images)`
    );

    return assets;
  }

  /**
   * ✅ NOVO: Upload de arquivo a partir de URL temporária (armazenado em /storage/temp)
   * Busca o arquivo da VPS e faz upload para o Google Drive
   */
  private async uploadArtworkFromUrl(
    asset: { url: string; filename: string; mimeType: string },
    customization: { id: string },
    folderId: string
  ) {
    try {
      const { url, filename, mimeType } = asset;

      logger.debug(
        `📤 uploadArtworkFromUrl: ${filename} (${url}) -> Drive folder ${folderId}`
      );

      let fileBuffer: Buffer | null = null;

      // Se for URL temporária local (/uploads/temp/...)
      if (url.startsWith("/uploads/temp/")) {
        const tempFileName = url.replace("/uploads/temp/", "");
        const baseStorageDir =
          process.env.NODE_ENV === "production"
            ? "/app/storage"
            : path.join(process.cwd(), "storage");
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
          `✅ Arquivo lido do temp: ${tempFileName} (${fileBuffer.length} bytes)`
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
          `⚠️ Asset ainda contém base64 (devia ter sido migrado): ${filename}`
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
          8
        )}.${extension}`;

      const upload = await googleDriveService.uploadBuffer(
        fileBuffer,
        fileName,
        folderId,
        mimeType
      );

      logger.info(
        `✅ Arquivo enviado para Drive: ${fileName} (id=${upload.id}, size=${fileBuffer.length})`
      );

      return {
        ...upload,
        mimeType,
        fileName,
      };
    } catch (error: any) {
      logger.error(
        `❌ Erro ao fazer upload de artwork: ${asset.filename}`,
        error
      );
      throw error;
    }
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
      if (uploads[0]) {
        logger.info(
          `✅ final_artwork sanitized and uploaded: ${uploads[0]?.fileName} (driveId=${uploads[0]?.id})`
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
        })
      );
      sanitized.final_artworks.forEach((entry: any, index: number) => {
        const up = uploads[index];
        if (up) {
          logger.info(
            `✅ final_artworks[${index}] sanitized and uploaded: ${up.fileName} (driveId=${up.id})`
          );
        } else {
          logger.warn(
            `⚠️ final_artworks[${index}] sanitized but no upload info found`
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
      sanitized.photos = sanitized.photos.map((photo: any, idx: number) => {
        const upload = uploads[uploadIndex + idx];
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
            `✅ Photo sanitized and uploaded: ${newPhoto.fileName} (driveId=${upload.id})`
          );
        } else {
          logger.warn(
            `⚠️ Photo sanitized but no upload info found for index ${idx}`
          );
        }

        return newPhoto;
      });
      uploadIndex += sanitized.photos.length;
    }

    // ✅ NOVO: Sanitizar LAYOUT_BASE images array
    if (Array.isArray(sanitized.images)) {
      sanitized.images = sanitized.images.map((image: any, idx: number) => {
        const upload = uploads[uploadIndex + idx];
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
            })`
          );
        } else {
          logger.warn(
            `⚠️ LAYOUT_BASE image[${idx}] sanitized but no upload info found`
          );
        }

        return newImage;
      });
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
        (item) => (removedCount += this.removeBase64FieldsRecursive(item) || 0)
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
}

export default new OrderCustomizationService();
