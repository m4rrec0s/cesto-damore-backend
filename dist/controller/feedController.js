"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const feedService_1 = __importDefault(require("../services/feedService"));
const localStorage_1 = require("../config/localStorage");
class FeedController {
    async getAllConfigurations(req, res) {
        try {
            const configurations = await feedService_1.default.getAllFeedConfigurations();
            res.json(configurations);
        }
        catch (error) {
            console.error("Erro ao buscar configurações de feed:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async getConfiguration(req, res) {
        try {
            const { id } = req.params;
            const configuration = await feedService_1.default.getFeedConfigurationById(id);
            res.json(configuration);
        }
        catch (error) {
            console.error("Erro ao buscar configuração de feed:", error);
            if (error.message.includes("não encontrada")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async createConfiguration(req, res) {
        try {
            const data = req.body;
            const configuration = await feedService_1.default.createFeedConfiguration(data);
            res.status(201).json(configuration);
        }
        catch (error) {
            console.error("Erro ao criar configuração de feed:", error);
            if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async updateConfiguration(req, res) {
        try {
            const { id } = req.params;
            const data = req.body;
            const configuration = await feedService_1.default.updateFeedConfiguration(id, data);
            res.json(configuration);
        }
        catch (error) {
            console.error("Erro ao atualizar configuração de feed:", error);
            if (error.message.includes("não encontrada")) {
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
    async deleteConfiguration(req, res) {
        try {
            const { id } = req.params;
            const result = await feedService_1.default.deleteFeedConfiguration(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar configuração de feed:", error);
            if (error.message.includes("não encontrada")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async createBanner(req, res) {
        try {
            const data = { ...req.body };
            if (typeof data.is_active === "string") {
                data.is_active = data.is_active === "true";
            }
            if (typeof data.display_order === "string") {
                data.display_order = parseInt(data.display_order, 10);
            }
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
                    const origName = fileToProcess.originalname || `banner_${Date.now()}`;
                    const extension = origName.substring(origName.lastIndexOf("."));
                    const baseName = origName.replace(/\.[^/.]+$/, "");
                    const safeBase = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
                    const filename = `banner_${Date.now()}-${safeBase}${extension}`;
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(fileToProcess.buffer, filename, fileToProcess.mimetype);
                    data.image_url = imageUrl;
                }
                catch (imageError) {
                    console.error("Erro ao processar imagem:", imageError);
                    return res.status(500).json({
                        error: "Erro ao processar imagem",
                        details: imageError.message,
                    });
                }
            }
            const banner = await feedService_1.default.createFeedBanner(data);
            res.status(201).json(banner);
        }
        catch (error) {
            console.error("Erro ao criar banner:", error);
            if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async updateBanner(req, res) {
        try {
            const { id } = req.params;
            const data = { ...req.body };
            if (typeof data.is_active === "string") {
                data.is_active = data.is_active === "true";
            }
            if (typeof data.display_order === "string") {
                data.display_order = parseInt(data.display_order, 10);
            }
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
            if (file) {
                try {
                    const origName = file.originalname || `banner_${Date.now()}`;
                    const extension = origName.substring(origName.lastIndexOf("."));
                    const baseName = origName.replace(/\.[^/.]+$/, "");
                    const safeBase = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
                    const filename = `banner_${Date.now()}-${safeBase}${extension}`;
                    const imageUrl = await (0, localStorage_1.saveImageLocally)(file.buffer, filename, file.mimetype);
                    data.image_url = imageUrl;
                }
                catch (imageError) {
                    console.error("Erro ao processar imagem:", imageError);
                    return res.status(500).json({
                        error: "Erro ao processar imagem",
                        details: imageError.message,
                    });
                }
            }
            const banner = await feedService_1.default.updateFeedBanner(id, data);
            res.json(banner);
        }
        catch (error) {
            console.error("Erro ao atualizar banner:", error);
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
    async deleteBanner(req, res) {
        try {
            const { id } = req.params;
            const result = await feedService_1.default.deleteFeedBanner(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar banner:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async createSection(req, res) {
        try {
            const data = req.body;
            const section = await feedService_1.default.createFeedSection(data);
            res.status(201).json(section);
        }
        catch (error) {
            console.error("Erro ao criar seção:", error);
            if (error.message.includes("obrigatório")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async updateSection(req, res) {
        try {
            const { id } = req.params;
            const data = req.body;
            const section = await feedService_1.default.updateFeedSection(id, data);
            res.json(section);
        }
        catch (error) {
            console.error("Erro ao atualizar seção:", error);
            if (error.message.includes("não encontrada")) {
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
    async deleteSection(req, res) {
        try {
            const { id } = req.params;
            const result = await feedService_1.default.deleteFeedSection(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar seção:", error);
            if (error.message.includes("não encontrada")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    // ============== FEED SECTION ITEM ENDPOINTS ==============
    async createSectionItem(req, res) {
        try {
            const data = req.body;
            const item = await feedService_1.default.createFeedSectionItem(data);
            res.status(201).json(item);
        }
        catch (error) {
            console.error("Erro ao criar item da seção:", error);
            if (error.message.includes("obrigatório") ||
                error.message.includes("não encontrad")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async updateSectionItem(req, res) {
        try {
            const { id } = req.params;
            const data = req.body;
            const item = await feedService_1.default.updateFeedSectionItem(id, data);
            res.json(item);
        }
        catch (error) {
            console.error("Erro ao atualizar item da seção:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório") ||
                error.message.includes("devem ser fornecidos")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    async deleteSectionItem(req, res) {
        try {
            const { id } = req.params;
            const result = await feedService_1.default.deleteFeedSectionItem(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar item da seção:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    // ============== PUBLIC FEED ENDPOINT ==============
    async getPublicFeed(req, res) {
        try {
            const configId = req.query.config_id;
            const page = req.query.page ? Number(req.query.page) : undefined;
            const perPage = req.query.perPage ? Number(req.query.perPage) : undefined;
            const feed = await feedService_1.default.getPublicFeed(configId, page, perPage);
            res.json(feed);
        }
        catch (error) {
            console.error("Erro ao buscar feed público:", error);
            if (error.message.includes("não encontrada")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({ error: "Erro interno do servidor" });
            }
        }
    }
    // ============== UTILITY ENDPOINTS ==============
    async getSectionTypes(req, res) {
        try {
            const sectionTypes = [
                {
                    value: "RECOMMENDED_PRODUCTS",
                    label: "Produtos Recomendados",
                    description: "Produtos selecionados automaticamente como recomendados",
                },
                {
                    value: "DISCOUNTED_PRODUCTS",
                    label: "Produtos com Desconto",
                    description: "Produtos que possuem desconto aplicado",
                },
                {
                    value: "FEATURED_CATEGORIES",
                    label: "Categorias em Destaque",
                    description: "Categorias principais para navegação",
                },
                {
                    value: "FEATURED_ADDITIONALS",
                    label: "Adicionais em Destaque",
                    description: "Adicionais populares ou promocionais",
                },
                {
                    value: "CUSTOM_PRODUCTS",
                    label: "Produtos Personalizados",
                    description: "Produtos selecionados manualmente pelo administrador",
                },
                {
                    value: "NEW_ARRIVALS",
                    label: "Novos Produtos",
                    description: "Produtos recém-cadastrados no sistema",
                },
                {
                    value: "BEST_SELLERS",
                    label: "Mais Vendidos",
                    description: "Produtos com maior volume de vendas",
                },
            ];
            res.json(sectionTypes);
        }
        catch (error) {
            console.error("Erro ao buscar tipos de seção:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
}
exports.default = new FeedController();
