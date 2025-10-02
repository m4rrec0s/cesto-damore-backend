"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sharp_1 = __importDefault(require("sharp"));
const localStorage_1 = require("../config/localStorage");
class UploadController {
    async uploadImage(req, res) {
        try {
            // Processar o arquivo enviado
            const file = (() => {
                if (req.file)
                    return req.file;
                if (Array.isArray(req.files) && req.files.length)
                    return req.files[0];
                if (req.files && typeof req.files === "object") {
                    const vals = Object.values(req.files).flat();
                    if (vals.length)
                        return vals[0];
                }
                return null;
            })();
            if (!file) {
                return res.status(400).json({ error: "Nenhuma imagem foi enviada" });
            }
            try {
                // Processar imagem (redimensionar e converter para WebP)
                const processedImage = await (0, sharp_1.default)(file.buffer)
                    .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
                    .webp({ quality: 85 })
                    .toBuffer();
                const imageUrl = await (0, localStorage_1.saveImageLocally)(processedImage, file.originalname || `upload_${Date.now()}.webp`, "image/webp");
                return res.status(200).json({
                    url: imageUrl,
                    image_url: imageUrl,
                    message: "Upload realizado com sucesso",
                });
            }
            catch (imageError) {
                console.error("Erro ao processar imagem:", imageError);
                return res.status(500).json({
                    error: "Erro ao processar imagem",
                    details: imageError.message,
                });
            }
        }
        catch (error) {
            console.error("Erro no upload:", error);
            return res.status(500).json({
                error: "Erro ao fazer upload",
                details: error.message,
            });
        }
    }
}
exports.default = new UploadController();
