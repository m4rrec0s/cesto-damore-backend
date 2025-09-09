"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class UserService {
    async getAllUsers() {
        try {
            return await prisma_1.default.user.findMany();
        }
        catch (error) {
            throw new Error(`Erro ao buscar usuários: ${error.message}`);
        }
    }
    async getUserById(id) {
        if (!id) {
            throw new Error("ID do usuário é obrigatório");
        }
        try {
            const user = await prisma_1.default.user.findUnique({ where: { id } });
            if (!user) {
                throw new Error("Usuário não encontrado");
            }
            return user;
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                throw error;
            }
            throw new Error(`Erro ao buscar usuário: ${error.message}`);
        }
    }
    async createUser(data) {
        // Validações de campos obrigatórios
        if (!data.name || data.name.trim() === "") {
            throw new Error("Nome do usuário é obrigatório");
        }
        if (!data.email || data.email.trim() === "") {
            throw new Error("Email do usuário é obrigatório");
        }
        if (!data.firebaseUId || data.firebaseUId.trim() === "") {
            throw new Error("Firebase UID é obrigatório");
        }
        // Validação de formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
            throw new Error("Formato de email inválido");
        }
        try {
            // Verifica se o email já existe
            const existingUser = await prisma_1.default.user.findFirst({
                where: {
                    OR: [{ email: data.email }, { firebaseUId: data.firebaseUId }],
                },
            });
            if (existingUser) {
                if (existingUser.email === data.email) {
                    throw new Error("Email já está em uso");
                }
                if (existingUser.firebaseUId === data.firebaseUId) {
                    throw new Error("Usuário já registrado");
                }
            }
            return await prisma_1.default.user.create({ data });
        }
        catch (error) {
            if (error.message.includes("obrigatório") ||
                error.message.includes("inválido") ||
                error.message.includes("já")) {
                throw error;
            }
            throw new Error(`Erro ao criar usuário: ${error.message}`);
        }
    }
    async updateUser(id, data) {
        if (!id) {
            throw new Error("ID do usuário é obrigatório");
        }
        // Verifica se o usuário existe
        await this.getUserById(id);
        // Validação de email se fornecido
        if (data.email && data.email.trim() !== "") {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data.email)) {
                throw new Error("Formato de email inválido");
            }
            // Verifica se o email já está em uso por outro usuário
            const existingUser = await prisma_1.default.user.findFirst({
                where: {
                    email: data.email,
                    id: { not: id },
                },
            });
            if (existingUser) {
                throw new Error("Email já está em uso por outro usuário");
            }
        }
        try {
            return await prisma_1.default.user.update({ where: { id }, data });
        }
        catch (error) {
            if (error.message.includes("não encontrado") ||
                error.message.includes("obrigatório") ||
                error.message.includes("inválido")) {
                throw error;
            }
            throw new Error(`Erro ao atualizar usuário: ${error.message}`);
        }
    }
    async deleteUser(id) {
        if (!id) {
            throw new Error("ID do usuário é obrigatório");
        }
        // Verifica se o usuário existe
        await this.getUserById(id);
        try {
            // Verifica se o usuário tem pedidos
            const orders = await prisma_1.default.order.count({ where: { user_id: id } });
            if (orders > 0) {
                throw new Error("Não é possível deletar usuário que possui pedidos");
            }
            await prisma_1.default.user.delete({ where: { id } });
            return { message: "Usuário deletado com sucesso" };
        }
        catch (error) {
            if (error.message.includes("Não é possível deletar") ||
                error.message.includes("não encontrado")) {
                throw error;
            }
            throw new Error(`Erro ao deletar usuário: ${error.message}`);
        }
    }
    // Métodos de compatibilidade com o código existente
    async list() {
        return this.getAllUsers();
    }
    async getById(id) {
        try {
            return await this.getUserById(id);
        }
        catch (error) {
            if (error.message.includes("não encontrado")) {
                return null;
            }
            throw error;
        }
    }
    async create(data) {
        return this.createUser(data);
    }
    async update(id, data) {
        return this.updateUser(id, data);
    }
    async remove(id) {
        return this.deleteUser(id);
    }
}
exports.default = new UserService();
