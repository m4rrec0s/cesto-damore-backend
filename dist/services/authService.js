"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../config/firebase");
const axios_1 = __importDefault(require("axios"));
const prisma_1 = __importDefault(require("../database/prisma"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
function ensureGoogleOAuthTokens() {
    const requiredVars = [
        "GOOGLE_OAUTH_ACCESS_TOKEN",
        "GOOGLE_OAUTH_REFRESH_TOKEN",
        "GOOGLE_OAUTH_TOKEN_TYPE",
    ];
    const missingVars = requiredVars.filter((envVar) => !process.env[envVar]);
    if (missingVars.length > 0) {
        throw new Error(`Configuração OAuth do Google incompleta. Defina as variáveis: ${missingVars.join(", ")}`);
    }
    const expiryRaw = process.env.GOOGLE_OAUTH_EXPIRY_DATE;
    if (expiryRaw) {
        const expiryNumber = Number(expiryRaw);
        if (!Number.isNaN(expiryNumber) && expiryNumber <= Date.now()) {
            throw new Error("Token de acesso do Google expirado. Refaça a autenticação OAuth2 para gerar novos tokens.");
        }
    }
}
// Nova função para criar JWT interno da aplicação
function createAppJWT(userId, email) {
    const jwtSecret = process.env.JWT_SECRET || "fallback-secret-key";
    return jsonwebtoken_1.default.sign({
        userId,
        email,
        type: "app-token",
    }, jwtSecret, {
        expiresIn: "7d", // Token dura 7 dias
    });
}
class AuthService {
    async register({ firebaseUid, email, name, imageUrl }) {
        const existingUser = await prisma_1.default.user.findUnique({
            where: { firebaseUId: firebaseUid },
        });
        if (existingUser)
            throw new Error("Usuário já registrado");
        const user = await prisma_1.default.user.create({
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
    async registerWithEmail(email, password, name, imageUrl) {
        // cria usuário no Firebase Auth via admin SDK
        const firebaseUser = await firebase_1.auth.createUser({
            email,
            password,
            displayName: name,
            photoURL: imageUrl ?? undefined,
        });
        // cria usuário local no DB
        const user = await prisma_1.default.user.create({
            data: {
                firebaseUId: firebaseUser.uid,
                email,
                name,
                image_url: imageUrl ?? null,
            },
        });
        return { firebaseUser, user };
    }
    async googleLogin({ idToken, firebaseUid, email, name, imageUrl, }) {
        // Removi a verificação ensureGoogleOAuthTokens() porque ela é para Google Drive API
        // A autenticação do Firebase não depende das credenciais OAuth do Drive
        const decoded = (await firebase_1.auth.verifyIdToken(idToken));
        const uid = decoded.uid;
        if (firebaseUid && firebaseUid !== uid)
            throw new Error("firebaseUid não corresponde ao idToken");
        // prefer Google picture from the decoded token, fallback to provided imageUrl
        const googlePicture = decoded.picture ?? imageUrl;
        let user = await prisma_1.default.user.findUnique({ where: { firebaseUId: uid } });
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
        const updateData = { updated_at: new Date() };
        if (googlePicture && user.image_url !== googlePicture) {
            updateData.image_url = googlePicture;
        }
        await prisma_1.default.user.update({
            where: { firebaseUId: uid },
            data: updateData,
        });
        const sessionToken = await (0, firebase_1.createCustomToken)(uid);
        const appToken = createAppJWT(user.id, user.email); // Criar token da aplicação
        return { idToken, firebaseUid: uid, user, sessionToken, appToken };
    }
    async login(email, password) {
        if (!FIREBASE_API_KEY)
            throw new Error("FIREBASE_API_KEY não configurada");
        const response = await axios_1.default.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, { email, password, returnSecureToken: true });
        const { idToken, localId: uid } = response.data;
        const user = await prisma_1.default.user.findUnique({ where: { firebaseUId: uid } });
        if (!user)
            throw new Error("Usuário não encontrado");
        await prisma_1.default.user.update({
            where: { firebaseUId: uid },
            data: { updated_at: new Date() },
        });
        // Criar tokens
        const sessionToken = await (0, firebase_1.createCustomToken)(uid);
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
exports.default = new AuthService();
