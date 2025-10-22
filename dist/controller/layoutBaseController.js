"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const layoutBaseService_1 = __importDefault(require("../services/layoutBaseService"));
const googleDriveService_1 = __importDefault(require("../services/googleDriveService"));
// IDs das pastas específicas no Google Drive
const DRIVE_FOLDERS = {
    CANECA: "1pflj6i9D0rEFGzN3CClppXXeoOyGG07b",
    QUADRO: "1P-oQM1wd66Y8SGkZKae2TWPR6ISsWvEB",
};
class LayoutBaseController {
    /**
     * POST /admin/layouts
     * Criar novo layout base
     */
    async create(req, res) {
        try {
            const { name, item_type, width, height, slots } = req.body;
            // Validar campos obrigatórios
            if (!name || !item_type || !width || !height) {
                return res.status(400).json({
                    error: "Campos obrigatórios: name, item_type, width, height",
                });
            }
            // Validar tipo de item
            if (!["CANECA", "QUADRO"].includes(item_type)) {
                return res.status(400).json({
                    error: "Tipo de item inválido. Valores permitidos: CANECA, QUADRO",
                });
            }
            // Validar se tem arquivo
            if (!req.file) {
                return res.status(400).json({
                    error: "Imagem do layout é obrigatória",
                });
            }
            // Selecionar pasta do Google Drive baseada no tipo
            const folderId = DRIVE_FOLDERS[item_type];
            // Gerar nome único mantendo a extensão original
            const timestamp = Date.now();
            const randomSuffix = Math.round(Math.random() * 1e9);
            const originalExt = req.file.originalname.split(".").pop();
            const fileName = `layout-${timestamp}-${randomSuffix}.${originalExt}`;
            // Upload para o Google Drive
            console.log(`📤 Fazendo upload de layout ${item_type} para o Google Drive...`);
            const uploadedFile = await googleDriveService_1.default.uploadBuffer(req.file.buffer, fileName, folderId, req.file.mimetype);
            // Usar a URL de visualização do Google Drive (não download)
            const image_url = uploadedFile.webViewLink;
            console.log(`✅ Imagem salva no Google Drive: ${image_url}`);
            // Slots são opcionais - alguns layouts podem não ter personalização
            const parsedSlots = slots ? JSON.parse(slots) : [];
            // Criar layout
            const layoutBase = await layoutBaseService_1.default.create({
                name,
                item_type,
                image_url,
                width: parseInt(width),
                height: parseInt(height),
                slots: parsedSlots,
            });
            return res.status(201).json(layoutBase);
        }
        catch (error) {
            console.error("Erro ao criar layout base:", error);
            return res.status(400).json({
                error: error instanceof Error ? error.message : "Erro ao criar layout base",
            });
        }
    }
    /**
     * GET /admin/layouts
     * Listar layouts
     */
    async list(req, res) {
        try {
            const { item_type } = req.query;
            const layouts = await layoutBaseService_1.default.list(item_type);
            return res.json(layouts);
        }
        catch (error) {
            console.error("Erro ao listar layouts:", error);
            return res.status(500).json({
                error: "Erro ao listar layouts",
            });
        }
    }
    /**
     * GET /admin/layouts/:id
     * Buscar layout por ID
     */
    async show(req, res) {
        try {
            const { id } = req.params;
            const layoutBase = await layoutBaseService_1.default.getById(id);
            return res.json(layoutBase);
        }
        catch (error) {
            console.error("Erro ao buscar layout:", error);
            return res.status(404).json({
                error: error instanceof Error ? error.message : "Layout não encontrado",
            });
        }
    }
    /**
     * PUT /admin/layouts/:id
     * Atualizar layout
     */
    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, item_type, width, height, slots } = req.body;
            const updateData = {};
            if (name)
                updateData.name = name;
            if (width)
                updateData.width = parseInt(width);
            if (height)
                updateData.height = parseInt(height);
            if (slots)
                updateData.slots = JSON.parse(slots);
            // Se tem arquivo novo, fazer upload para o Google Drive
            if (req.file && item_type) {
                // Validar tipo de item se fornecido
                if (!["CANECA", "QUADRO"].includes(item_type)) {
                    return res.status(400).json({
                        error: "Tipo de item inválido. Valores permitidos: CANECA, QUADRO",
                    });
                }
                // Selecionar pasta do Google Drive baseada no tipo
                const folderId = DRIVE_FOLDERS[item_type];
                // Gerar nome único mantendo a extensão original
                const timestamp = Date.now();
                const randomSuffix = Math.round(Math.random() * 1e9);
                const originalExt = req.file.originalname.split(".").pop();
                const fileName = `layout-${timestamp}-${randomSuffix}.${originalExt}`;
                // Upload para o Google Drive
                console.log(`📤 Atualizando layout ${item_type} no Google Drive...`);
                const uploadedFile = await googleDriveService_1.default.uploadBuffer(req.file.buffer, fileName, folderId, req.file.mimetype);
                updateData.image_url = uploadedFile.webViewLink;
                console.log(`✅ Imagem atualizada no Google Drive: ${updateData.image_url}`);
            }
            const updated = await layoutBaseService_1.default.update(id, updateData);
            return res.json(updated);
        }
        catch (error) {
            console.error("Erro ao atualizar layout:", error);
            return res.status(400).json({
                error: error instanceof Error ? error.message : "Erro ao atualizar layout",
            });
        }
    }
    /**
     * DELETE /admin/layouts/:id
     * Deletar layout
     */
    async delete(req, res) {
        try {
            const { id } = req.params;
            const result = await layoutBaseService_1.default.delete(id);
            return res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar layout:", error);
            return res.status(400).json({
                error: error instanceof Error ? error.message : "Erro ao deletar layout",
            });
        }
    }
}
exports.default = new LayoutBaseController();
