"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const localStorage_1 = require("../config/localStorage");
class CustomizationUploadController {
    /**
     * POST /api/customization/upload-image
     * Upload de imagem para preview de regras de customização
     */
    async uploadImage(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({
                    error: "Nenhum arquivo enviado",
                    message: "É necessário enviar um arquivo de imagem",
                });
            }
            const file = req.file;
            // Garantir que a pasta existe
            const customizationDir = path_1.default.join(localStorage_1.IMAGES_DIR, "customizations");
            if (!fs_1.default.existsSync(customizationDir)) {
                fs_1.default.mkdirSync(customizationDir, { recursive: true });
            }
            // Gerar nome único para o arquivo
            const timestamp = Date.now();
            const sanitizedOriginalName = file.originalname
                .replace(/[^a-zA-Z0-9._-]/g, "_")
                .toLowerCase();
            const filename = `${timestamp}-${sanitizedOriginalName}`;
            const filepath = path_1.default.join(customizationDir, filename);
            // Salvar arquivo
            fs_1.default.writeFileSync(filepath, file.buffer);
            // Retornar URL completa usando BASE_URL do .env
            const baseUrl = process.env.BASE_URL || "";
            const imageUrl = `${baseUrl}/images/customizations/${filename}`;
            return res.status(201).json({
                success: true,
                imageUrl,
                filename,
                mimeType: file.mimetype,
                size: file.size,
            });
        }
        catch (error) {
            console.error("Erro ao fazer upload de imagem:", error);
            return res.status(500).json({
                error: "Erro ao fazer upload da imagem",
                details: error.message,
            });
        }
    }
    /**
     * DELETE /api/customization/image/:filename
     * Remove uma imagem de customização
     */
    async deleteImage(req, res) {
        try {
            const { filename } = req.params;
            if (!filename) {
                return res.status(400).json({
                    error: "Nome do arquivo não informado",
                });
            }
            const filepath = path_1.default.join(localStorage_1.IMAGES_DIR, "customizations", filename);
            if (!fs_1.default.existsSync(filepath)) {
                return res.status(404).json({
                    error: "Arquivo não encontrado",
                });
            }
            fs_1.default.unlinkSync(filepath);
            return res.json({
                success: true,
                message: "Imagem removida com sucesso",
            });
        }
        catch (error) {
            console.error("Erro ao remover imagem:", error);
            return res.status(500).json({
                error: "Erro ao remover imagem",
                details: error.message,
            });
        }
    }
}
exports.default = new CustomizationUploadController();
