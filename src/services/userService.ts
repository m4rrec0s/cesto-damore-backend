import prisma from "../database/prisma";
import { CreateUserInput } from "../models/User";
import cepService from "./cepService";

class UserService {
  async getAllUsers() {
    try {
      return await prisma.user.findMany();
    } catch (error: any) {
      throw new Error(`Erro ao buscar usuários: ${error.message}`);
    }
  }

  async getUserById(id: string) {
    if (!id) {
      throw new Error("ID do usuário é obrigatório");
    }

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        throw new Error("Usuário não encontrado");
      }
      return user;
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        throw error;
      }
      throw new Error(`Erro ao buscar usuário: ${error.message}`);
    }
  }

  async createUser(data: CreateUserInput) {

    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome do usuário é obrigatório");
    }
    if (!data.email || data.email.trim() === "") {
      throw new Error("Email do usuário é obrigatório");
    }
    if (!data.firebaseUId || data.firebaseUId.trim() === "") {
      throw new Error("Firebase UID é obrigatório");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      throw new Error("Formato de email inválido");
    }

    if (data.zip_code && data.zip_code.trim() !== "") {
      if (!cepService.validateCepFormat(data.zip_code)) {
        throw new Error(
          "Formato de CEP inválido. Use o formato 00000-000 ou 00000000"
        );
      }
    }

    try {

      const existingUser = await prisma.user.findFirst({
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

      const userData = { ...data };
      if (userData.zip_code && userData.zip_code.trim() !== "") {
        userData.zip_code = cepService.formatCep(userData.zip_code);
      }

      return await prisma.user.create({ data: userData });
    } catch (error: any) {
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido") ||
        error.message.includes("já")
      ) {
        throw error;
      }
      throw new Error(`Erro ao criar usuário: ${error.message}`);
    }
  }

  async updateUser(id: string, data: Partial<CreateUserInput>) {
    if (!id) {
      throw new Error("ID do usuário é obrigatório");
    }

    await this.getUserById(id);

    if (data.email && data.email.trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new Error("Formato de email inválido");
      }

      const existingUser = await prisma.user.findFirst({
        where: {
          email: data.email,
          id: { not: id },
        },
      });

      if (existingUser) {
        throw new Error("Email já está em uso por outro usuário");
      }
    }

    if (data.zip_code && data.zip_code.trim() !== "") {
      if (!cepService.validateCepFormat(data.zip_code)) {
        throw new Error(
          "Formato de CEP inválido. Use o formato 00000-000 ou 00000000"
        );
      }
    }

    try {

      const userData = { ...data };
      if (userData.zip_code && userData.zip_code.trim() !== "") {
        userData.zip_code = cepService.formatCep(userData.zip_code);
      }

      return await prisma.user.update({ where: { id }, data: userData });
    } catch (error: any) {
      if (
        error.message.includes("não encontrado") ||
        error.message.includes("obrigatório") ||
        error.message.includes("inválido")
      ) {
        throw error;
      }
      throw new Error(`Erro ao atualizar usuário: ${error.message}`);
    }
  }

  async deleteUser(id: string) {
    if (!id) {
      throw new Error("ID do usuário é obrigatório");
    }

    await this.getUserById(id);

    try {

      const orders = await prisma.order.count({ where: { user_id: id } });
      if (orders > 0) {
        throw new Error("Não é possível deletar usuário que possui pedidos");
      }

      await prisma.user.delete({ where: { id } });
      return { message: "Usuário deletado com sucesso" };
    } catch (error: any) {
      if (
        error.message.includes("Não é possível deletar") ||
        error.message.includes("não encontrado")
      ) {
        throw error;
      }
      throw new Error(`Erro ao deletar usuário: ${error.message}`);
    }
  }

  async list() {
    return this.getAllUsers();
  }

  async getById(id: string) {
    try {
      return await this.getUserById(id);
    } catch (error: any) {
      if (error.message.includes("não encontrado")) {
        return null;
      }
      throw error;
    }
  }

  async create(data: CreateUserInput) {
    return this.createUser(data);
  }

  async update(id: string, data: Partial<CreateUserInput>) {
    return this.updateUser(id, data);
  }

  async remove(id: string) {
    return this.deleteUser(id);
  }

  async getAddressByZipCode(zipCode: string) {
    try {
      const addressInfo = await cepService.getAddressByCep(zipCode);
      return {
        zip_code: addressInfo.zip_code,
        address: addressInfo.address,
        neighborhood: addressInfo.neighborhood,
        city: addressInfo.city,
        state: addressInfo.state,
        additional_info: {
          ibge_code: addressInfo.ibge_code,
          ddd: addressInfo.ddd,
        },
      };
    } catch (error: any) {
      throw new Error(`Erro ao consultar CEP: ${error.message}`);
    }
  }
}

export default new UserService();
