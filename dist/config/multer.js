"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertImagesToWebPLossless = exports.convertImagesToWebP = exports.uploadTemp = exports.uploadAny = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const storage = multer_1.default.memoryStorage();
const isImageByName = (name) => {
    if (!name)
        return false;
    return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
};
const imageFileFilter = (req, file, cb) => {
    const hasMimeImage = file.mimetype && file.mimetype.startsWith("image/");
    const hasImageName = isImageByName(file.originalname);
    if (hasMimeImage || hasImageName) {
        cb(null, true);
    }
    else {
        cb(null, false);
    }
};
exports.upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: imageFileFilter,
});
exports.uploadAny = (0, multer_1.default)({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
});
const storageTemp = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const { sessionId } = req.body;
        // Pasta de storage FORA do diretório do código
        // Em produção (Docker): /app/storage
        // Em desenvolvimento: ./storage
        const baseStorageDir = process.env.NODE_ENV === "production" ? "/app/storage" : "storage";
        const tempDir = `${baseStorageDir}/temp/${sessionId || "default"}`;
        const fs = require("fs");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = file.originalname.split(".").pop();
        cb(null, `temp-${uniqueSuffix}.${ext}`);
    },
});
exports.uploadTemp = (0, multer_1.default)({
    storage: storageTemp,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error("Apenas imagens JPEG, PNG, WebP e GIF são permitidas"));
        }
    },
});
const convertImagesToWebP = async (req, res, next) => {
    try {
        console.log("🔄 [MIDDLEWARE] convertImagesToWebP iniciado");
        const convert = async (file) => {
            if (!file || !file.buffer) {
                return file;
            }
            const isImageMime = file.mimetype && file.mimetype.startsWith("image/");
            const isImageName = isImageByName(file.originalname);
            if (!isImageMime && !isImageName) {
                return file;
            }
            const webpBuffer = await (0, sharp_1.default)(file.buffer)
                .webp({ quality: 80 })
                .toBuffer();
            const originalName = file.originalname || `file_${Date.now()}`;
            const baseName = originalName.replace(/\.[^.]+$/, "");
            file.buffer = webpBuffer;
            file.mimetype = "image/webp";
            file.originalname = `${baseName}.webp`;
            file.size = webpBuffer.length;
            return file;
        };
        if (req.file) {
            req.file = await convert(req.file);
        }
        if (Array.isArray(req.files)) {
            for (let i = 0; i < req.files.length; i++) {
                req.files[i] = await convert(req.files[i]);
            }
        }
        else if (req.files && typeof req.files === "object") {
            for (const key of Object.keys(req.files)) {
                const arr = req.files[key];
                if (Array.isArray(arr)) {
                    for (let i = 0; i < arr.length; i++) {
                        arr[i] = await convert(arr[i]);
                    }
                }
            }
        }
        next();
    }
    catch (err) {
        console.error("❌ [MIDDLEWARE] Erro em convertImagesToWebP:", err);
        console.error("❌ [MIDDLEWARE] Stack:", err.stack);
        next(err);
    }
};
exports.convertImagesToWebP = convertImagesToWebP;
const convertImagesToWebPLossless = async (req, res, next) => {
    try {
        const convert = async (file) => {
            if (!file || !file.buffer)
                return file;
            const isImageMime = file.mimetype && file.mimetype.startsWith("image/");
            const isImageName = isImageByName(file.originalname);
            if (!isImageMime && !isImageName)
                return file;
            const ext = (file.originalname || "").split(".").pop() || "webp";
            const hasTemplate = /\{\{.*\}\}/.test(file.originalname || "");
            const safeBaseName = hasTemplate
                ? `uploaded_${Date.now()}`
                : (file.originalname || `file_${Date.now()}`).replace(/\.[^.]+$/, "");
            // Convert using withMetadata to preserve profile/density when possible
            const webpBuffer = await (0, sharp_1.default)(file.buffer)
                .withMetadata()
                .webp({ lossless: true })
                .toBuffer();
            file.buffer = webpBuffer;
            file.mimetype = "image/webp";
            file.originalname = `${safeBaseName}.webp`;
            file.size = webpBuffer.length;
            return file;
        };
        if (req.file) {
            req.file = await convert(req.file);
        }
        if (Array.isArray(req.files)) {
            for (let i = 0; i < req.files.length; i++) {
                req.files[i] = await convert(req.files[i]);
            }
        }
        else if (req.files && typeof req.files === "object") {
            for (const key of Object.keys(req.files)) {
                const arr = req.files[key];
                if (Array.isArray(arr)) {
                    for (let i = 0; i < arr.length; i++) {
                        arr[i] = await convert(arr[i]);
                    }
                }
            }
        }
        next();
    }
    catch (err) {
        next(err);
    }
};
exports.convertImagesToWebPLossless = convertImagesToWebPLossless;
