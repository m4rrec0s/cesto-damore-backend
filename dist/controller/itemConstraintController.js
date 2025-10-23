"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../database/prisma"));
const uuidSchema = zod_1.z.string().uuid({ message: "Identificador inválido" });
const itemTypeSchema = zod_1.z.enum(["PRODUCT", "ADDITIONAL"]);
const constraintTypeSchema = zod_1.z.enum(["MUTUALLY_EXCLUSIVE", "REQUIRES"]);
const itemConstraintInputSchema = zod_1.z.object({
    target_item_id: uuidSchema,
    target_item_type: itemTypeSchema,
    constraint_type: constraintTypeSchema,
    related_item_id: uuidSchema,
    related_item_type: itemTypeSchema,
    message: zod_1.z.string().optional(),
});
class ItemConstraintController {
    /**
     * Lista todos os constraints
     * GET /admin/constraints
     */
    async listAll(req, res) {
        try {
            const constraints = await prisma_1.default.itemConstraint.findMany({
                orderBy: { created_at: "desc" },
            });
            return res.json(constraints);
        }
        catch (error) {
            console.error("Erro ao listar constraints:", error);
            return res.status(500).json({
                error: "Erro ao listar constraints",
                details: error.message,
            });
        }
    }
    /**
     * Lista constraints de um item específico
     * GET /admin/constraints/item/:itemType/:itemId
     */
    async getByItem(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                itemType: itemTypeSchema,
                itemId: uuidSchema,
            });
            const { itemType, itemId } = paramsSchema.parse(req.params);
            const constraints = await prisma_1.default.itemConstraint.findMany({
                where: {
                    OR: [
                        { target_item_id: itemId, target_item_type: itemType },
                        { related_item_id: itemId, related_item_type: itemType },
                    ],
                },
                orderBy: { created_at: "desc" },
            });
            return res.json(constraints);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao buscar constraints:", error);
            return res.status(500).json({
                error: "Erro ao buscar constraints",
                details: error.message,
            });
        }
    }
    /**
     * Cria um novo constraint
     * POST /admin/constraints
     */
    async create(req, res) {
        try {
            const payload = itemConstraintInputSchema.parse(req.body);
            // Buscar nomes dos itens para cache
            let targetItemName = null;
            let relatedItemName = null;
            if (payload.target_item_type === "PRODUCT") {
                const product = await prisma_1.default.product.findUnique({
                    where: { id: payload.target_item_id },
                    select: { name: true },
                });
                targetItemName = product?.name || null;
            }
            else {
                const additional = await prisma_1.default.item.findUnique({
                    where: { id: payload.target_item_id },
                    select: { name: true },
                });
                targetItemName = additional?.name || null;
            }
            if (payload.related_item_type === "PRODUCT") {
                const product = await prisma_1.default.product.findUnique({
                    where: { id: payload.related_item_id },
                    select: { name: true },
                });
                relatedItemName = product?.name || null;
            }
            else {
                const additional = await prisma_1.default.item.findUnique({
                    where: { id: payload.related_item_id },
                    select: { name: true },
                });
                relatedItemName = additional?.name || null;
            }
            // Verificar se já existe um constraint igual
            const existing = await prisma_1.default.itemConstraint.findFirst({
                where: {
                    target_item_id: payload.target_item_id,
                    target_item_type: payload.target_item_type,
                    related_item_id: payload.related_item_id,
                    related_item_type: payload.related_item_type,
                    constraint_type: payload.constraint_type,
                },
            });
            if (existing) {
                return res.status(409).json({
                    error: "Constraint já existe",
                    constraint: existing,
                });
            }
            const constraint = await prisma_1.default.itemConstraint.create({
                data: {
                    target_item_id: payload.target_item_id,
                    target_item_type: payload.target_item_type,
                    target_item_name: targetItemName,
                    constraint_type: payload.constraint_type,
                    related_item_id: payload.related_item_id,
                    related_item_type: payload.related_item_type,
                    related_item_name: relatedItemName,
                    message: payload.message || null,
                },
            });
            return res.status(201).json(constraint);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao criar constraint:", error);
            return res.status(500).json({
                error: "Erro ao criar constraint",
                details: error.message,
            });
        }
    }
    /**
     * Atualiza um constraint
     * PUT /admin/constraints/:constraintId
     */
    async update(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                constraintId: uuidSchema,
            });
            const { constraintId } = paramsSchema.parse(req.params);
            const payload = itemConstraintInputSchema.partial().parse(req.body);
            // Verificar se o constraint existe
            const existing = await prisma_1.default.itemConstraint.findUnique({
                where: { id: constraintId },
            });
            if (!existing) {
                return res.status(404).json({
                    error: "Constraint não encontrado",
                });
            }
            const updateData = {};
            if (payload.target_item_id !== undefined) {
                updateData.target_item_id = payload.target_item_id;
                updateData.target_item_type = payload.target_item_type;
                // Atualizar cache do nome
                if (payload.target_item_type === "PRODUCT") {
                    const product = await prisma_1.default.product.findUnique({
                        where: { id: payload.target_item_id },
                        select: { name: true },
                    });
                    updateData.target_item_name = product?.name || null;
                }
                else {
                    const additional = await prisma_1.default.item.findUnique({
                        where: { id: payload.target_item_id },
                        select: { name: true },
                    });
                    updateData.target_item_name = additional?.name || null;
                }
            }
            if (payload.related_item_id !== undefined) {
                updateData.related_item_id = payload.related_item_id;
                updateData.related_item_type = payload.related_item_type;
                // Atualizar cache do nome
                if (payload.related_item_type === "PRODUCT") {
                    const product = await prisma_1.default.product.findUnique({
                        where: { id: payload.related_item_id },
                        select: { name: true },
                    });
                    updateData.related_item_name = product?.name || null;
                }
                else {
                    const additional = await prisma_1.default.item.findUnique({
                        where: { id: payload.related_item_id },
                        select: { name: true },
                    });
                    updateData.related_item_name = additional?.name || null;
                }
            }
            if (payload.constraint_type !== undefined)
                updateData.constraint_type = payload.constraint_type;
            if (payload.message !== undefined)
                updateData.message = payload.message || null;
            const constraint = await prisma_1.default.itemConstraint.update({
                where: { id: constraintId },
                data: updateData,
            });
            return res.json(constraint);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao atualizar constraint:", error);
            return res.status(500).json({
                error: "Erro ao atualizar constraint",
                details: error.message,
            });
        }
    }
    /**
     * Deleta um constraint
     * DELETE /admin/constraints/:constraintId
     */
    async delete(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                constraintId: uuidSchema,
            });
            const { constraintId } = paramsSchema.parse(req.params);
            // Verificar se o constraint existe
            const existing = await prisma_1.default.itemConstraint.findUnique({
                where: { id: constraintId },
            });
            if (!existing) {
                return res.status(404).json({
                    error: "Constraint não encontrado",
                });
            }
            await prisma_1.default.itemConstraint.delete({
                where: { id: constraintId },
            });
            return res.json({
                message: "Constraint deletado com sucesso",
            });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao deletar constraint:", error);
            return res.status(500).json({
                error: "Erro ao deletar constraint",
                details: error.message,
            });
        }
    }
    /**
     * Busca produtos e adicionais para autocomplete
     * GET /admin/constraints/search?q=termo
     */
    async searchItems(req, res) {
        try {
            const querySchema = zod_1.z.object({
                q: zod_1.z.string().min(1, "Termo de busca é obrigatório"),
            });
            const { q } = querySchema.parse(req.query);
            const [products, additionals] = await Promise.all([
                prisma_1.default.product.findMany({
                    where: {
                        name: {
                            contains: q,
                            mode: "insensitive",
                        },
                    },
                    select: {
                        id: true,
                        name: true,
                        image_url: true,
                    },
                    take: 10,
                }),
                prisma_1.default.item.findMany({
                    where: {
                        name: {
                            contains: q,
                            mode: "insensitive",
                        },
                    },
                    select: {
                        id: true,
                        name: true,
                        image_url: true,
                    },
                    take: 10,
                }),
            ]);
            return res.json({
                products: products.map((p) => ({
                    id: p.id,
                    name: p.name,
                    type: "PRODUCT",
                    image_url: p.image_url,
                })),
                additionals: additionals.map((a) => ({
                    id: a.id,
                    name: a.name,
                    type: "ADDITIONAL",
                    image_url: a.image_url,
                })),
            });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao buscar itens:", error);
            return res.status(500).json({
                error: "Erro ao buscar itens",
                details: error.message,
            });
        }
    }
}
exports.default = new ItemConstraintController();
