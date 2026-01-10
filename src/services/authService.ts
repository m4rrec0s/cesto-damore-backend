import { auth, createCustomToken } from "../config/firebase";
import axios from "axios";
import prisma from "../database/prisma";
import jwt from "jsonwebtoken";

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

interface RegisterInput {
  firebaseUid: string;
  email: string;
  name: string;
  imageUrl?: string;
}

interface GoogleLoginInput {
  idToken: string;
  firebaseUid?: string;
  email?: string;
  name?: string;
  imageUrl?: string;
}

function ensureGoogleOAuthTokens() {
  const requiredVars = [
    "GOOGLE_OAUTH_ACCESS_TOKEN",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
    "GOOGLE_OAUTH_TOKEN_TYPE",
  ];

  const missingVars = requiredVars.filter((envVar) => !process.env[envVar]);

  if (missingVars.length > 0) {
    throw new Error(
      `Configuração OAuth do Google incompleta. Defina as variáveis: ${missingVars.join(
        ", "
      )}`
    );
  }

  const expiryRaw = process.env.GOOGLE_OAUTH_EXPIRY_DATE;
  if (expiryRaw) {
    const expiryNumber = Number(expiryRaw);
    if (!Number.isNaN(expiryNumber) && expiryNumber <= Date.now()) {
      throw new Error(
        "Token de acesso do Google expirado. Refaça a autenticação OAuth2 para gerar novos tokens."
      );
    }
  }
}

// Nova função para criar JWT interno da aplicação
function createAppJWT(userId: string, email: string) {
  const jwtSecret = process.env.JWT_SECRET || "fallback-secret-key";
  return jwt.sign(
    {
      userId,
      email,
      type: "app-token",
    },
    jwtSecret,
    {
      expiresIn: "7d", // Token dura 7 dias
    }
  );
}

class AuthService {
  async register({ firebaseUid, email, name, imageUrl }: RegisterInput) {
    const existingUser = await prisma.user.findUnique({
      where: { firebaseUId: firebaseUid },
    });
    if (existingUser) throw new Error("Usuário já registrado");
    const user = await prisma.user.create({
      data: {
        firebaseUId: firebaseUid,
        email,
        name,
        image_url: imageUrl ?? null,
      },
    });
    return user;
  }

  // Novo: registra usuário no Firebase (email+senha) e no DB local
  async registerWithEmail(
    email: string,
    password: string,
    name: string,
    imageUrl?: string
  ) {
    try {
      // cria usuário no Firebase Auth via admin SDK
      const firebaseUser = await auth.createUser({
        email,
        password,
        displayName: name,
        photoURL: imageUrl ?? undefined,
      });

      // cria usuário local no DB
      const user = await prisma.user.create({
        data: {
          firebaseUId: firebaseUser.uid,
          email,
          name,
          image_url: imageUrl ?? null,
        },
      });

      // Criar tokens
      const sessionToken = await createCustomToken(firebaseUser.uid);
      const appToken = createAppJWT(user.id, user.email);

      return {
        firebaseUser,
        user,
        sessionToken,
        appToken,
      };
    } catch (error: any) {
      if (error.code === "auth/email-already-exists") {
        throw new Error("Este email já está cadastrado");
      }
      if (error.code === "auth/weak-password") {
        throw new Error("A senha deve ter pelo menos 6 caracteres");
      }
      throw error;
    }
  }

  async googleLogin({
    idToken,
    firebaseUid,
    email,
    name,
    imageUrl,
  }: GoogleLoginInput) {
    // Removi a verificação ensureGoogleOAuthTokens() porque ela é para Google Drive API
    // A autenticação do Firebase não depende das credenciais OAuth do Drive

    const decoded = (await auth.verifyIdToken(idToken as string)) as any;
    const uid = decoded.uid;
    if (firebaseUid && firebaseUid !== uid)
      throw new Error("firebaseUid não corresponde ao idToken");

    // prefer Google picture from the decoded token, fallback to provided imageUrl
    const googlePicture = decoded.picture ?? imageUrl;

    let user = await prisma.user.findUnique({ where: { firebaseUId: uid } });
    if (!user) {
      if (!email || !name)
        throw new Error("Email e nome necessários para registrar");
      user = await this.register({
        firebaseUid: uid,
        email,
        name,
        imageUrl: googlePicture,
      });
    }

    // update updated_at and user's image if Google picture is available and different
    const updateData: any = { updated_at: new Date() };
    if (googlePicture && user.image_url !== googlePicture) {
      updateData.image_url = googlePicture;
    }
    await prisma.user.update({
      where: { firebaseUId: uid },
      data: updateData,
    });

    const sessionToken = await createCustomToken(uid);
    const appToken = createAppJWT(user.id, user.email); // Criar token da aplicação

    return { idToken, firebaseUid: uid, user, sessionToken, appToken };
  }

  async login(email: string, password: string) {
    if (!FIREBASE_API_KEY) throw new Error("FIREBASE_API_KEY não configurada");

    try {
      const response = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        { email, password, returnSecureToken: true }
      );

      const { idToken, localId: uid } = response.data as {
        idToken: string;
        localId: string;
      };

      // Buscar usuário no banco
      let user = await prisma.user.findUnique({ where: { firebaseUId: uid } });

      if (!user) {
        // Se não encontrou por firebaseUId, tentar por email
        user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          // Atualizar firebaseUId se encontrou por email
          user = await prisma.user.update({
            where: { email },
            data: { firebaseUId: uid, updated_at: new Date() },
          });
        } else {
          throw new Error(
            "Usuário não encontrado. Faça login com Google primeiro."
          );
        }
      } else {
        // Atualizar timestamp
        await prisma.user.update({
          where: { firebaseUId: uid },
          data: { updated_at: new Date() },
        });
      }

      // 🔐 Check if 2FA is needed (Admin role)
      if (user.role.toLowerCase() === "admin") {
        const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.user.update({
          where: { id: user.id },
          data: {
            two_factor_code: twoFactorCode,
            two_factor_expires_at: expiresAt,
          },
        });

        console.log(`🔐 [2FA] Código gerado para ${email}: ${twoFactorCode}`);

        return {
          requires2FA: true,
          email: user.email,
        };
      }

      // Criar tokens
      const sessionToken = await createCustomToken(uid);
      const appToken = createAppJWT(user.id, user.email);

      return {
        idToken,
        firebaseUid: uid,
        user,
        sessionToken,
        appToken,
      };
    } catch (error: any) {
      if (error.response?.status === 400) {
        throw new Error(
          "Email ou senha incorretos, ou usuário não registrado no Firebase Auth"
        );
      }
      throw error;
    }
  }

  async verify2FA(email: string, code: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new Error("Usuário não encontrado");
    }

    if (
      !user.two_factor_code ||
      user.two_factor_code !== code ||
      !user.two_factor_expires_at ||
      user.two_factor_expires_at < new Date()
    ) {
      throw new Error("Código 2FA inválido ou expirado");
    }

    // Clear code after successful verification
    await prisma.user.update({
      where: { id: user.id },
      data: {
        two_factor_code: null,
        two_factor_expires_at: null,
      },
    });

    const sessionToken = await createCustomToken(user.firebaseUId!);
    const appToken = createAppJWT(user.id, user.email);

    return {
      user,
      sessionToken,
      appToken,
    };
  }
}

export default new AuthService();
