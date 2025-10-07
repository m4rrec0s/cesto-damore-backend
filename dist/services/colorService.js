"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
const prismaRetry_1 = require("../database/prismaRetry");
class ColorService {
    async getAllColors() {
        try {
            return await (0, prismaRetry_1.withRetry)(() => prisma_1.default.colors.findMany({
                orderBy: { name: "asc" },
            }));
        }
        catch (error) {
            throw new Error(`Erro ao buscar cores: ${error.message}`);
        }
    }
    async getColorById(id) {
        if (!id) {
            throw new Error("ID da cor é obrigatório");
        }
        try {
            const color = await (0, prismaRetry_1.withRetry)(() => prisma_1.default.colors.findUnique({
                where: { id },
            }));
            if (!color) {
                throw new Error("Cor não encontrada");
            }
            return color;
        }
        catch (error) {
            if (error.message.includes("não encontrada")) {
                throw error;
            }
            throw new Error(`Erro ao buscar cor: ${error.message}`);
        }
    }
    async createColor(data) {
        if (!data.name || data.name.trim() === "") {
            throw new Error("Nome da cor é obrigatório");
        }
        if (!data.hex_code || !this.isValidHexCode(data.hex_code)) {
            throw new Error("Código hexadecimal inválido");
        }
        try {
            // Verifica se já existe uma cor com este hex_code
            const existing = await prisma_1.default.colors.findUnique({
                where: { hex_code: data.hex_code.toUpperCase() },
            });
            if (existing) {
                throw new Error("Já existe uma cor com este código hexadecimal");
            }
            return await (0, prismaRetry_1.withRetry)(() => prisma_1.default.colors.create({
                data: {
                    name: data.name.trim(),
                    hex_code: data.hex_code.toUpperCase(),
                },
            }));
        }
        catch (error) {
            throw new Error(`Erro ao criar cor: ${error.message}`);
        }
    }
    async updateColor(id, data) {
        if (!id) {
            throw new Error("ID da cor é obrigatório");
        }
        // Verifica se existe
        await this.getColorById(id);
        try {
            const updateData = {};
            if (data.name !== undefined)
                updateData.name = data.name.trim();
            if (data.hex_code !== undefined) {
                if (!this.isValidHexCode(data.hex_code)) {
                    throw new Error("Código hexadecimal inválido");
                }
                updateData.hex_code = data.hex_code.toUpperCase();
            }
            return await (0, prismaRetry_1.withRetry)(() => prisma_1.default.colors.update({
                where: { id },
                data: updateData,
            }));
        }
        catch (error) {
            throw new Error(`Erro ao atualizar cor: ${error.message}`);
        }
    }
    async deleteColor(id) {
        if (!id) {
            throw new Error("ID da cor é obrigatório");
        }
        await this.getColorById(id);
        try {
            await (0, prismaRetry_1.withRetry)(() => prisma_1.default.colors.delete({
                where: { id },
            }));
            return { message: "Cor deletada com sucesso" };
        }
        catch (error) {
            throw new Error(`Erro ao deletar cor: ${error.message}`);
        }
    }
    isValidHexCode(hex) {
        const hexPattern = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        return hexPattern.test(hex);
    }
}
exports.default = new ColorService();
