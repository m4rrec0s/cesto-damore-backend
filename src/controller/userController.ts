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

  async me(req: any, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Usuário não autenticado" });
      }

      const user = await userService.getUserById(req.user.id);
      res.json(user);
    } catch (error: any) {
      console.error("Erro ao buscar usuário atual:", error);
      if (error.message.includes("não encontrado")) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async getAddressByZipCode(req: Request, res: Response) {
    try {
      const { zipCode } = req.params;

      if (!zipCode) {
        return res.status(400).json({ error: "CEP é obrigatório" });
      }

      const addressInfo = await userService.getAddressByZipCode(zipCode);
      res.json(addressInfo);
    } catch (error: any) {
      console.error("Erro ao consultar CEP:", error);

      if (
        error.message.includes("CEP deve ter 8 dígitos") ||
        error.message.includes("Formato de CEP inválido")
      ) {
        res.status(400).json({ error: error.message });
      } else if (error.message.includes("CEP não encontrado")) {
        res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("Timeout") ||
        error.message.includes("temporariamente indisponível")
      ) {
        res.status(503).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }
}

export default new UserController();
