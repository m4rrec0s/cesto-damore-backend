"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../database/prisma"));
const orderCustomizationService_1 = __importDefault(require("../services/orderCustomizationService"));
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
                orderId: uuidSchema,
                itemId: uuidSchema,
            });
            const { orderId, itemId } = paramsSchema.parse(req.params);
            const payload = customizationPayloadSchema.parse(req.body);
            await orderCustomizationService_1.default.ensureOrderItem(orderId, itemId);
            const customizationData = {
                ...payload.data,
            };
            if (payload.finalArtwork) {
                customizationData.final_artwork = payload.finalArtwork;
            }
            if (payload.finalArtworks) {
                customizationData.final_artworks = payload.finalArtworks;
            }
            const record = await orderCustomizationService_1.default.saveOrderItemCustomization({
                orderItemId: itemId,
                customizationRuleId: payload.customizationRuleId,
                customizationType: payload.customizationType,
                title: payload.title,
                customizationData,
                selectedLayoutId: payload.selectedLayoutId,
            });
            return res.status(201).json(record);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao salvar customização do item:", error);
            return res.status(500).json({
                error: "Erro ao salvar customização",
                details: error.message,
            });
        }
    }
}
exports.default = new OrderCustomizationController();
