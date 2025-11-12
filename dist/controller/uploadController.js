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
            console.log("📤 [UPLOAD] Iniciando processamento de upload");
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
                console.error("❌ [UPLOAD] Nenhum arquivo recebido");
                return res.status(400).json({ error: "Nenhuma imagem foi enviada" });
            }
            console.log("📥 [UPLOAD] Arquivo recebido:", {
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.buffer?.length || 0,
            });
            try {
                console.log("🔄 [UPLOAD] Processando com Sharp...");
                // Processar imagem (redimensionar e converter para WebP)
                const processedImage = await (0, sharp_1.default)(file.buffer)
                    .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
                    .webp({ quality: 85 })
                    .toBuffer();
                console.log("✅ [UPLOAD] Sharp processou imagem:", processedImage.length, "bytes");
                console.log("💾 [UPLOAD] Chamando saveImageLocally...");
                const imageUrl = await (0, localStorage_1.saveImageLocally)(processedImage, file.originalname || `upload_${Date.now()}.webp`, "image/webp");
                console.log("✅ [UPLOAD] Upload concluído com sucesso!");
                console.log("🔗 [UPLOAD] URL:", imageUrl);
                return res.status(200).json({
                    url: imageUrl,
                    image_url: imageUrl,
                    message: "Upload realizado com sucesso",
                });
            }
            catch (imageError) {
                console.error("❌ [UPLOAD] Erro ao processar imagem:", imageError);
                console.error("❌ [UPLOAD] Stack:", imageError.stack);
                return res.status(500).json({
                    error: "Erro ao processar imagem",
                    details: imageError.message,
                });
            }
        }
        catch (error) {
            console.error("❌ [UPLOAD] Erro geral:", error);
            console.error("❌ [UPLOAD] Stack:", error.stack);
            return res.status(500).json({
                error: "Erro ao fazer upload",
                details: error.message,
            });
        }
    }
}
exports.default = new UploadController();
