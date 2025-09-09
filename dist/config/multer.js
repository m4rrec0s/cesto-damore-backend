"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertImagesToWebP = exports.uploadAny = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const storage = multer_1.default.memoryStorage();
const isImageByName = (name) => {
    if (!name)
        return false;
    return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
};
const imageFileFilter = (req, file, cb) => {
    // Aceita imagens com base no mimetype ou, se ausente, pela extensão do originalname
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
// Upload que aceita qualquer arquivo/campo (sem logs)
exports.uploadAny = (0, multer_1.default)({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
});
// Middleware que converte imagens para WebP e atualiza req.file / req.files
const convertImagesToWebP = async (req, res, next) => {
    try {
        const convert = async (file) => {
            if (!file || !file.buffer)
                return file;
            const isImageMime = file.mimetype && file.mimetype.startsWith("image/");
            const isImageName = isImageByName(file.originalname);
            if (!isImageMime && !isImageName)
                return file;
            const webpBuffer = await (0, sharp_1.default)(file.buffer)
                .webp({ quality: 80 })
                .toBuffer();
            // Atualiza propriedades para refletir o novo arquivo WebP
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
            // Quando multer usa fields(), req.files é um objeto com arrays
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
exports.convertImagesToWebP = convertImagesToWebP;
