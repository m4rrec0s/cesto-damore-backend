"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGES_DIR = exports.listLocalImages = exports.deleteAdditionalImage = exports.deleteProductImage = exports.deleteImageLocally = exports.saveImageLocally = exports.ensureImagesDirectory = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const IMAGES_DIR = path_1.default.join(process.cwd(), "images");
exports.IMAGES_DIR = IMAGES_DIR;
const BASE_URL = process.env.BASE_URL;
const ensureImagesDirectory = () => {
    if (!fs_1.default.existsSync(IMAGES_DIR)) {
        fs_1.default.mkdirSync(IMAGES_DIR, { recursive: true });
    }
};
exports.ensureImagesDirectory = ensureImagesDirectory;
const saveImageLocally = async (buffer, originalName, mimeType) => {
    try {
        console.log("🔍 [DEBUG] saveImageLocally - Início");
        console.log("🔍 [DEBUG] Buffer size:", buffer.length, "bytes");
        console.log("🔍 [DEBUG] Original name:", originalName);
        console.log("🔍 [DEBUG] MIME type:", mimeType);
        console.log("🔍 [DEBUG] IMAGES_DIR:", IMAGES_DIR);
        (0, exports.ensureImagesDirectory)();
        console.log("🔍 [DEBUG] Directory ensured");
        const hash = crypto_1.default.createHash("sha256").update(buffer).digest("hex");
        const shortHash = hash.slice(0, 12);
        console.log("🔍 [DEBUG] Hash gerado:", shortHash);
        const timestamp = Date.now();
        const baseFileName = path_1.default.parse(originalName).name;
        const extension = path_1.default.extname(originalName) || getExtensionFromMimeType(mimeType);
        console.log("🔍 [DEBUG] Extension:", extension);
        const existing = fs_1.default
            .readdirSync(IMAGES_DIR)
            .find((f) => f.includes(`-${shortHash}-`) ||
            f.includes(`-${shortHash}${extension}`));
        if (existing) {
            console.log("✅ [DEBUG] Imagem duplicada encontrada:", existing);
            return `${BASE_URL}/images/${existing}`;
        }
        const fileName = `${timestamp}-${shortHash}-${sanitizeFileName(baseFileName)}${extension}`;
        const filePath = path_1.default.join(IMAGES_DIR, fileName);
        console.log("🔍 [DEBUG] File path completo:", filePath);
        console.log("🔍 [DEBUG] Escrevendo arquivo no disco...");
        fs_1.default.writeFileSync(filePath, buffer);
        console.log("✅ [DEBUG] Arquivo escrito com sucesso!");
        // Verificar se o arquivo realmente foi criado
        if (fs_1.default.existsSync(filePath)) {
            const stats = fs_1.default.statSync(filePath);
            console.log("✅ [DEBUG] Arquivo confirmado no disco:", stats.size, "bytes");
        }
        else {
            console.error("❌ [DEBUG] ARQUIVO NÃO EXISTE APÓS writeFileSync!");
        }
        const imageUrl = `${BASE_URL}/images/${fileName}`;
        console.log("✅ [DEBUG] URL gerada:", imageUrl);
        return imageUrl;
    }
    catch (error) {
        console.error("❌ [ERRO CRÍTICO] saveImageLocally falhou:", error);
        console.error("❌ Stack trace:", error.stack);
        throw new Error(`Erro ao salvar imagem: ${error.message}`);
    }
};
exports.saveImageLocally = saveImageLocally;
const deleteImageLocally = async (imageUrl) => {
    try {
        const fileName = path_1.default.basename(new URL(imageUrl).pathname);
        const filePath = path_1.default.join(IMAGES_DIR, fileName);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            return;
        }
        else {
            console.warn("⚠️ Arquivo não encontrado:", filePath);
        }
    }
    catch (error) {
        console.error("❌ Erro ao deletar imagem:", error.message);
        throw new Error(`Erro ao deletar imagem: ${error.message}`);
    }
};
exports.deleteImageLocally = deleteImageLocally;
const deleteProductImage = async (imageUrl) => {
    if (!imageUrl) {
        return;
    }
    try {
        await (0, exports.deleteImageLocally)(imageUrl);
    }
    catch (error) {
        console.warn("⚠️ Não foi possível deletar a imagem do produto:", error.message);
        console.warn("🔄 Produto será deletado mesmo assim");
    }
};
exports.deleteProductImage = deleteProductImage;
const deleteAdditionalImage = async (imageUrl) => {
    if (!imageUrl) {
        return;
    }
    try {
        await (0, exports.deleteImageLocally)(imageUrl);
    }
    catch (error) {
        console.warn("⚠️ Não foi possível deletar a imagem adicional:", error.message);
        console.warn("🔄 Imagem adicional será deletada mesmo assim");
    }
};
exports.deleteAdditionalImage = deleteAdditionalImage;
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
                url: `${BASE_URL}/images/${file}`,
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
