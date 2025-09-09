"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const additionalService_1 = __importDefault(require("../services/additionalService"));
const sharp_1 = __importDefault(require("sharp"));
const localStorage_1 = require("../config/localStorage");
class AdditionalController {
    async index(req, res) {
        try {
            const includeProducts = req.query.include_products === 'true';
            const additionals = await additionalService_1.default.getAllAdditionals(includeProducts);
            res.json(additionals);
        }
        catch (error) {
            console.error("Erro ao buscar adicionais:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const includeProducts = req.query.include_products === 'true';
            const additional = await additionalService_1.default.getAdditionalById(id, includeProducts);
            res.json(additional);
        }
        catch (error) {
            console.error("Erro ao buscar adicional:", error);
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
            // Processar imagem se existir
            let fileToProcess = null;
            if (req.file) {
                fileToProcess = req.file;
            }
            else if (req.files) {
                if (Array.isArray(req.files) && req.files.length > 0) {
                    fileToProcess = req.files[0];
                }
                else if (typeof req.files === "object") {
                    const fileKeys = Object.keys(req.files);
                    if (fileKeys.length > 0) {
                        const files = req.files[fileKeys[0]];
                        if (Array.isArray(files) && files.length > 0) {
                            fileToProcess = files[0];
                        }
                    }
                }
            }
            if (fileToProcess) {
                try {
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(fileToProcess.buffer, fileToProcess.originalname || `additional_${Date.now()}.webp`, fileToProcess.mimetype || "image/webp");
                    data.image_url = imageUrl;
                }
                catch (imageError) {
                    console.error("Erro ao salvar imagem:", imageError);
                    return res.status(500).json({
                        error: "Erro ao processar imagem",
                        details: imageError.message,
                    });
                }
            }
            const additional = await additionalService_1.default.createAdditional(data);
            res.status(201).json(additional);
        }
        catch (error) {
            console.error("Erro ao criar adicional:", error);
            if (error.message.includes("obrigatório") ||
                error.message.includes("inválido")) {
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
                        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(compressedImage, req.file.originalname || `additional_${Date.now()}.jpg`, "image/jpeg");
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
            const additional = await additionalService_1.default.updateAdditional(id, data);
            res.json(additional);
        }
        catch (error) {
            console.error("Erro ao atualizar adicional:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório") ||
                error.message.includes("inválido")) {
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
            const result = await additionalService_1.default.deleteAdditional(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar adicional:", error);
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
    async link(req, res) {
        try {
            const { id } = req.params; // additional id
            const { productId, customPrice } = req.body;
            if (!productId) {
                return res.status(400).json({ error: "ID do produto é obrigatório" });
            }
            const result = await additionalService_1.default.linkToProduct(id, productId, customPrice);
            res.status(201).json(result);
        }
        catch (error) {
            console.error("Erro ao vincular adicional:", error);
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
    async updateLink(req, res) {
        try {
            const { id } = req.params; // additional id
            const { productId, customPrice } = req.body;
            if (!productId) {
                return res.status(400).json({ error: "ID do produto é obrigatório" });
            }
            const result = await additionalService_1.default.updateProductLink(id, productId, customPrice);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao atualizar vínculo do adicional:", error);
            if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async getPrice(req, res) {
        try {
            const { id } = req.params; // additional id
            const { productId } = req.query;
            const price = await additionalService_1.default.getAdditionalPrice(id, productId);
            res.json({ price });
        }
        catch (error) {
            console.error("Erro ao buscar preço do adicional:", error);
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
    async getByProduct(req, res) {
        try {
            const { productId } = req.params;
            const additionals = await additionalService_1.default.getAdditionalsByProduct(productId);
            res.json(additionals);
        }
        catch (error) {
            console.error("Erro ao buscar adicionais do produto:", error);
            if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async unlink(req, res) {
        try {
            const { id } = req.params; // additional id
            const { productId } = req.body;
            if (!productId) {
                return res.status(400).json({ error: "ID do produto é obrigatório" });
            }
            const result = await additionalService_1.default.unlinkFromProduct(id, productId);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao desvincular adicional:", error);
            if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
}
exports.default = new AdditionalController();
