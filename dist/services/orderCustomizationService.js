"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../database/prisma"));
const googleDriveService_1 = __importDefault(require("./googleDriveService"));
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
                const data = this.parseCustomizationData(customization.value);
                const artworks = this.extractArtworkAssets(data);
                if (artworks.length === 0) {
                    continue;
                }
                const targetFolder = await ensureFolder();
                const uploads = await Promise.all(artworks.map((asset) => this.uploadArtwork(asset, { id: customization.id }, targetFolder)));
                uploadedFiles += uploads.length;
                const sanitizedData = this.removeBase64FromData(data, uploads);
                await prisma_1.default.orderItemCustomization.update({
                    where: { id: customization.id },
                    data: {
                        value: JSON.stringify(sanitizedData),
                        google_drive_folder_id: targetFolder,
                        google_drive_url: googleDriveService_1.default.getFolderUrl(targetFolder),
                    },
                });
            }
        }
        if (!folderId) {
            return { uploadedFiles: 0 };
        }
        const folderUrl = googleDriveService_1.default.getFolderUrl(folderId);
        return {
            folderId,
            folderUrl,
            uploadedFiles,
        };
    }
    async listOrderCustomizations(orderId) {
        return prisma_1.default.orderItem.findMany({
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
        const filteredAssets = assets.filter((asset) => {
            const hasContent = Boolean(this.getBase64Content(asset));
            if (!hasContent) {
                console.log("⚠️ Asset de arte final ignorado por estar vazio", asset);
            }
            return hasContent;
        });
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
