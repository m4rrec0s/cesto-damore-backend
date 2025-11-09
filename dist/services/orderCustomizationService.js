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
        console.log("🎨 Iniciando finalização de customizações para pedido:", orderId);
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
        console.log("📦 Pedido encontrado:", {
            orderId: order.id,
            itemsCount: order.items.length,
            userName: order.user?.name,
        });
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
            console.log(`📝 Processando item: ${item.product.name} (${item.customizations.length} customizações)`);
            for (const customization of item.customizations) {
                const data = this.parseCustomizationData(customization.value);
                const artworks = this.extractArtworkAssets(data);
                console.log(`🎨 Customização ${customization.id}:`, JSON.stringify({
                    customizationId: customization.customization_id,
                    hasData: !!data,
                    dataKeys: data ? Object.keys(data) : [],
                    hasPhotos: Boolean(data?.photos),
                    photosCount: Array.isArray(data?.photos) ? data.photos.length : 0,
                    hasFinalArtwork: Boolean(data?.final_artwork),
                    hasFinalArtworks: Boolean(data?.final_artworks),
                    artworksCount: artworks.length,
                }, null, 2));
                if (artworks.length === 0) {
                    console.log("⚠️ Nenhuma arte final encontrada, pulando...");
                    continue;
                }
                console.log(`📁 Criando/obtendo pasta no Google Drive...`);
                const targetFolder = await ensureFolder();
                console.log(`📤 Fazendo upload de ${artworks.length} arquivo(s)...`);
                const uploads = await Promise.all(artworks.map((asset) => this.uploadArtwork(asset, { id: customization.id }, targetFolder)));
                uploadedFiles += uploads.length;
                console.log(`✅ ${uploads.length} arquivo(s) enviado(s) com sucesso!`);
                const sanitizedData = this.removeBase64FromData(data, uploads);
                await prisma_1.default.orderItemCustomization.update({
                    where: { id: customization.id },
                    data: {
                        value: JSON.stringify(sanitizedData),
                        google_drive_folder_id: targetFolder,
                        google_drive_url: googleDriveService_1.default.getFolderUrl(targetFolder),
                    },
                });
                console.log(`💾 Customização atualizada no banco com URL do Google Drive`);
            }
        }
        if (!folderId) {
            console.log("ℹ️ Nenhuma customização com artes finais para fazer upload");
            return { uploadedFiles: 0 };
        }
        const folderUrl = googleDriveService_1.default.getFolderUrl(folderId);
        console.log("✅ Finalização concluída:", {
            folderId,
            folderUrl,
            uploadedFiles,
        });
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
        console.log(`📸 Processando ${photos.length} foto(s):`, JSON.stringify(photos, null, 2));
        photos.forEach((photo, index) => {
            // Converter estrutura de "photos" para ArtworkAsset
            if (photo && typeof photo === "object") {
                console.log(`📷 Foto ${index + 1} - Campos disponíveis:`, Object.keys(photo));
                console.log(`📷 Foto ${index + 1} - Dados:`, JSON.stringify({
                    hasBase64: Boolean(photo.base64),
                    hasBase64Data: Boolean(photo.base64Data),
                    hasTempFileId: Boolean(photo.temp_file_id),
                    hasPreviewUrl: Boolean(photo.preview_url),
                    mimeType: photo.mime_type || photo.mimeType,
                    fileName: photo.original_name || photo.fileName,
                }, null, 2));
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
                console.log(`⚠️ Asset filtrado (sem base64):`, JSON.stringify({
                    hasBase64: Boolean(asset.base64),
                    hasBase64Data: Boolean(asset.base64Data),
                    mimeType: asset.mimeType,
                    fileName: asset.fileName,
                }, null, 2));
            }
            return hasContent;
        });
        console.log(`✅ Total de assets extraídos: ${assets.length}, Após filtro: ${filteredAssets.length}`);
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
