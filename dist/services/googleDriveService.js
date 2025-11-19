"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const googleapis_1 = require("googleapis");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
const crypto_1 = __importDefault(require("crypto"));
class GoogleDriveService {
    constructor() {
        this.isServiceAccount = false;
        this.serviceAccountEmail = null;
        this.rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
        this.customizationsDir = path_1.default.join(process.cwd(), "images", "customizations");
        this.tokenPath = path_1.default.join(process.cwd(), "google-drive-token.json");
        this.baseUrl = process.env.BASE_URL || "";
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
        const attemptServiceAccount = Boolean(serviceAccountKey ||
            serviceAccountKeyPath ||
            process.env.GOOGLE_PRIVATE_KEY);
        if (attemptServiceAccount) {
            let keyJson;
            try {
                if (serviceAccountKey)
                    keyJson = JSON.parse(serviceAccountKey);
                else
                    keyJson = JSON.parse(require("fs").readFileSync(serviceAccountKeyPath, "utf-8"));
            }
            catch (err) {
                console.error("❌ Falha ao carregar chave da Service Account:", err);
                keyJson = null;
            }
            if (!keyJson &&
                process.env.GOOGLE_PRIVATE_KEY &&
                process.env.GOOGLE_CLIENT_EMAIL) {
                try {
                    const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
                    const private_key = String(privateKeyRaw).replace(/\\n/g, "\n");
                    keyJson = {
                        type: "service_account",
                        project_id: process.env.GOOGLE_PROJECT_ID || undefined,
                        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || undefined,
                        private_key,
                        client_email: process.env.GOOGLE_CLIENT_EMAIL,
                        client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
                        auth_uri: process.env.GOOGLE_AUTH_URI,
                        token_uri: process.env.GOOGLE_TOKEN_URI,
                        auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
                        client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
                    };
                }
                catch (err) {
                    console.warn("⚠️ Falha ao montar Service Account key JSON a partir das env vars:", String(err));
                }
            }
            if (keyJson) {
                if (keyJson.private_key && typeof keyJson.private_key === "string") {
                    try {
                        crypto_1.default.createPrivateKey({
                            key: keyJson.private_key,
                            format: "pem",
                        });
                        console.log("✅ Private key PEM validation passed");
                    }
                    catch (err) {
                        console.warn("⚠️ Private key PEM validation failed, but continuing:", String(err));
                    }
                }
                this.isServiceAccount = false;
                this.saInitPromise = this.initServiceAccount(keyJson).catch((err) => {
                    console.log("🔄 Service Account failed, initializing OAuth fallback");
                    this.oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
                    this.setupOAuth2Client(this.oauth2Client);
                    this.drive = googleapis_1.google.drive({ version: "v3", auth: this.oauth2Client });
                    this.isServiceAccount = false;
                    this.loadSavedTokens();
                    return;
                });
            }
        }
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            console.error("❌ GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não definidos");
            console.error(`🔍 GOOGLE_CLIENT_ID: ${clientId ? "definido" : "NÃO DEFINIDO"}`);
            console.error(`🔍 GOOGLE_CLIENT_SECRET: ${clientSecret ? "definido" : "NÃO DEFINIDO"}`);
            throw new Error("Credenciais OAuth2 do Google não configuradas");
        }
        this.oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
        this.setupOAuth2Client(this.oauth2Client);
        this.drive = googleapis_1.google.drive({ version: "v3", auth: this.oauth2Client });
        this.isServiceAccount = false;
        this.loadSavedTokens();
    }
    setupOAuth2Client(client) {
        client.on("tokens", async (tokens) => {
            console.log("Tokens atualizados pelo Google");
            const current = client.credentials || {};
            const updated = { ...current, ...tokens };
            // NUNCA perca o refresh_token
            if (current.refresh_token && !tokens.refresh_token) {
                updated.refresh_token = current.refresh_token;
                console.log("Refresh token preservado");
            }
            else if (tokens.refresh_token) {
                console.log("Novo refresh token recebido!");
            }
            client.setCredentials(updated);
            await this.saveTokens(updated);
        });
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
    async initServiceAccount(keyJson) {
        try {
            // Normalize private key according to Google documentation
            if (keyJson.private_key && typeof keyJson.private_key === "string") {
                let pk = keyJson.private_key;
                console.log(`🔑 Original private key length: ${pk.length}`);
                console.log(`🔑 Starts with quote: ${pk.startsWith('"')}`);
                console.log(`🔑 Ends with quote: ${pk.endsWith('"')}`);
                console.log(`🔑 Contains backslash n: ${pk.includes("\\n")}`);
                console.log(`🔑 Contains BEGIN marker: ${pk.includes("-----BEGIN PRIVATE KEY-----")}`);
                // Remove surrounding quotes if they exist
                if (pk.startsWith('"') && pk.endsWith('"')) {
                    pk = pk.substring(1, pk.length - 1);
                    console.log(`🔑 After quote removal length: ${pk.length}`);
                }
                // Replace literal \n with actual newlines
                pk = pk.replace(/\\n/g, "\n");
                console.log(`🔑 After newline replacement length: ${pk.length}`);
                // Ensure proper PEM format
                if (!pk.includes("-----BEGIN PRIVATE KEY-----")) {
                    // Remove any existing headers/footers first
                    pk = pk
                        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
                        .replace(/-----END PRIVATE KEY-----/g, "")
                        .trim();
                    // Add proper headers
                    pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;
                    console.log(`🔑 After PEM formatting length: ${pk.length}`);
                }
                keyJson.private_key = pk;
                console.log(`🔑 Final private key length: ${pk.length}`);
                console.log(`🔑 Final key starts with BEGIN: ${pk.startsWith("-----BEGIN PRIVATE KEY-----")}`);
                console.log(`🔑 Final key ends with END: ${pk.endsWith("-----END PRIVATE KEY-----")}`);
            }
            // Create GoogleAuth instance with credentials
            const auth = new googleapis_1.google.auth.GoogleAuth({
                credentials: keyJson,
                scopes: [
                    "https://www.googleapis.com/auth/drive.file",
                    "https://www.googleapis.com/auth/drive",
                ],
            });
            const client = await auth.getClient();
            this.oauth2Client = client;
            this.setupOAuth2Client(this.oauth2Client);
            this.drive = googleapis_1.google.drive({ version: "v3", auth: client });
            this.isServiceAccount = true;
            this.serviceAccountEmail = keyJson.client_email || null;
            console.log("✅ Google Drive: Service Account mode active for", this.serviceAccountEmail);
            // Log key details for debugging
            if (keyJson.private_key) {
                console.log(`🔐 Service Account private key length: ${keyJson.private_key.length}`);
                console.log(`🔐 Service Account email: ${this.serviceAccountEmail}`);
                console.log(`🔐 Service Account project_id: ${keyJson.project_id}`);
            }
            console.log("✅ Service Account initialized successfully");
        }
        catch (err) {
            this.isServiceAccount = false;
            this.serviceAccountEmail = null;
            console.error("❌ Falha ao inicializar Service Account:", String(err));
        }
    }
    async saveTokens(tokens) {
        try {
            let existing = {};
            try {
                const data = await promises_1.default.readFile(this.tokenPath, "utf-8");
                existing = JSON.parse(data);
            }
            catch (_) { }
            const finalTokens = {
                ...existing,
                ...tokens,
                refresh_token: tokens.refresh_token || existing.refresh_token,
            };
            await promises_1.default.writeFile(this.tokenPath, JSON.stringify(finalTokens, null, 2));
            console.log("Tokens salvos com sucesso");
            try {
                await this.updateEnvFile(finalTokens);
            }
            catch (_) { }
        }
        catch (error) {
            console.error("Erro ao salvar tokens:", error);
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
            console.log("✅ Arquivo .env atualizado com sucesso");
        }
        catch (error) {
            if (process.env.NODE_ENV === "production") {
                console.warn("⚠️ Não é possível atualizar .env em produção (variáveis gerenciadas pelo ambiente)");
            }
            else {
                console.error("❌ Erro ao atualizar .env:", error);
            }
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
        if (!this.oauth2Client) {
            throw new Error("Cliente OAuth2 não inicializado");
        }
        const scopes = [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive.readonly",
        ];
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        if (!redirectUri) {
            throw new Error("GOOGLE_REDIRECT_URI não definido");
        }
        // Validar formato do redirect_uri
        if (!redirectUri.startsWith("http://") &&
            !redirectUri.startsWith("https://")) {
            throw new Error(`GOOGLE_REDIRECT_URI deve começar com http:// ou https://. Valor atual: ${redirectUri}`);
        }
        console.log("🔗 Gerando URL de autenticação OAuth2");
        console.log(`🔗 Redirect URI: ${redirectUri}`);
        console.log(`🔗 Scopes: ${scopes.join(", ")}`);
        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: scopes,
            include_granted_scopes: true,
            redirect_uri: redirectUri,
        });
        console.log(`🔗 URL gerada: ${authUrl.substring(0, 100)}...`);
        return authUrl;
    }
    async getTokensFromCode(code) {
        try {
            const { tokens } = await this.oauth2Client.getToken({
                code,
            });
            this.oauth2Client.setCredentials(tokens);
            await this.saveTokens(tokens);
            return tokens;
        }
        catch (error) {
            console.error("❌ Erro ao obter tokens:", error.message);
            throw new Error("Falha ao autenticar com Google Drive");
        }
    }
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
        if (this.isServiceAccount) {
            // Service account uses JWT - always valid unless misconfigured
            return;
        }
        if (!this.oauth2Client.credentials) {
            throw new Error("Não autenticado. Execute o fluxo OAuth2 via GET /oauth/authorize");
        }
        const { access_token, refresh_token } = this.oauth2Client.credentials;
        if (!access_token && !refresh_token) {
            throw new Error("Credenciais OAuth2 insuficientes. Execute o fluxo OAuth2 via GET /oauth/authorize");
        }
        // Se não temos access_token mas temos refresh_token, o cliente vai atualizar automaticamente na próxima chamada
        console.log("🔍 Credenciais OAuth2 verificadas - cliente atualizará automaticamente se necessário");
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
    async clearTokens() {
        try {
            if (this.tokenPath &&
                (await promises_1.default.stat(this.tokenPath).catch(() => false))) {
                await promises_1.default.unlink(this.tokenPath);
            }
            // Clear in-memory credentials
            if (this.oauth2Client)
                this.oauth2Client.credentials = {};
            console.log("✅ Google Drive tokens cleared");
        }
        catch (err) {
            console.warn("Não foi possível remover token local:", String(err));
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
            try {
                // try to make file public (if allowed)
                await this.drive.permissions.create({
                    fileId: response.data.id,
                    requestBody: {
                        role: "reader",
                        type: "anyone",
                    },
                });
            }
            catch (permErr) {
                // For service accounts or restricted drives, setting permissions might fail - log and continue
                console.warn("Could not set file permissions to anyone: ", String(permErr));
            }
            const directImageUrl = `https://drive.google.com/uc?id=${response.data.id}`;
            return {
                id: response.data.id,
                name: response.data.name,
                webViewLink: response.data.webViewLink || directImageUrl,
                webContentLink: response.data.webContentLink || directImageUrl,
            };
        }
        catch (error) {
            console.error("❌ Erro ao fazer upload via buffer:", String(error));
            console.error("🔎 folderId usado no upload:", folderId);
            // Detect specific errors and provide actionable messages
            const message = String(error?.message || error);
            if (message.includes("invalid_grant") ||
                message.includes("invalid_grant")) {
                throw new Error("Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize");
            }
            if (message.includes("File not found") ||
                message.includes("file not found")) {
                throw new Error("Arquivo não encontrado ou Drive configurado incorretamente. Verifique o folderId/permissões e se o Drive configurado está acessível");
            }
            if (this.isServiceAccount &&
                (message.includes("insufficientFilePermissions") ||
                    message.includes("Forbidden") ||
                    message.includes("permission"))) {
                const email = this.serviceAccountEmail || "<service-account-email>";
                throw new Error(`Permissão negada: a Service Account ${email} não tem acesso à pasta/folderId. Compartilhe a pasta no Drive com esse email ou use OAuth para autorizar um usuário de conta do Drive.`);
            }
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
        if (this.isServiceAccount)
            return true;
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
            isServiceAccount: this.isServiceAccount,
            serviceAccountEmail: this.serviceAccountEmail,
        };
    }
    getServiceAccountInfo() {
        return { enabled: this.isServiceAccount, email: this.serviceAccountEmail };
    }
    async debugServiceAccount() {
        const info = {
            isServiceAccount: this.isServiceAccount,
            serviceAccountEmail: this.serviceAccountEmail,
            hasOAuthClient: !!this.oauth2Client,
            hasDriveClient: !!this.drive,
            rootFolderId: this.rootFolderId,
            tokenPath: this.tokenPath,
            baseUrl: this.baseUrl,
        };
        if (this.isServiceAccount && this.oauth2Client) {
            try {
                const token = await this.oauth2Client.getAccessToken();
                info.tokenObtained = !!token;
                info.tokenExpiry = token?.res?.data?.expiry_date;
            }
            catch (err) {
                info.tokenError = String(err);
            }
        }
        return info;
    }
}
exports.default = new GoogleDriveService();
