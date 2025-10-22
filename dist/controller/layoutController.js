"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../database/prisma"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LayoutController {
    /**
     * Lista todos os layouts (com filtro opcional por item)
     */
    async index(req, res) {
        try {
            const querySchema = zod_1.z.object({
                itemId: zod_1.z.string().uuid().optional(),
            });
            const { itemId } = querySchema.parse(req.query);
            const layouts = await prisma_1.default.layout.findMany({
                where: itemId ? { item_id: itemId } : undefined,
                orderBy: { created_at: "desc" },
            });
            return res.json(layouts);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao listar layouts:", error);
            return res.status(500).json({
                error: "Erro ao listar layouts",
                details: error.message,
            });
        }
    }
    /**
     * Busca um layout por ID
     */
    async show(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                id: zod_1.z.string().uuid({ message: "ID inválido" }),
            });
            const { id } = paramsSchema.parse(req.params);
            const layout = await prisma_1.default.layout.findUnique({
                where: { id },
            });
            if (!layout) {
                return res.status(404).json({ error: "Layout não encontrado" });
            }
            return res.json(layout);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao buscar layout:", error);
            return res.status(500).json({
                error: "Erro ao buscar layout",
                details: error.message,
            });
        }
    }
    /**
     * Cria um novo layout 3D
     */
    async create(req, res) {
        try {
            const bodySchema = zod_1.z.object({
                item_id: zod_1.z.string().uuid({ message: "item_id inválido" }),
                name: zod_1.z.string().min(1, "Nome é obrigatório"),
                layout_data: zod_1.z.object({
                    model_url: zod_1.z.string().url("URL do modelo 3D é obrigatória"),
                    print_areas: zod_1.z
                        .array(zod_1.z.object({
                        id: zod_1.z.string(),
                        name: zod_1.z.string(),
                        position: zod_1.z.object({
                            x: zod_1.z.number(),
                            y: zod_1.z.number(),
                            z: zod_1.z.number(),
                        }),
                        rotation: zod_1.z.object({
                            x: zod_1.z.number(),
                            y: zod_1.z.number(),
                            z: zod_1.z.number(),
                        }),
                        scale: zod_1.z.object({
                            width: zod_1.z.number(),
                            height: zod_1.z.number(),
                        }),
                    }))
                        .optional(),
                    camera_position: zod_1.z
                        .object({
                        x: zod_1.z.number(),
                        y: zod_1.z.number(),
                        z: zod_1.z.number(),
                    })
                        .optional(),
                    camera_target: zod_1.z
                        .object({
                        x: zod_1.z.number(),
                        y: zod_1.z.number(),
                        z: zod_1.z.number(),
                    })
                        .optional(),
                }),
            });
            const payload = bodySchema.parse(req.body);
            // Verificar se o item existe
            const item = await prisma_1.default.item.findUnique({
                where: { id: payload.item_id },
            });
            if (!item) {
                return res.status(404).json({ error: "Item não encontrado" });
            }
            const layout = await prisma_1.default.layout.create({
                data: {
                    item_id: payload.item_id,
                    name: payload.name,
                    image_url: payload.layout_data.model_url, // Preview image (pode ser screenshot do modelo)
                    layout_data: payload.layout_data,
                },
            });
            return res.status(201).json(layout);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao criar layout:", error);
            return res.status(500).json({
                error: "Erro ao criar layout",
                details: error.message,
            });
        }
    }
    /**
     * Atualiza um layout existente
     */
    async update(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                id: zod_1.z.string().uuid({ message: "ID inválido" }),
            });
            const bodySchema = zod_1.z.object({
                name: zod_1.z.string().min(1).optional(),
                layout_data: zod_1.z
                    .object({
                    model_url: zod_1.z.string().url().optional(),
                    print_areas: zod_1.z
                        .array(zod_1.z.object({
                        id: zod_1.z.string(),
                        name: zod_1.z.string(),
                        position: zod_1.z.object({
                            x: zod_1.z.number(),
                            y: zod_1.z.number(),
                            z: zod_1.z.number(),
                        }),
                        rotation: zod_1.z.object({
                            x: zod_1.z.number(),
                            y: zod_1.z.number(),
                            z: zod_1.z.number(),
                        }),
                        scale: zod_1.z.object({
                            width: zod_1.z.number(),
                            height: zod_1.z.number(),
                        }),
                    }))
                        .optional(),
                    camera_position: zod_1.z
                        .object({
                        x: zod_1.z.number(),
                        y: zod_1.z.number(),
                        z: zod_1.z.number(),
                    })
                        .optional(),
                    camera_target: zod_1.z
                        .object({
                        x: zod_1.z.number(),
                        y: zod_1.z.number(),
                        z: zod_1.z.number(),
                    })
                        .optional(),
                })
                    .optional(),
            });
            const { id } = paramsSchema.parse(req.params);
            const payload = bodySchema.parse(req.body);
            const existing = await prisma_1.default.layout.findUnique({
                where: { id },
            });
            if (!existing) {
                return res.status(404).json({ error: "Layout não encontrado" });
            }
            const layout = await prisma_1.default.layout.update({
                where: { id },
                data: {
                    name: payload.name,
                    image_url: payload.layout_data?.model_url,
                    layout_data: payload.layout_data,
                },
            });
            return res.json(layout);
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Dados inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao atualizar layout:", error);
            return res.status(500).json({
                error: "Erro ao atualizar layout",
                details: error.message,
            });
        }
    }
    /**
     * Remove um layout
     */
    async remove(req, res) {
        try {
            const paramsSchema = zod_1.z.object({
                id: zod_1.z.string().uuid({ message: "ID inválido" }),
            });
            const { id } = paramsSchema.parse(req.params);
            const layout = await prisma_1.default.layout.findUnique({
                where: { id },
            });
            if (!layout) {
                return res.status(404).json({ error: "Layout não encontrado" });
            }
            // Deletar arquivo 3D se existir localmente
            const layoutData = layout.layout_data;
            if (layoutData?.model_url && !layoutData.model_url.startsWith("http")) {
                const modelPath = path_1.default.join(__dirname, "../../", layoutData.model_url);
                if (fs_1.default.existsSync(modelPath)) {
                    fs_1.default.unlinkSync(modelPath);
                }
            }
            await prisma_1.default.layout.delete({
                where: { id },
            });
            return res.status(204).send();
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return res.status(400).json({
                    error: "Parâmetros inválidos",
                    details: error.issues,
                });
            }
            console.error("Erro ao remover layout:", error);
            return res.status(500).json({
                error: "Erro ao remover layout",
                details: error.message,
            });
        }
    }
    /**
     * Upload de arquivo 3D (.glb, .gltf)
     */
    async upload3DModel(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "Arquivo não fornecido" });
            }
            const allowedExtensions = [".glb", ".gltf"];
            const fileExtension = path_1.default.extname(req.file.originalname).toLowerCase();
            if (!allowedExtensions.includes(fileExtension)) {
                // Remover arquivo se não for válido
                fs_1.default.unlinkSync(req.file.path);
                return res.status(400).json({
                    error: "Formato de arquivo inválido. Apenas .glb e .gltf são permitidos",
                });
            }
            const modelUrl = `/3d-models/${req.file.filename}`;
            return res.json({
                success: true,
                url: modelUrl,
                filename: req.file.filename,
                size: req.file.size,
            });
        }
        catch (error) {
            console.error("Erro ao fazer upload do modelo 3D:", error);
            return res.status(500).json({
                error: "Erro ao fazer upload do modelo 3D",
                details: error.message,
            });
        }
    }
}
exports.default = new LayoutController();
