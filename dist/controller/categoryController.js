"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const categoryService_1 = __importDefault(require("../services/categoryService"));
class CategoryController {
    async index(req, res) {
        try {
            const categories = await categoryService_1.default.getAllCategories();
            res.json(categories);
        }
        catch (error) {
            console.error("Erro ao buscar categorias:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const category = await categoryService_1.default.getCategoryById(id);
            res.json(category);
        }
        catch (error) {
            console.error("Erro ao buscar categoria:", error);
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
    async create(req, res) {
        try {
            const category = await categoryService_1.default.createCategory(req.body);
            res.status(201).json(category);
        }
        catch (error) {
            console.error("Erro ao criar categoria:", error);
            if (error.message.includes("obrigatório") ||
                error.message.includes("Já existe")) {
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
            const category = await categoryService_1.default.updateCategory(id, req.body);
            res.json(category);
        }
        catch (error) {
            console.error("Erro ao atualizar categoria:", error);
            if (error.message.includes("não encontrada")) {
                res.status(404).json({ error: error.message });
            }
            else if (error.message.includes("obrigatório") ||
                error.message.includes("Já existe") ||
                error.message.includes("não pode estar vazio")) {
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
            const result = await categoryService_1.default.deleteCategory(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar categoria:", error);
            if (error.message.includes("não encontrada")) {
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
exports.default = new CategoryController();
