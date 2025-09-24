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

    return { firebaseUser, user };
  }

  async googleLogin({
    idToken,
    firebaseUid,
    email,
    name,
    imageUrl,
  }: GoogleLoginInput) {
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
    return { idToken, firebaseUid: uid, user, sessionToken };
  }

  async login(email: string, password: string) {
    if (!FIREBASE_API_KEY) throw new Error("FIREBASE_API_KEY não configurada");
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      { email, password, returnSecureToken: true }
    );
    const { idToken, localId: uid } = response.data as {
      idToken: string;
      localId: string;
    };
    const user = await prisma.user.findUnique({ where: { firebaseUId: uid } });
    if (!user) throw new Error("Usuário não encontrado");
    await prisma.user.update({
      where: { firebaseUId: uid },
      data: { updated_at: new Date() },
    });

    // Criar tokens
    const sessionToken = await createCustomToken(uid);
    const appToken = createAppJWT(user.id, user.email); // Novo token JWT interno

    return {
      idToken,
      firebaseUid: uid,
      user,
      sessionToken,
      appToken, // Retornar o token da aplicação
    };
  }
}

export default new AuthService();
