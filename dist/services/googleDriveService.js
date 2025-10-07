"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const googleapis_1 = require("googleapis");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
class GoogleDriveService {
    constructor() {
        this.rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
        this.customizationsDir = path_1.default.join(process.cwd(), "images", "customizations");
        this.tokenPath = path_1.default.join(process.cwd(), "google-drive-token.json");
        this.baseUrl = process.env.BASE_URL || "http://localhost:8080";
        const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
            "http://localhost:8080/api/oauth/callback";
        this.oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
        this.drive = googleapis_1.google.drive({ version: "v3", auth: this.oauth2Client });
        this.loadSavedTokens();
    }
    /**
     * Carrega tokens OAuth2 salvos do arquivo
     */
    async loadSavedTokens() {
        try {
            const tokenFile = await promises_1.default.readFile(this.tokenPath, "utf-8");
            const tokens = JSON.parse(tokenFile);
            this.oauth2Client.setCredentials(tokens);
            console.log("✅ Tokens OAuth2 carregados com sucesso");
        }
        catch (error) {
            console.warn("⚠️ Arquivo de tokens não encontrado ou inválido. Execute a autenticação OAuth2.");
        }
    }
    /**
     * Salva tokens OAuth2 no arquivo
     */
    async saveTokens(tokens) {
        try {
            await promises_1.default.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
            console.log("✅ Tokens OAuth2 salvos com sucesso em:", this.tokenPath);
        }
        catch (error) {
            console.error("❌ Erro ao salvar tokens:", error);
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
            console.log("✅ Autenticação OAuth2 concluída com sucesso!");
            console.log("📝 Refresh token:", tokens.refresh_token ? "✅ Obtido" : "❌ Não obtido");
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
            this.oauth2Client.setCredentials(credentials);
            await this.saveTokens(credentials);
            console.log("✅ Access token renovado automaticamente");
        }
        catch (error) {
            console.error("❌ Erro ao renovar access token:", error.message);
            throw new Error("Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize");
        }
    }
    /**
     * Verifica se precisa renovar token antes de cada operação
     */
    async ensureValidToken() {
        if (!this.oauth2Client.credentials) {
            throw new Error("Não autenticado. Execute o fluxo OAuth2.");
        }
        const { expiry_date } = this.oauth2Client.credentials;
        if (!expiry_date || expiry_date < Date.now() + 60000) {
            console.log("🔄 Token expirado ou próximo de expirar, renovando...");
            await this.refreshAccessToken();
        }
    }
    /**
     * Cria uma pasta no Google Drive
     */
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
            console.log(`📁 Pasta criada no Google Drive: ${response.data.name} (${response.data.id})`);
            return response.data.id;
        }
        catch (error) {
            console.error("❌ Erro ao criar pasta no Google Drive:", error.message);
            throw new Error("Falha ao criar pasta de customização no Google Drive");
        }
    }
    /**
     * Faz upload de um arquivo para o Google Drive
     */
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
            console.log(`📤 Arquivo enviado para Google Drive: ${response.data.name}`);
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
        console.log(`✅ ${results.length} arquivo(s) enviado(s) para o Google Drive`);
        return results;
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
            console.log(`🗑️ Arquivo deletado do Google Drive: ${fileId}`);
        }
        catch (error) {
            console.error("❌ Erro ao deletar arquivo:", error.message);
            throw new Error("Falha ao deletar arquivo do Google Drive");
        }
    }
    /**
     * Deleta uma pasta e todos os seus arquivos
     */
    async deleteFolder(folderId) {
        try {
            await this.ensureValidToken();
            const files = await this.listFiles(folderId);
            await Promise.all(files.map((file) => this.deleteFile(file.id)));
            await this.drive.files.delete({
                fileId: folderId,
            });
            console.log(`🗑️ Pasta deletada do Google Drive: ${folderId}`);
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
            console.log(`🔓 Pasta ${folderId} tornada pública`);
        }
        catch (error) {
            console.error("❌ Erro ao tornar pasta pública:", error.message);
        }
    }
    /**
     * Verifica se o serviço está configurado e autenticado
     */
    isConfigured() {
        return (!!this.oauth2Client.credentials?.access_token ||
            !!this.oauth2Client.credentials?.refresh_token);
    }
    /**
     * Obtém informações sobre a configuração atual
     */
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
