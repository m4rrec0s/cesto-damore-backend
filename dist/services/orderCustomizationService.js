"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../database/prisma"));
const googleDriveService_1 = __importDefault(require("./googleDriveService"));
const logger_1 = __importDefault(require("../utils/logger"));
class OrderCustomizationService {
    async saveOrderItemCustomization(input) {
        // O schema atual tem apenas: order_item_id, customization_id, value
        // Vamos salvar todos os dados extras no campo "value" como JSON
        const customizationValue = {
            customization_type: input.customizationType,
            title: input.title,
            selected_layout_id: input.selectedLayoutId,
            ...input.customizationData,
        };
        // Compute and include label_selected when possible
        const computedLabel = await this.computeLabelSelected(input.customizationType, input.customizationData, input.customizationRuleId, input.selectedLayoutId);
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
        const payload = {
            order_item_id: input.orderItemId,
            customization_id: input.customizationRuleId || "default", // Obrigatório no schema
            value: JSON.stringify(customizationValue),
        };
        return prisma_1.default.orderItemCustomization.create({
            data: payload,
        });
    }
    async ensureOrderItem(orderId, orderItemId) {
        const orderItem = await prisma_1.default.orderItem.findFirst({
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
    async updateOrderItemCustomization(customizationId, input) {
        const existing = await prisma_1.default.orderItemCustomization.findUnique({
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
        const updatedLabel = await this.computeLabelSelected(input.customizationType ?? mergedCustomizationData.customization_type, mergedCustomizationData, input.customizationRuleId ?? existing.customization_id, input.selectedLayoutId ?? mergedCustomizationData.selected_layout_id);
        if (updatedLabel) {
            mergedCustomizationData.label_selected = updatedLabel;
            if ((input.customizationType ??
                mergedCustomizationData.customization_type) === "MULTIPLE_CHOICE") {
                mergedCustomizationData.selected_option_label = updatedLabel;
            }
            if ((input.customizationType ??
                mergedCustomizationData.customization_type) === "BASE_LAYOUT") {
                mergedCustomizationData.selected_item_label = updatedLabel;
            }
        }
        else {
            // If no label can be computed, ensure we don't accidentally keep stale labels
            delete mergedCustomizationData.label_selected;
            delete mergedCustomizationData.selected_option_label;
            delete mergedCustomizationData.selected_item_label;
        }
        const updateData = {
            customization_id: input.customizationRuleId ?? existing.customization_id,
            value: JSON.stringify(mergedCustomizationData),
        };
        return prisma_1.default.orderItemCustomization.update({
            where: { id: customizationId },
            data: updateData,
        });
    }
    async finalizeOrderCustomizations(orderId) {
        logger_1.default.debug(`🧩 Iniciando finalizeOrderCustomizations para orderId=${orderId}`);
        const order = await prisma_1.default.order.findUnique({
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
        let folderId = null;
        let uploadedFiles = 0;
        let base64Detected = false;
        const base64AffectedIds = [];
        const ensureFolder = async () => {
            if (folderId)
                return folderId;
            const safeCustomerName = (order.user?.name || "Cliente")
                .replace(/[^a-zA-Z0-9]/g, "_")
                .substring(0, 40);
            const folderName = `Pedido_${safeCustomerName}_${new Date().toISOString().split("T")[0]}_${orderId.substring(0, 8)}`;
            folderId = await googleDriveService_1.default.createFolder(folderName);
            await googleDriveService_1.default.makeFolderPublic(folderId);
            return folderId;
        };
        for (const item of order.items) {
            for (const customization of item.customizations) {
                logger_1.default.debug(`🔎 processando customization ${customization.id} do item ${item.id}`);
                const data = this.parseCustomizationData(customization.value);
                const artworks = this.extractArtworkAssets(data);
                if (artworks.length === 0) {
                    continue;
                }
                const targetFolder = await ensureFolder();
                const uploads = await Promise.all(artworks.map((asset) => this.uploadArtwork(asset, { id: customization.id }, targetFolder)));
                uploadedFiles += uploads.length;
                const sanitizedData = this.removeBase64FromData(data, uploads);
                // Recompute label_selected for BASE_LAYOUT / MULTIPLE_CHOICE if missing
                try {
                    const cType = sanitizedData.customization_type;
                    if (!sanitizedData.label_selected ||
                        sanitizedData.label_selected === "") {
                        if (cType === "BASE_LAYOUT" || cType === "MULTIPLE_CHOICE") {
                            const computed = await this.computeLabelSelected(cType, sanitizedData, customization.customization_id, sanitizedData.selected_layout_id);
                            if (computed) {
                                sanitizedData.label_selected = computed;
                                if (cType === "MULTIPLE_CHOICE") {
                                    sanitizedData.selected_option_label = computed;
                                }
                                if (cType === "BASE_LAYOUT") {
                                    sanitizedData.selected_item_label = computed;
                                }
                                logger_1.default.info(`🧭 Recomputed label_selected for customization ${customization.id}: ${computed}`);
                            }
                        }
                    }
                }
                catch (err) {
                    logger_1.default.warn(`⚠️ Falha ao recomputar label_selected para customization ${customization.id}:`, err);
                }
                // Defense: ensure no lingering base64 fields anywhere in the JSON
                const removedFieldsCount = this.removeBase64FieldsRecursive(sanitizedData);
                if (removedFieldsCount > 0) {
                    logger_1.default.info(`✅ Removidos ${removedFieldsCount} campo(s) base64 do payload antes de salvar`);
                }
                await prisma_1.default.orderItemCustomization.update({
                    where: { id: customization.id },
                    data: {
                        value: JSON.stringify(sanitizedData),
                        google_drive_folder_id: targetFolder,
                        google_drive_url: googleDriveService_1.default.getFolderUrl(targetFolder),
                    },
                });
                // Verification: read back the saved value and ensure it doesn't contain base64
                try {
                    const updated = await prisma_1.default.orderItemCustomization.findUnique({
                        where: { id: customization.id },
                        select: { value: true },
                    });
                    const updatedVal = updated ? String(updated.value) : "";
                    const dataUriPattern = /data:[^;]+;base64,/i;
                    if (updatedVal && dataUriPattern.test(updatedVal)) {
                        logger_1.default.warn("🚨 Detected data URI / base64 content in saved customization value after sanitization:", customization.id);
                        base64Detected = true;
                        base64AffectedIds.push(customization.id);
                        // Try an additional pass: parse and remove any lingering base64 fields and resave
                        try {
                            const parsed = JSON.parse(updatedVal);
                            const removed = this.removeBase64FieldsRecursive(parsed);
                            if (removed > 0) {
                                logger_1.default.info(`🔁 Re-sanitizing customization ${customization.id}, removed ${removed} lingering base64 fields`);
                                await prisma_1.default.orderItemCustomization.update({
                                    where: { id: customization.id },
                                    data: { value: JSON.stringify(parsed) },
                                });
                                // verify again
                                const refetch = await prisma_1.default.orderItemCustomization.findUnique({
                                    where: { id: customization.id },
                                    select: { value: true },
                                });
                                const refVal = refetch ? String(refetch.value) : "";
                                if (!dataUriPattern.test(refVal)) {
                                    logger_1.default.info(`✅ Re-sanitization successful for customization ${customization.id}`);
                                    // remove from base64AffectedIds since it was fixed
                                    const idx = base64AffectedIds.indexOf(customization.id);
                                    if (idx >= 0)
                                        base64AffectedIds.splice(idx, 1);
                                }
                            }
                        }
                        catch (err) {
                            logger_1.default.warn(`⚠️ Falha ao re-sanitizar customization ${customization.id}:`, err);
                        }
                    }
                }
                catch (verifyErr) {
                    logger_1.default.error("Erro ao verificar registro após sanitização:", verifyErr);
                }
            }
        }
        if (!folderId) {
            return { uploadedFiles: 0 };
        }
        const folderUrl = googleDriveService_1.default.getFolderUrl(folderId);
        base64Detected = base64AffectedIds.length > 0;
        const result = {
            folderId,
            folderUrl,
            uploadedFiles,
            base64Detected,
            base64AffectedIds,
        };
        logger_1.default.info(`✅ finalizeOrderCustomizations concluído orderId=${orderId} uploads=${uploadedFiles}`);
        return result;
    }
    async listOrderCustomizations(orderId) {
        const items = await prisma_1.default.orderItem.findMany({
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
        const sanitizedItems = items.map((item) => ({
            ...item,
            customizations: (item.customizations || []).map((c) => {
                try {
                    const parsed = JSON.parse(c.value || "{}");
                    this.removeBase64FieldsRecursive(parsed);
                    return {
                        ...c,
                        value: JSON.stringify(parsed),
                    };
                }
                catch (err) {
                    // Caso parsing falhe, retornar o registro sem alteração
                    logger_1.default.warn("Erro ao sanitizar customização ao listar:", c.id, err);
                    return c;
                }
            }),
        }));
        return sanitizedItems;
    }
    parseCustomizationData(raw) {
        if (!raw)
            return {};
        try {
            return JSON.parse(raw);
        }
        catch (error) {
            return {};
        }
    }
    async computeLabelSelected(customizationType, customizationData, customizationRuleId, selectedLayoutId) {
        if (!customizationData)
            return undefined;
        // MULTIPLE_CHOICE — find the option label using provided options or DB rule
        if (customizationType === "MULTIPLE_CHOICE") {
            const selectedOption = customizationData.selected_option ||
                (Array.isArray(customizationData.selected_options)
                    ? customizationData.selected_options[0]
                    : undefined);
            if (!selectedOption)
                return undefined;
            // First try options provided by the frontend in the customization data
            const options = customizationData.options || undefined;
            if (Array.isArray(options)) {
                const opt = options.find((o) => o.id === selectedOption);
                if (opt)
                    return opt.label || opt.name || opt.title;
            }
            // Fallback: fetch customization rule and options from DB
            if (customizationRuleId) {
                try {
                    const rule = await prisma_1.default.customization.findUnique({
                        where: { id: customizationRuleId },
                    });
                    const ruleOptions = rule?.customization_data?.options || [];
                    const match = ruleOptions.find((o) => o.id === selectedOption);
                    if (match)
                        return match.label || match.name || match.title;
                }
                catch (error) {
                    // ignore DB errors and return undefined
                    console.warn("computeLabelSelected: erro ao buscar customization rule", error);
                }
            }
            return undefined;
        }
        // BASE_LAYOUT — use the provided layout id or selected_layout_id to get layout name
        if (customizationType === "BASE_LAYOUT") {
            // Try typical fields then recursively search the object for common keys
            const layoutId = selectedLayoutId ||
                customizationData.layout_id ||
                customizationData.base_layout_id ||
                this.findLayoutIdInObject(customizationData);
            if (!layoutId)
                return undefined;
            try {
                const layout = await prisma_1.default.layout.findUnique({
                    where: { id: layoutId },
                });
                return layout?.name || undefined;
            }
            catch (error) {
                logger_1.default.warn("computeLabelSelected: erro ao buscar layout", error);
                return undefined;
            }
        }
        return undefined;
    }
    // Search recursively for layout id in nested JSON structure
    findLayoutIdInObject(obj) {
        if (!obj || typeof obj !== "object")
            return undefined;
        const keys = [
            "selected_layout_id",
            "layout_id",
            "base_layout_id",
            "layoutId",
            "baseLayoutId",
        ];
        for (const k of keys) {
            if (obj[k])
                return obj[k];
        }
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (typeof value === "object" && value !== null) {
                const found = this.findLayoutIdInObject(value);
                if (found)
                    return found;
            }
        }
        return undefined;
    }
    extractArtworkAssets(data) {
        const assets = [];
        // Suporte para campo "final_artwork" (antigo)
        const single = data?.final_artwork;
        if (single) {
            assets.push(single);
        }
        // Suporte para campo "final_artworks" (antigo)
        const multiple = Array.isArray(data?.final_artworks)
            ? data.final_artworks
            : [];
        multiple.forEach((asset) => assets.push(asset));
        // ✅ NOVO: Suporte para campo "photos" do frontend
        const photos = Array.isArray(data?.photos) ? data.photos : [];
        photos.forEach((photo, index) => {
            if (photo && typeof photo === "object") {
                assets.push({
                    base64: photo.base64 || photo.base64Data,
                    base64Data: photo.base64Data || photo.base64,
                    mimeType: photo.mime_type || photo.mimeType,
                    fileName: photo.original_name || photo.fileName,
                });
            }
        });
        // ✅ NOVO: Suporte para LAYOUT_BASE - extrai imagens dos slots
        const images = Array.isArray(data?.images) ? data.images : [];
        images.forEach((image, index) => {
            if (image && typeof image === "object") {
                // LAYOUT_BASE pode ter: { slot: string, url: string (base64), ... }
                const base64Content = image.url || image.base64 || image.base64Data;
                if (base64Content) {
                    assets.push({
                        base64: base64Content,
                        base64Data: base64Content,
                        mimeType: image.mimeType || image.mime_type || "image/jpeg",
                        fileName: image.fileName ||
                            image.original_name ||
                            `layout-slot-${image.slot || index}.jpg`,
                    });
                }
            }
        });
        const filteredAssets = assets.filter((asset) => {
            const hasContent = Boolean(this.getBase64Content(asset));
            if (!hasContent) {
                // Log curto: evitar imprimir base64
                logger_1.default.debug("⚠️ Asset de arte final ignorado por estar vazio - file:", asset.fileName || "sem-nome");
            }
            return hasContent;
        });
        logger_1.default.debug(`📦 extractArtworkAssets: ${filteredAssets.length} assets extraídos (${images.length} do LAYOUT_BASE)`);
        return filteredAssets;
    }
    async uploadArtwork(asset, customization, folderId) {
        const base64Content = this.getBase64Content(asset);
        if (!base64Content) {
            throw new Error("Conteúdo base64 da arte final ausente");
        }
        const fileBuffer = Buffer.from(base64Content, "base64");
        const mimeType = asset.mimeType || "image/png";
        const extension = this.resolveExtension(mimeType);
        const fileName = asset.fileName ||
            `customization-${customization.id.slice(0, 8)}-${(0, crypto_1.randomUUID)().slice(0, 8)}.${extension}`;
        const upload = await googleDriveService_1.default.uploadBuffer(fileBuffer, fileName, folderId, mimeType);
        return {
            ...upload,
            mimeType,
            fileName,
        };
    }
    removeBase64FromData(data, uploads) {
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
                logger_1.default.info(`✅ final_artwork sanitized and uploaded: ${uploads[0]?.fileName} (driveId=${uploads[0]?.id})`);
            }
            else {
                logger_1.default.warn(`⚠️ final_artwork sanitized but no upload info found`);
            }
        }
        if (Array.isArray(sanitized.final_artworks)) {
            sanitized.final_artworks = sanitized.final_artworks.map((entry, index) => ({
                ...entry,
                base64: undefined,
                base64Data: undefined,
                mimeType: uploads[index]?.mimeType || entry?.mimeType,
                fileName: uploads[index]?.fileName || entry?.fileName,
                google_drive_file_id: uploads[index]?.id,
                google_drive_url: uploads[index]?.webContentLink,
            }));
            sanitized.final_artworks.forEach((entry, index) => {
                const up = uploads[index];
                if (up) {
                    logger_1.default.info(`✅ final_artworks[${index}] sanitized and uploaded: ${up.fileName} (driveId=${up.id})`);
                }
                else {
                    logger_1.default.warn(`⚠️ final_artworks[${index}] sanitized but no upload info found`);
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
            sanitized.photos = sanitized.photos.map((photo, idx) => {
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
                    logger_1.default.info(`✅ Photo sanitized and uploaded: ${newPhoto.fileName} (driveId=${upload.id})`);
                }
                else {
                    logger_1.default.warn(`⚠️ Photo sanitized but no upload info found for index ${idx}`);
                }
                return newPhoto;
            });
            uploadIndex += sanitized.photos.length;
        }
        // ✅ NOVO: Sanitizar LAYOUT_BASE images array
        if (Array.isArray(sanitized.images)) {
            sanitized.images = sanitized.images.map((image, idx) => {
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
                    logger_1.default.info(`✅ LAYOUT_BASE image[${idx}] (slot: ${image.slot || "unknown"}) sanitized and uploaded: ${upload.fileName} (driveId=${upload.id})`);
                }
                else {
                    logger_1.default.warn(`⚠️ LAYOUT_BASE image[${idx}] sanitized but no upload info found`);
                }
                return newImage;
            });
        }
        // ✅ NOVO: Remover base64 do campo text se for uma URL base64
        if (sanitized.text &&
            typeof sanitized.text === "string" &&
            sanitized.text.startsWith("data:image")) {
            logger_1.default.info("✅ Removendo base64 do campo 'text'");
            delete sanitized.text;
        }
        return sanitized;
    }
    getBase64Content(asset) {
        const raw = asset.base64 || asset.base64Data;
        if (!raw) {
            return null;
        }
        const prefixPattern = /^data:[^;]+;base64,/;
        return raw.replace(prefixPattern, "");
    }
    removeBase64FieldsRecursive(obj) {
        if (!obj || typeof obj !== "object")
            return 0;
        let removedCount = 0;
        if (Array.isArray(obj)) {
            obj.forEach((item) => (removedCount += this.removeBase64FieldsRecursive(item) || 0));
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
    resolveExtension(mimeType) {
        const map = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/svg+xml": "svg",
            "application/pdf": "pdf",
        };
        return map[mimeType] || "png";
    }
    slugify(value) {
        return value
            .normalize("NFD")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/[-\s]+/g, "-")
            .toLowerCase();
    }
}
exports.default = new OrderCustomizationService();
