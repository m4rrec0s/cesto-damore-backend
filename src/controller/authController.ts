import { Request, Response } from "express";
import authService from "../services/authService";
import sharp from "sharp";
import { saveImageLocally } from "../config/localStorage";

class AuthController {
  async google(req: Request, res: Response) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return res.status(400).json({ error: "Token do Google é obrigatório" });
      }

      const result = await authService.googleLogin({ idToken, ...req.body });
      res.json(result);
    } catch (error: any) {
      if (
        error.message.includes("obrigatório") ||
        error.message.includes("necessários")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "Email e senha são obrigatórios" });
      }

      const result = await authService.login(email, password);
      res.json(result);
    } catch (error: any) {
      if (
        error.message.includes("não encontrado") ||
        error.message.includes("não configurada")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  async register(req: Request, res: Response) {
    try {
      const { email, password, name } = req.body;

      if (!email || !password || !name) {
        return res
          .status(400)
          .json({ error: "Email, senha e nome são obrigatórios" });
      }

      let imageUrl: string | undefined = undefined;

      // Processamento de imagem se fornecida
      if (req.file) {
        try {
          const compressedImage = await sharp(req.file.buffer)
            .resize(800, 800, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          imageUrl = await saveImageLocally(
            compressedImage,
            req.file.originalname || `user_${Date.now()}.jpg`,
            "image/jpeg",
          );
        } catch (imageError: any) {
          return res.status(500).json({
            error: "Erro ao processar imagem",
            details: imageError.message,
          });
        }
      }

      const result = await authService.registerWithEmail(
        email,
        password,
        name,
        imageUrl,
      );
      res.status(201).json(result);
    } catch (error: any) {
      if (
        error.message.includes("já registrado") ||
        error.message.includes("obrigatório")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Erro interno do servidor" });
      }
    }
  }

  // Novo método: renovar token
  async refreshToken(req: any, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Usuário não autenticado" });
      }

      // Importar a função aqui para evitar circular dependency
      const jwt = require("jsonwebtoken");
      const jwtSecret = process.env.JWT_SECRET;

      if (!jwtSecret) {
        throw new Error("JWT_SECRET não configurado");
      }

      const newToken = jwt.sign(
        {
          userId: req.user.id,
          email: req.user.email,
          type: "app-token",
        },
        jwtSecret,
        {
          expiresIn: "7d",
        },
      );

      res.json({
        appToken: newToken,
        user: req.user,
        expiresIn: "7 days",
      });
    } catch (error: any) {
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async verify2fa(req: Request, res: Response) {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res
          .status(400)
          .json({ error: "Email e código são obrigatórios" });
      }

      const result = await authService.verify2FA(email, code);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
}

export default new AuthController();
