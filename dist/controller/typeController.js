"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const typeService_1 = __importDefault(require("../services/typeService"));
class TypeController {
    async index(req, res) {
        try {
            const types = await typeService_1.default.getAllTypes();
            res.json(types);
        }
        catch (error) {
            console.error("Erro ao buscar tipos:", error);
            res.status(500).json({ error: "Erro interno do servidor" });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const type = await typeService_1.default.getTypeById(id);
            res.json(type);
        }
        catch (error) {
            console.error("Erro ao buscar tipo:", error);
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
            const type = await typeService_1.default.createType(req.body);
            res.status(201).json(type);
        }
        catch (error) {
            console.error("Erro ao criar tipo:", error);
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
            const type = await typeService_1.default.updateType(id, req.body);
            res.json(type);
        }
        catch (error) {
            console.error("Erro ao atualizar tipo:", error);
            if (error.message.includes("não encontrado")) {
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
            const result = await typeService_1.default.deleteType(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar tipo:", error);
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
exports.default = new TypeController();
