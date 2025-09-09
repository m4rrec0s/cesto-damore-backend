"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGES_DIR = exports.listLocalImages = exports.deleteProductImage = exports.deleteImageLocally = exports.saveImageLocally = exports.ensureImagesDirectory = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Configuração do diretório de imagens
const IMAGES_DIR = path_1.default.join(process.cwd(), "images");
exports.IMAGES_DIR = IMAGES_DIR;
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
// Garante que o diretório de imagens existe
const ensureImagesDirectory = () => {
    if (!fs_1.default.existsSync(IMAGES_DIR)) {
        fs_1.default.mkdirSync(IMAGES_DIR, { recursive: true });
        console.log("📁 Diretório de imagens criado:", IMAGES_DIR);
    }
};
exports.ensureImagesDirectory = ensureImagesDirectory;
// Salva uma imagem no sistema local
const saveImageLocally = async (buffer, originalName, mimeType) => {
    try {
        // Garantir que o diretório existe
        (0, exports.ensureImagesDirectory)();
        // Gerar nome único para o arquivo
        const timestamp = Date.now();
        const baseFileName = path_1.default.parse(originalName).name; // Nome sem extensão
        const extension = path_1.default.extname(originalName) || getExtensionFromMimeType(mimeType);
        const fileName = `${timestamp}-${sanitizeFileName(baseFileName)}${extension}`;
        const filePath = path_1.default.join(IMAGES_DIR, fileName);
        // Salvar o arquivo
        fs_1.default.writeFileSync(filePath, buffer);
        // Retornar URL para acessar a imagem
        const imageUrl = `${BASE_URL}/api/images/${fileName}`;
        console.log("✅ Imagem salva:", {
            originalName,
            fileName,
            size: buffer.length,
            path: filePath,
            url: imageUrl,
        });
        return imageUrl;
    }
    catch (error) {
        console.error("❌ Erro ao salvar imagem:", error.message);
        throw new Error(`Erro ao salvar imagem: ${error.message}`);
    }
};
exports.saveImageLocally = saveImageLocally;
// Remove uma imagem do sistema local
const deleteImageLocally = async (imageUrl) => {
    try {
        // Extrair nome do arquivo da URL
        const fileName = path_1.default.basename(new URL(imageUrl).pathname);
        const filePath = path_1.default.join(IMAGES_DIR, fileName);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            console.log("🗑️ Imagem deletada:", filePath);
        }
        else {
            console.log("⚠️ Arquivo não encontrado:", filePath);
        }
    }
    catch (error) {
        console.error("❌ Erro ao deletar imagem:", error.message);
        throw new Error(`Erro ao deletar imagem: ${error.message}`);
    }
};
exports.deleteImageLocally = deleteImageLocally;
// Remove a imagem de um produto (sem falhar se a imagem não existir)
const deleteProductImage = async (imageUrl) => {
    if (!imageUrl) {
        console.log("📄 Produto sem imagem associada, nada para deletar");
        return;
    }
    try {
        await (0, exports.deleteImageLocally)(imageUrl);
        console.log("✅ Imagem do produto deletada com sucesso");
    }
    catch (error) {
        // Log do erro mas não falha a operação de deletar produto
        console.warn("⚠️ Não foi possível deletar a imagem do produto:", error.message);
        console.warn("🔄 Produto será deletado mesmo assim");
    }
};
exports.deleteProductImage = deleteProductImage;
// Lista todas as imagens salvas
const listLocalImages = () => {
    try {
        (0, exports.ensureImagesDirectory)();
        const files = fs_1.default.readdirSync(IMAGES_DIR);
        return files
            .filter((file) => isImageFile(file))
            .map((file) => {
            const filePath = path_1.default.join(IMAGES_DIR, file);
            const stats = fs_1.default.statSync(filePath);
            return {
                fileName: file,
                url: `${BASE_URL}/api/images/${file}`,
                size: stats.size,
            };
        });
    }
    catch (error) {
        console.error("❌ Erro ao listar imagens:", error.message);
        return [];
    }
};
exports.listLocalImages = listLocalImages;
// Funções auxiliares
const sanitizeFileName = (fileName) => {
    return fileName
        .replace(/[^a-zA-Z0-9.-]/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^_|_$/g, "");
};
const getExtensionFromMimeType = (mimeType) => {
    const mimeToExt = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
    };
    return mimeToExt[mimeType] || ".jpg";
};
const isImageFile = (fileName) => {
    const imageExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".svg",
    ];
    const ext = path_1.default.extname(fileName).toLowerCase();
    return imageExtensions.includes(ext);
};
