"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const authService_1 = __importDefault(require("../services/authService"));
const sharp_1 = __importDefault(require("sharp"));
const localStorage_1 = require("../config/localStorage");
class AuthController {
    async google(req, res) {
        try {
            const { idToken } = req.body;
            if (!idToken) {
                return res.status(400).json({ error: "Token do Google é obrigatório" });
            }
            const result = await authService_1.default.googleLogin({ idToken, ...req.body });
            res.json(result);
        }
        catch (error) {
            console.error("Erro no login do Google:", error);
            if (error.message.includes("obrigatório") ||
                error.message.includes("necessários")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async login(req, res) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res
                    .status(400)
                    .json({ error: "Email e senha são obrigatórios" });
            }
            const result = await authService_1.default.login(email, password);
            res.json(result);
        }
        catch (error) {
            console.error("Erro no login:", error);
            if (error.message.includes("não encontrado") ||
                error.message.includes("não configurada")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async register(req, res) {
        try {
            const { email, password, name } = req.body;
            if (!email || !password || !name) {
                return res
                    .status(400)
                    .json({ error: "Email, senha e nome são obrigatórios" });
            }
            let imageUrl = undefined;
            // Processamento de imagem se fornecida
            if (req.file) {
                try {
                    const compressedImage = await (0, sharp_1.default)(req.file.buffer)
                        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    imageUrl = await (0, localStorage_1.saveImageLocally)(compressedImage, req.file.originalname || `user_${Date.now()}.jpg`, "image/jpeg");
                }
                catch (imageError) {
                    console.error("Erro no processamento de imagem:", imageError);
                    return res.status(500).json({
                        error: "Erro ao processar imagem",
                        details: imageError.message,
                    });
                }
            }
            const result = await authService_1.default.registerWithEmail(email, password, name, imageUrl);
            res.status(201).json(result);
        }
        catch (error) {
            console.error("Erro no registro:", error);
            if (error.message.includes("já registrado") ||
                error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
}
exports.default = new AuthController();
