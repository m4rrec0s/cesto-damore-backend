"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const colorService_1 = __importDefault(require("../services/colorService"));
class ColorController {
    async index(req, res) {
        try {
            const colors = await colorService_1.default.getAllColors();
            res.json(colors);
        }
        catch (error) {
            console.error("Erro ao buscar cores:", error);
            res.status(500).json({
                error: "Erro ao buscar cores",
                message: error.message,
            });
        }
    }
    async show(req, res) {
        try {
            const { id } = req.params;
            const color = await colorService_1.default.getColorById(id);
            res.json(color);
        }
        catch (error) {
            console.error("Erro ao buscar cor:", error);
            const status = error.message.includes("não encontrada") ? 404 : 500;
            res.status(status).json({
                error: "Erro ao buscar cor",
                message: error.message,
            });
        }
    }
    async create(req, res) {
        try {
            const color = await colorService_1.default.createColor(req.body);
            res.status(201).json(color);
        }
        catch (error) {
            console.error("Erro ao criar cor:", error);
            res.status(400).json({
                error: "Erro ao criar cor",
                message: error.message,
            });
        }
    }
    async update(req, res) {
        try {
            const { id } = req.params;
            const color = await colorService_1.default.updateColor(id, req.body);
            res.json(color);
        }
        catch (error) {
            console.error("Erro ao atualizar cor:", error);
            const status = error.message.includes("não encontrada") ? 404 : 400;
            res.status(status).json({
                error: "Erro ao atualizar cor",
                message: error.message,
            });
        }
    }
    async remove(req, res) {
        try {
            const { id } = req.params;
            const result = await colorService_1.default.deleteColor(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao deletar cor:", error);
            const status = error.message.includes("não encontrada") ? 404 : 500;
            res.status(status).json({
                error: "Erro ao deletar cor",
                message: error.message,
            });
        }
    }
}
exports.default = new ColorController();
