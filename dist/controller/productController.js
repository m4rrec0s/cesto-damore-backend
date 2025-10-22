"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sharp_1 = __importDefault(require("sharp"));
const productService_1 = __importDefault(require("../services/productService"));
const localStorage_1 = require("../config/localStorage");
class ProductController {
    async index(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.per_page) || 15;
            const sort = req.query.sort || "name";
            const search = req.query.search;
            const category_id = req.query.category_id;
            const type_id = req.query.type_id;
            const result = await productService_1.default.getAllProducts({
                page,
                perPage,
                sort,
                search,
                category_id,
                type_id,
            });
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao buscar produtos:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const product = await productService_1.default.getProductById(id);
            res.json(product);
        }
        catch (error) {
            console.error("Erro ao buscar produto:", error);
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
            // Converter categories se vier como string (multipart/form-data)
            if (typeof data.categories === "string") {
                try {
                    data.categories = JSON.parse(data.categories);
                }
                catch (e) {
                    // Se não for JSON válido, tentar dividir por vírgula
                    data.categories = data.categories
                        .split(",")
                        .map((c) => c.trim())
                        .filter(Boolean);
                }
            }
            // Garantir que categories é um array
            if (!Array.isArray(data.categories)) {
                data.categories = [];
            }
            console.log("📦 [ProductController] Dados recebidos:", {
                name: data.name,
                categories: data.categories,
                categoriesType: typeof data.categories,
                categoriesIsArray: Array.isArray(data.categories),
                categoriesLength: data.categories?.length,
            });
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
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(fileToProcess.buffer, fileToProcess.originalname || `product_${Date.now()}.webp`, fileToProcess.mimetype || "image/webp");
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
            const product = await productService_1.default.createProduct(data);
            res.status(201).json(product);
        }
        catch (error) {
            console.error("Erro ao criar produto:", error);
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
            // Processamento de imagem se fornecida
            if (file) {
                try {
                    const compressedImage = await (0, sharp_1.default)(file.buffer)
                        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toBuffer();
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(compressedImage, file.originalname || `product_${Date.now()}.webp`, "image/webp");
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
            const product = await productService_1.default.updateProduct(id, data);
            res.json(product);
        }
        catch (error) {
            console.error("Erro ao atualizar produto:", error);
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
            const result = await productService_1.default.deleteProduct(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar produto:", error);
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
            const { id } = req.params;
            const { additionalId } = req.body;
            if (!additionalId) {
                return res.status(400).json({ error: "ID do adicional é obrigatório" });
            }
            const result = await productService_1.default.linkAdditional(id, additionalId);
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
    async unlink(req, res) {
        try {
            const { id } = req.params;
            const { additionalId } = req.body;
            if (!additionalId) {
                return res.status(400).json({ error: "ID do adicional é obrigatório" });
            }
            const result = await productService_1.default.unlinkAdditional(id, additionalId);
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
exports.default = new ProductController();
