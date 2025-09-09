"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const userService_1 = __importDefault(require("../services/userService"));
const sharp_1 = __importDefault(require("sharp"));
const localStorage_1 = require("../config/localStorage");
class UserController {
    async index(req, res) {
        try {
            const users = await userService_1.default.getAllUsers();
            res.json(users);
        }
        catch (error) {
            console.error("Erro ao buscar usuários:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const user = await userService_1.default.getUserById(id);
            res.json(user);
        }
        catch (error) {
            console.error("Erro ao buscar usuário:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async create(req, res) {
        try {
            const data = { ...req.body };
            // Processamento de imagem se fornecida
            if (req.file) {
                try {
                    const compressedImage = await (0, sharp_1.default)(req.file.buffer)
                        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(compressedImage, req.file.originalname || `user_${Date.now()}.jpg`, "image/jpeg");
                    data.image_url = imageUrl;
                }
                catch (imageError) {
                    console.error("Erro no processamento de imagem:", imageError);
                    return res.status(500).json({
                        error: "Erro ao processar imagem",
                        details: imageError.message,
                    });
                }
            }
            const user = await userService_1.default.createUser(data);
            res.status(201).json(user);
        }
        catch (error) {
            console.error("Erro ao criar usuário:", error);
            if (error.message.includes("obrigatório") ||
                error.message.includes("inválido") ||
                error.message.includes("já")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async update(req, res) {
        try {
            const { id } = req.params;
            const data = { ...req.body };
            // Processamento de imagem se fornecida
            if (req.file) {
                try {
                    const compressedImage = await (0, sharp_1.default)(req.file.buffer)
                        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(compressedImage, req.file.originalname || `user_${Date.now()}.jpg`, "image/jpeg");
                    data.image_url = imageUrl;
                }
                catch (imageError) {
                    console.error("Erro no processamento de imagem:", imageError);
                    return res.status(500).json({
                        error: "Erro ao processar imagem",
                        details: imageError.message,
                    });
                }
            }
            const user = await userService_1.default.updateUser(id, data);
            res.json(user);
        }
        catch (error) {
            console.error("Erro ao atualizar usuário:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório") ||
                error.message.includes("inválido") ||
                error.message.includes("já")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async remove(req, res) {
        try {
            const { id } = req.params;
            const result = await userService_1.default.deleteUser(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar usuário:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório") ||
                error.message.includes("Não é possível deletar")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
}
exports.default = new UserController();
