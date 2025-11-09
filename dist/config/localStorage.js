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
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const ensureImagesDirectory = () => {
    if (!fs_1.default.existsSync(IMAGES_DIR)) {
        fs_1.default.mkdirSync(IMAGES_DIR, { recursive: true });
        console.log("📁 Diretório de imagens criado:", IMAGES_DIR);
    }
};
exports.ensureImagesDirectory = ensureImagesDirectory;
const saveImageLocally = async (buffer, originalName, mimeType) => {
    try {
        (0, exports.ensureImagesDirectory)();
        console.log("[localStorage.saveImageLocally] Recebendo arquivo:", {
            originalName,
            mimeType,
            bufferSize: buffer.length,
        });
        // Gerar hash curto do conteúdo para permitir deduplicação
        const hash = crypto_1.default.createHash("sha256").update(buffer).digest("hex");
        const shortHash = hash.slice(0, 12);
        const timestamp = Date.now();
        const baseFileName = path_1.default.parse(originalName).name;
        const extension = path_1.default.extname(originalName) || getExtensionFromMimeType(mimeType);
        console.log("[localStorage.saveImageLocally] Processando extensão:", {
            originalName,
            pathExtname: path_1.default.extname(originalName),
            mimeTypeExtension: getExtensionFromMimeType(mimeType),
            finalExtension: extension,
        });
        // Procura por arquivo já existente com mesmo hash (evita múltiplas cópias)
        const existing = fs_1.default
            .readdirSync(IMAGES_DIR)
            .find((f) => f.includes(`-${shortHash}-`) ||
            f.includes(`-${shortHash}${extension}`));
        if (existing) {
            // já existe um arquivo com este hash — retorna a URL sem regravar
            console.log("[localStorage.saveImageLocally] Arquivo já existe:", existing);
            return `${BASE_URL}/images/${existing}`;
        }
        const fileName = `${timestamp}-${shortHash}-${sanitizeFileName(baseFileName)}${extension}`;
        const filePath = path_1.default.join(IMAGES_DIR, fileName);
        console.log("[localStorage.saveImageLocally] Salvando arquivo:", {
            fileName,
            filePath,
        });
        fs_1.default.writeFileSync(filePath, buffer);
        const imageUrl = `${BASE_URL}/images/${fileName}`;
        console.log("[localStorage.saveImageLocally] Arquivo salvo com sucesso:", {
            imageUrl,
            fileSize: buffer.length,
        });
        return imageUrl;
    }
    catch (error) {
        console.error("❌ Erro ao salvar imagem:", error.message);
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
        console.warn("⚠️ Não foi possível deletar a imagem do produto:", error.message);
        console.warn("🔄 Produto será deletado mesmo assim");
    }
};
exports.deleteProductImage = deleteProductImage;
const deleteAdditionalImage = async (imageUrl) => {
    if (!imageUrl) {
        console.log("📄 Adicional sem imagem associada, nada para deletar");
        return;
    }
    try {
        await (0, exports.deleteImageLocally)(imageUrl);
        console.log("✅ Imagem adicional deletada com sucesso");
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
