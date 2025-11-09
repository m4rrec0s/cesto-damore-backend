"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const googleapis_1 = require("googleapis");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
class GoogleDriveService {
    constructor() {
        this.rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
        this.customizationsDir = path_1.default.join(process.cwd(), "images", "customizations");
        this.tokenPath = path_1.default.join(process.cwd(), "google-drive-token.json");
        this.baseUrl = process.env.BASE_URL || "";
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        this.oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
        this.drive = googleapis_1.google.drive({ version: "v3", auth: this.oauth2Client });
        this.loadSavedTokens();
    }
    getTokensFromEnv() {
        const accessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
        const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
        const scope = process.env.GOOGLE_OAUTH_SCOPE;
        const tokenType = process.env.GOOGLE_OAUTH_TOKEN_TYPE;
        const expiryDateRaw = process.env.GOOGLE_OAUTH_EXPIRY_DATE;
        if (!accessToken && !refreshToken) {
            return null;
        }
        const tokens = {};
        if (accessToken)
            tokens.access_token = accessToken;
        if (refreshToken)
            tokens.refresh_token = refreshToken;
        if (scope)
            tokens.scope = scope;
        if (tokenType)
            tokens.token_type = tokenType;
        if (expiryDateRaw) {
            const expiryDateNumber = Number(expiryDateRaw);
            if (!Number.isNaN(expiryDateNumber)) {
                tokens.expiry_date = expiryDateNumber;
            }
        }
        return tokens;
    }
    /**
     * Carrega tokens OAuth2 salvos do arquivo
     */
    async loadSavedTokens() {
        const envTokens = this.getTokensFromEnv();
        if (envTokens) {
            this.oauth2Client.setCredentials(envTokens);
            return;
        }
        try {
            const tokenFile = await promises_1.default.readFile(this.tokenPath, "utf-8");
            const tokens = JSON.parse(tokenFile);
            this.oauth2Client.setCredentials(tokens);
        }
        catch (error) {
            console.warn("⚠️ Arquivo de tokens não encontrado ou inválido. Execute a autenticação OAuth2.");
        }
    }
    async saveTokens(tokens) {
        try {
            await promises_1.default.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
            await this.updateEnvFile(tokens);
        }
        catch (error) {
            console.error("❌ Erro ao salvar tokens:", error);
        }
    }
    async updateEnvFile(tokens) {
        try {
            const envPath = path_1.default.join(process.cwd(), ".env");
            let envContent = await promises_1.default.readFile(envPath, "utf-8");
            if (tokens.access_token) {
                envContent = this.updateEnvVariable(envContent, "GOOGLE_OAUTH_ACCESS_TOKEN", tokens.access_token);
            }
            if (tokens.refresh_token) {
                envContent = this.updateEnvVariable(envContent, "GOOGLE_OAUTH_REFRESH_TOKEN", tokens.refresh_token);
            }
            if (tokens.expiry_date) {
                envContent = this.updateEnvVariable(envContent, "GOOGLE_OAUTH_EXPIRY_DATE", tokens.expiry_date.toString());
            }
            if (tokens.scope) {
                envContent = this.updateEnvVariable(envContent, "GOOGLE_OAUTH_SCOPE", `"${tokens.scope}"`);
            }
            if (tokens.token_type) {
                envContent = this.updateEnvVariable(envContent, "GOOGLE_OAUTH_TOKEN_TYPE", tokens.token_type);
            }
            await promises_1.default.writeFile(envPath, envContent, "utf-8");
        }
        catch (error) {
            console.error("❌ Erro ao atualizar .env:", error);
        }
    }
    /**
     * Atualiza ou adiciona uma variável no conteúdo do .env
     */
    updateEnvVariable(content, key, value) {
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(content)) {
            // Atualizar valor existente
            return content.replace(regex, `${key}=${value}`);
        }
        else {
            // Adicionar nova variável
            return content + `\n${key}=${value}`;
        }
    }
    /**
     * Gera URL de autenticação OAuth2
     */
    getAuthUrl() {
        const scopes = [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive.readonly",
        ];
        return this.oauth2Client.generateAuthUrl({
            access_type: "offline",
            scope: scopes,
            prompt: "consent",
        });
    }
    /**
     * Troca código de autorização por tokens de acesso
     */
    async getTokensFromCode(code) {
        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            await this.saveTokens(tokens);
            return tokens;
        }
        catch (error) {
            console.error("❌ Erro ao obter tokens:", error.message);
            throw new Error("Falha ao autenticar com Google Drive");
        }
    }
    /**
     * Renova o token de acesso se estiver expirado
     */
    async refreshAccessToken() {
        try {
            const { credentials } = await this.oauth2Client.refreshAccessToken();
            const updatedTokens = {
                ...this.oauth2Client.credentials,
                ...credentials,
            };
            this.oauth2Client.setCredentials(updatedTokens);
            await this.saveTokens(updatedTokens);
        }
        catch (error) {
            console.error("❌ Erro ao renovar access token:", error.message);
            throw new Error("Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize");
        }
    }
    async ensureValidToken() {
        if (!this.oauth2Client.credentials) {
            throw new Error("Não autenticado. Execute o fluxo OAuth2 via GET /oauth/authorize");
        }
        const { expiry_date, refresh_token } = this.oauth2Client.credentials;
        if (!expiry_date) {
            if (!refresh_token) {
                throw new Error("Token inválido. Execute o fluxo OAuth2 via GET /oauth/authorize");
            }
            await this.refreshAccessToken();
            return;
        }
        const expiresIn = expiry_date - Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        if (expiresIn < fiveMinutes) {
            if (!refresh_token) {
                throw new Error("Refresh token ausente. Execute o fluxo OAuth2 via GET /oauth/authorize");
            }
            await this.refreshAccessToken();
        }
    }
    async createFolder(folderName) {
        try {
            await this.ensureValidToken();
            const fileMetadata = {
                name: folderName,
                mimeType: "application/vnd.google-apps.folder",
                parents: this.rootFolderId ? [this.rootFolderId] : [],
            };
            const response = await this.drive.files.create({
                requestBody: fileMetadata,
                fields: "id, name",
            });
            return response.data.id;
        }
        catch (error) {
            console.error("❌ Erro ao criar pasta no Google Drive:", error.message);
            throw new Error("Falha ao criar pasta de customização no Google Drive");
        }
    }
    async uploadFile(filePath, fileName, folderId, mimeType) {
        try {
            await this.ensureValidToken();
            const fileMetadata = {
                name: fileName,
                parents: [folderId],
            };
            const media = {
                mimeType: mimeType || "application/octet-stream",
                body: require("fs").createReadStream(filePath),
            };
            const response = await this.drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: "id, name, webViewLink, webContentLink",
            });
            await this.drive.permissions.create({
                fileId: response.data.id,
                requestBody: {
                    role: "reader",
                    type: "anyone",
                },
            });
            const directDownloadUrl = `https://drive.google.com/uc?id=${response.data.id}&export=download`;
            return {
                id: response.data.id,
                name: response.data.name,
                webViewLink: response.data.webViewLink,
                webContentLink: directDownloadUrl,
            };
        }
        catch (error) {
            console.error("❌ Erro ao fazer upload:", error.message);
            throw new Error("Falha ao fazer upload do arquivo para o Google Drive");
        }
    }
    /**
     * Faz upload de múltiplos arquivos
     */
    async uploadMultipleFiles(files, folderId) {
        const uploadPromises = files.map((file) => this.uploadFile(file.path, file.name, folderId, file.mimeType));
        const results = await Promise.all(uploadPromises);
        return results;
    }
    async uploadBuffer(buffer, fileName, folderId, mimeType) {
        try {
            await this.ensureValidToken();
            const fileMetadata = {
                name: fileName,
                parents: [folderId],
            };
            const media = {
                mimeType: mimeType || "application/octet-stream",
                body: stream_1.Readable.from(buffer),
            };
            const response = await this.drive.files.create({
                requestBody: fileMetadata,
                media,
                fields: "id, name, webViewLink, webContentLink",
            });
            await this.drive.permissions.create({
                fileId: response.data.id,
                requestBody: {
                    role: "reader",
                    type: "anyone",
                },
            });
            const directImageUrl = `https://drive.google.com/uc?id=${response.data.id}`;
            return {
                id: response.data.id,
                name: response.data.name,
                webViewLink: directImageUrl, // Usar formato direto no webViewLink
                webContentLink: directImageUrl, // Manter consistência
            };
        }
        catch (error) {
            console.error("❌ Erro ao fazer upload via buffer:", error.message);
            throw new Error("Falha ao fazer upload do arquivo para o Google Drive");
        }
    }
    /**
     * Obtém URL da pasta no Google Drive
     */
    getFolderUrl(folderId) {
        return `https://drive.google.com/drive/folders/${folderId}`;
    }
    /**
     * Obtém URL de visualização de um arquivo
     */
    getFileUrl(fileId) {
        return `https://drive.google.com/file/d/${fileId}/view`;
    }
    /**
     * Obtém URL de download direto de um arquivo
     */
    getDirectDownloadUrl(fileId) {
        return `https://drive.google.com/uc?id=${fileId}&export=download`;
    }
    /**
     * Lista arquivos de uma pasta no Google Drive
     */
    async listFiles(folderId) {
        try {
            await this.ensureValidToken();
            const response = await this.drive.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: "files(id, name, webViewLink, webContentLink, mimeType)",
                orderBy: "name",
            });
            return response.data.files.map((file) => ({
                id: file.id,
                name: file.name,
                webViewLink: file.webViewLink,
                webContentLink: `https://drive.google.com/uc?id=${file.id}&export=download`,
            }));
        }
        catch (error) {
            console.error("❌ Erro ao listar arquivos:", error.message);
            return [];
        }
    }
    /**
     * Deleta um arquivo do Google Drive
     */
    async deleteFile(fileId) {
        try {
            await this.ensureValidToken();
            await this.drive.files.delete({
                fileId: fileId,
            });
        }
        catch (error) {
            console.error("❌ Erro ao deletar arquivo:", error.message);
            throw new Error("Falha ao deletar arquivo do Google Drive");
        }
    }
    async deleteFolder(folderId) {
        try {
            await this.ensureValidToken();
            const files = await this.listFiles(folderId);
            await Promise.all(files.map((file) => this.deleteFile(file.id)));
            await this.drive.files.delete({
                fileId: folderId,
            });
        }
        catch (error) {
            console.error("❌ Erro ao deletar pasta:", error.message);
            throw new Error("Falha ao deletar pasta do Google Drive");
        }
    }
    /**
     * Torna uma pasta pública
     */
    async makeFolderPublic(folderId) {
        try {
            await this.ensureValidToken();
            await this.drive.permissions.create({
                fileId: folderId,
                requestBody: {
                    role: "reader",
                    type: "anyone",
                },
            });
        }
        catch (error) {
            console.error("❌ Erro ao tornar pasta pública:", error.message);
        }
    }
    isConfigured() {
        return (!!this.oauth2Client.credentials?.access_token ||
            !!this.oauth2Client.credentials?.refresh_token);
    }
    getStatus() {
        const credentials = this.oauth2Client.credentials;
        return {
            configured: this.isConfigured(),
            hasAccessToken: !!credentials?.access_token,
            hasRefreshToken: !!credentials?.refresh_token,
            tokenExpiry: credentials?.expiry_date
                ? new Date(credentials.expiry_date)
                : null,
        };
    }
}
exports.default = new GoogleDriveService();
