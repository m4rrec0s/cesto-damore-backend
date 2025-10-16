"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const customizationService_1 = __importDefault(require("../services/customizationService"));
const customizationInputSchema = zod_1.z.object({
    customization_id: zod_1.z.string().uuid(),
    customization_type: zod_1.z.nativeEnum(client_1.CustomizationType),
    data: zod_1.z.record(zod_1.z.any()),
});
class CustomizationController {
    /**
     * Busca customizações disponíveis para um item
     */
    async getItemCustomizations(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                itemId: zod_1.z.string().uuid({ message: "itemId inválido" }),
            });
            const { itemId } = paramsSchema.parse(req.params);
            const config = await customizationService_1.default.getItemCustomizations(itemId);
            return res.json(config);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao buscar customizações:", error);
            return res.status(500).json({
                error: "Erro ao buscar customizações",
                details: error.message,
            });
        }
    }
    /**
     * Valida customizações de um item
     */
    async validateCustomizations(req, res) {
        try {
            const bodySchema = zod_1.z.object({
                itemId: zod_1.z.string().uuid({ message: "itemId inválido" }),
                inputs: zod_1.z.array(customizationInputSchema).default([]),
            });
            const payload = bodySchema.parse(req.body);
            const validation = await customizationService_1.default.validateCustomizations(payload);
            return res.json(validation);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao validar customizações:", error);
            return res.status(500).json({
                error: "Erro ao validar customizações",
                details: error.message,
            });
        }
    }
    /**
     * Gera preview de customizações
     */
    async buildPreview(req, res) {
        try {
            const bodySchema = zod_1.z.object({
                itemId: zod_1.z.string().uuid({ message: "itemId inválido" }),
                customizations: zod_1.z
                    .array(customizationInputSchema)
                    .min(1, "Forneça ao menos uma customização"),
            });
            const payload = bodySchema.parse(req.body);
            const preview = await customizationService_1.default.buildPreviewPayload(payload);
            return res.json(preview);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao gerar preview:", error);
            return res.status(500).json({
                error: "Erro ao gerar preview",
                details: error.message,
            });
        }
    }
}
exports.default = new CustomizationController();
