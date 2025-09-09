import { Request, Response } from "express";
import userService from "../services/userService";
import sharp from "sharp";
import { saveImageLocally } from "../config/localStorage";

class UserController {
  async index(req: Request, res: Response) {
    try {
      const users = await userService.getAllUsers();
      res.json(users);
    } catch (error: any) {
      console.error("Erro ao buscar usuários:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      res.json(user);
    } catch (error: any) {
      console.error("Erro ao buscar usuário:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (error.message.includes("obrigatório")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async create(req: Request, res: Response) {
    try {
      const data = { ...req.body };

      // Processamento de imagem se fornecida
      if (req.file) {
        try {
          const compressedImage = await sharp(req.file.buffer)
            .resize(800, 800, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          const imageUrl = await saveImageLocally(
            compressedImage,
            req.file.originalname || `user_${Date.now()}.jpg`,
            "image/jpeg"
          );

          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro no processamento de imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const user = await userService.createUser(data);
      res.status(201).json(user);
    } catch (error: any) {
      console.error("Erro ao criar usuário:", error);
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido") ||
        error.message.includes("já")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = { ...req.body };

      // Processamento de imagem se fornecida
      if (req.file) {
        try {
          const compressedImage = await sharp(req.file.buffer)
            .resize(800, 800, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          const imageUrl = await saveImageLocally(
            compressedImage,
            req.file.originalname || `user_${Date.now()}.jpg`,
            "image/jpeg"
          );

          data.image_url = imageUrl;
        } catch (imageError: any) {
          console.error("Erro no processamento de imagem:", imageError);
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const user = await userService.updateUser(id, data);
      res.json(user);
    } catch (error: any) {
      console.error("Erro ao atualizar usuário:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("inválido") ||
        error.message.includes("já")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await userService.deleteUser(id);
      res.json(result);
    } catch (error: any) {
      console.error("Erro ao deletar usuário:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("obrigatório") ||
        error.message.includes("Não é possível deletar")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }
}

export default new UserController();
