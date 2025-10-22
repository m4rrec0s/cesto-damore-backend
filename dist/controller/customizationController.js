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
    /**
     * Lista todas as customizações (com filtro opcional por item)
     */
    async index(req, res) {
        try {
            const querySchema = zod_1.z.object({
                itemId: zod_1.z.string().uuid().optional(),
            });
            const { itemId } = querySchema.parse(req.query);
            const customizations = await customizationService_1.default.listAll(itemId);
            return res.json(customizations);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao listar customizações:", error);
            return res.status(500).json({
                error: "Erro ao listar customizações",
                details: error.message,
            });
        }
    }
    /**
     * Busca uma customização por ID
     */
    async show(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                id: zod_1.z.string().uuid({ message: "ID inválido" }),
            });
            const { id } = paramsSchema.parse(req.params);
            const customization = await customizationService_1.default.getById(id);
            return res.json(customization);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            if (error.message === "Customização não encontrada") {
                return res.status(404).json({ error: error.message });
            }
            console.error("Erro ao buscar customização:", error);
            return res.status(500).json({
                error: "Erro ao buscar customização",
                details: error.message,
            });
        }
    }
    /**
     * Cria uma nova customização
     */
    async create(req, res) {
        try {
            const bodySchema = zod_1.z.object({
                item_id: zod_1.z.string().uuid({ message: "item_id inválido" }),
                type: zod_1.z.nativeEnum(client_1.CustomizationType),
                name: zod_1.z.string().min(1, "Nome é obrigatório"),
                description: zod_1.z.string().optional(),
                isRequired: zod_1.z.boolean().default(false),
                customization_data: zod_1.z.record(zod_1.z.any()),
                price: zod_1.z.number().min(0).default(0),
            });
            const payload = bodySchema.parse(req.body);
            const customization = await customizationService_1.default.create(payload);
            return res.status(201).json(customization);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao criar customização:", error);
            return res.status(500).json({
                error: "Erro ao criar customização",
                details: error.message,
            });
        }
    }
    /**
     * Atualiza uma customização existente
     */
    async update(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                id: zod_1.z.string().uuid({ message: "ID inválido" }),
            });
            const bodySchema = zod_1.z.object({
                name: zod_1.z.string().min(1).optional(),
                description: zod_1.z.string().optional(),
                isRequired: zod_1.z.boolean().optional(),
                customization_data: zod_1.z.record(zod_1.z.any()).optional(),
                price: zod_1.z.number().min(0).optional(),
            });
            const { id } = paramsSchema.parse(req.params);
            const payload = bodySchema.parse(req.body);
            const customization = await customizationService_1.default.update(id, payload);
            return res.json(customization);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            if (error.message === "Customização não encontrada") {
                return res.status(404).json({ error: error.message });
            }
            console.error("Erro ao atualizar customização:", error);
            return res.status(500).json({
                error: "Erro ao atualizar customização",
                details: error.message,
            });
        }
    }
    /**
     * Remove uma customização
     */
    async remove(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                id: zod_1.z.string().uuid({ message: "ID inválido" }),
            });
            const { id } = paramsSchema.parse(req.params);
            await customizationService_1.default.delete(id);
            return res.status(204).send();
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            if (error.message === "Customização não encontrada") {
                return res.status(404).json({ error: error.message });
            }
            console.error("Erro ao remover customização:", error);
            return res.status(500).json({
                error: "Erro ao remover customização",
                details: error.message,
            });
        }
    }
}
exports.default = new CustomizationController();
