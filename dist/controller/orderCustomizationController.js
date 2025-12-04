"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../database/prisma"));
const orderCustomizationService_1 = __importDefault(require("../services/orderCustomizationService"));
const tempFileService_1 = __importDefault(require("../services/tempFileService"));
const logger_1 = __importDefault(require("../utils/logger"));
const uuidSchema = zod_1.z.string().uuid({ message: "Identificador inválido" });
const artworkSchema = zod_1.z.object({
    base64: zod_1.z.string().min(1, "Conteúdo base64 obrigatório"),
    mimeType: zod_1.z.string().optional(),
    fileName: zod_1.z.string().optional(),
});
const customizationPayloadSchema = zod_1.z.object({
    customizationRuleId: uuidSchema.optional().nullable(),
    customizationType: zod_1.z.nativeEnum(client_1.CustomizationType),
    title: zod_1.z.string().min(1),
    selectedLayoutId: uuidSchema.optional().nullable(),
    data: zod_1.z.record(zod_1.z.any()).default({}),
    finalArtwork: artworkSchema.optional(),
    finalArtworks: zod_1.z.array(artworkSchema).optional(),
});
class OrderCustomizationController {
    /**
     * Converte base64 para arquivo temporário
     * Suporta:
     * - data:image/jpeg;base64,/9j/4AAQ...
     * - /9j/4AAQ... (raw base64)
     */
    async convertBase64ToFile(base64String, fileName = "artwork") {
        try {
            let buffer;
            // Se começar com data:, extrair apenas o conteúdo base64
            if (base64String.startsWith("data:")) {
                const matches = base64String.match(/data:[^;]+;base64,(.+)/);
                if (!matches) {
                    logger_1.default.warn(`❌ Formato base64 inválido: ${base64String.substring(0, 50)}`);
                    return null;
                }
                buffer = Buffer.from(matches[1], "base64");
            }
            else {
                // Raw base64
                buffer = Buffer.from(base64String, "base64");
            }
            // Salvar arquivo em /app/storage/temp
            const result = await tempFileService_1.default.saveFile(buffer, fileName);
            logger_1.default.info(`✅ Base64 convertido para arquivo: ${result.filename}`);
            return result.url;
        }
        catch (error) {
            logger_1.default.error(`❌ Erro ao converter base64: ${error.message}`);
            return null;
        }
    }
    /**
     * Processa recursivamente o payload para converter base64 em URLs temporárias
     */
    async processBase64InData(data) {
        if (!data)
            return data;
        // Se for array
        if (Array.isArray(data)) {
            return Promise.all(data.map((item) => this.processBase64InData(item)));
        }
        // Se for objeto
        if (typeof data === "object") {
            const processed = {};
            for (const [key, value] of Object.entries(data)) {
                // Se for campo com base64
                if ((key.includes("base64") ||
                    key === "artwork" ||
                    key === "finalArtwork" ||
                    key.includes("photo")) &&
                    typeof value === "object") {
                    const obj = value;
                    // Se tiver campo base64, converter para URL
                    if (obj.base64 && typeof obj.base64 === "string") {
                        const url = await this.convertBase64ToFile(obj.base64, obj.fileName || "artwork");
                        if (url) {
                            processed[key] = { ...obj, preview_url: url, base64: undefined };
                            logger_1.default.debug(`✅ Convertido ${key} base64 para URL: ${url}`);
                        }
                        else {
                            processed[key] = obj;
                        }
                    }
                    else {
                        processed[key] = await this.processBase64InData(value);
                    }
                }
                else if (typeof value === "object" && value !== null) {
                    processed[key] = await this.processBase64InData(value);
                }
                else {
                    processed[key] = value;
                }
            }
            return processed;
        }
        return data;
    }
    async listOrderCustomizations(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                orderId: uuidSchema,
            });
            const { orderId } = paramsSchema.parse(req.params);
            const order = await prisma_1.default.order.findUnique({
                where: { id: orderId },
                select: { id: true },
            });
            if (!order) {
                return res.status(404).json({ error: "Pedido não encontrado" });
            }
            const items = await orderCustomizationService_1.default.listOrderCustomizations(orderId);
            return res.json({
                orderId,
                items,
            });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao listar customizações do pedido:", error);
            return res.status(500).json({
                error: "Erro ao listar customizações",
                details: error.message,
            });
        }
    }
    async saveOrderItemCustomization(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                orderId: zod_1.z.string().uuid({ message: "Identificador inválido" }),
                itemId: zod_1.z.string().uuid({ message: "Identificador inválido" }),
            });
            const { orderId, itemId } = paramsSchema.parse(req.params);
            const payload = customizationPayloadSchema.parse(req.body);
            await orderCustomizationService_1.default.ensureOrderItem(orderId, itemId);
            // ✅ NOVO: Processar base64 antes de salvar
            logger_1.default.info(`📝 Processando customização com base64... tipo=${payload.customizationType}`);
            const customizationData = {
                ...payload.data,
            };
            // Se tiver finalArtwork com base64, converter para arquivo
            if (payload.finalArtwork && payload.finalArtwork.base64) {
                const url = await this.convertBase64ToFile(payload.finalArtwork.base64, payload.finalArtwork.fileName || "artwork");
                if (url) {
                    customizationData.final_artwork = {
                        ...payload.finalArtwork,
                        preview_url: url,
                        base64: undefined,
                    };
                    logger_1.default.info(`✅ finalArtwork convertido para: ${url}`);
                }
            }
            else if (payload.finalArtwork) {
                customizationData.final_artwork = payload.finalArtwork;
            }
            // Se tiver finalArtworks (array), converter cada um
            if (payload.finalArtworks && Array.isArray(payload.finalArtworks)) {
                customizationData.final_artworks = await Promise.all(payload.finalArtworks.map(async (artwork) => {
                    if (artwork.base64) {
                        const url = await this.convertBase64ToFile(artwork.base64, artwork.fileName || "artwork");
                        if (url) {
                            logger_1.default.info(`✅ finalArtwork (array) convertido para: ${url}`);
                            return {
                                ...artwork,
                                preview_url: url,
                                base64: undefined,
                            };
                        }
                    }
                    return artwork;
                }));
            }
            // ✅ NOVO: Processar recursivamente qualquer base64 nos dados
            const processedData = await this.processBase64InData(customizationData);
            const record = await orderCustomizationService_1.default.saveOrderItemCustomization({
                orderItemId: itemId,
                customizationRuleId: payload.customizationRuleId,
                customizationType: payload.customizationType,
                title: payload.title,
                customizationData: processedData,
                selectedLayoutId: payload.selectedLayoutId,
            });
            logger_1.default.info(`✅ Customização salva com sucesso: ${record.id}`);
            return res.status(201).json(record);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            logger_1.default.error("Erro ao salvar customização do item:", error);
            return res.status(500).json({
                error: "Erro ao salvar customização",
                details: error.message,
            });
        }
    }
}
exports.default = new OrderCustomizationController();
