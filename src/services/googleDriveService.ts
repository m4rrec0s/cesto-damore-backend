import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import logger from "../utils/logger";
import { Readable } from "stream";
// crypto removed - not required when using only OAuth

interface UploadFileOptions {
  filePath: string;
  fileName: string;
  folderId: string;
  mimeType?: string;
}

interface CreateFolderResult {
  id: string;
  url: string;
}

interface UploadFileResult {
  id: string;
  url: string;
}

interface OAuth2Credentials {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

interface UploadedFile {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink: string;
}

class GoogleDriveService {
  private rootFolderId: string;
  private customizationsDir: string;
  private oauth2Client: any;
  private drive: any;
  private tokenPath: string;
  private baseUrl: string;
  // Service Account removed - using OAuth only

  constructor() {
    this.rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
    this.customizationsDir = path.join(
      process.cwd(),
      "images",
      "customizations"
    );
    this.tokenPath = path.join(process.cwd(), "google-drive-token.json");
    this.baseUrl = process.env.BASE_URL || "";

    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    // Removed Service Account flow - using OAuth only

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      logger.error("❌ GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não definidos");
      logger.error(
        `🔍 GOOGLE_CLIENT_ID: ${clientId ? "definido" : "NÃO DEFINIDO"}`
      );
      logger.error(
        `🔍 GOOGLE_CLIENT_SECRET: ${clientSecret ? "definido" : "NÃO DEFINIDO"}`
      );
      throw new Error("Credenciais OAuth2 do Google não configuradas");
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
    this.setupOAuth2Client(this.oauth2Client);
    this.drive = google.drive({ version: "v3", auth: this.oauth2Client });
    // ensure OAuth-only mode (no service account)
    this.loadSavedTokens();
  }

  private setupOAuth2Client(client: any): void {
    client.on("tokens", async (tokens: any) => {
      logger.info("Tokens atualizados pelo Google");

      const current = client.credentials || {};
      const updated: OAuth2Credentials = { ...current, ...tokens };

      // NUNCA perca o refresh_token
      if (current.refresh_token && !tokens.refresh_token) {
        updated.refresh_token = current.refresh_token;
        logger.info("Refresh token preservado");
      } else if (tokens.refresh_token) {
        logger.info("Novo refresh token recebido!");
      }

      client.setCredentials(updated);
      await this.saveTokens(updated);
    });
  }

  private getTokensFromEnv(): OAuth2Credentials | null {
    const accessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const scope = process.env.GOOGLE_OAUTH_SCOPE;
    const tokenType = process.env.GOOGLE_OAUTH_TOKEN_TYPE;
    const expiryDateRaw = process.env.GOOGLE_OAUTH_EXPIRY_DATE;

    if (!accessToken && !refreshToken) {
      return null;
    }

    const tokens: OAuth2Credentials = {};

    if (accessToken) tokens.access_token = accessToken;
    if (refreshToken) tokens.refresh_token = refreshToken;
    if (scope) tokens.scope = scope;
    if (tokenType) tokens.token_type = tokenType;

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
  private async loadSavedTokens(): Promise<void> {
    const envTokens = this.getTokensFromEnv();
    if (envTokens) {
      this.oauth2Client.setCredentials(envTokens);
      return;
    }

    try {
      const tokenFile = await fs.readFile(this.tokenPath, "utf-8");
      const tokens = JSON.parse(tokenFile);
      this.oauth2Client.setCredentials(tokens);
    } catch (error) {
      console.warn(
        "⚠️ Arquivo de tokens não encontrado ou inválido. Execute a autenticação OAuth2."
      );
    }
  }

  // Service Account init removed - OAuth only

  private async saveTokens(tokens: OAuth2Credentials): Promise<void> {
    try {
      let existing: OAuth2Credentials = {};
      try {
        const data = await fs.readFile(this.tokenPath, "utf-8");
        existing = JSON.parse(data);
      } catch (_) {}

      const finalTokens = {
        ...existing,
        ...tokens,
        refresh_token: tokens.refresh_token || existing.refresh_token,
      };

      await fs.writeFile(this.tokenPath, JSON.stringify(finalTokens, null, 2));
      logger.info("Tokens salvos com sucesso");

      try {
        await this.updateEnvFile(finalTokens);
      } catch (_) {}
    } catch (error) {
      console.error("Erro ao salvar tokens:", error);
    }
  }

  private async updateEnvFile(tokens: OAuth2Credentials): Promise<void> {
    try {
      const envPath = path.join(process.cwd(), ".env");
      let envContent = await fs.readFile(envPath, "utf-8");

      if (tokens.access_token) {
        envContent = this.updateEnvVariable(
          envContent,
          "GOOGLE_OAUTH_ACCESS_TOKEN",
          tokens.access_token
        );
      }

      if (tokens.refresh_token) {
        envContent = this.updateEnvVariable(
          envContent,
          "GOOGLE_OAUTH_REFRESH_TOKEN",
          tokens.refresh_token
        );
      }

      if (tokens.expiry_date) {
        envContent = this.updateEnvVariable(
          envContent,
          "GOOGLE_OAUTH_EXPIRY_DATE",
          tokens.expiry_date.toString()
        );
      }

      if (tokens.scope) {
        envContent = this.updateEnvVariable(
          envContent,
          "GOOGLE_OAUTH_SCOPE",
          `"${tokens.scope}"`
        );
      }

      if (tokens.token_type) {
        envContent = this.updateEnvVariable(
          envContent,
          "GOOGLE_OAUTH_TOKEN_TYPE",
          tokens.token_type
        );
      }

      await fs.writeFile(envPath, envContent, "utf-8");
      logger.info("✅ Arquivo .env atualizado com sucesso");
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        console.warn(
          "⚠️ Não é possível atualizar .env em produção (variáveis gerenciadas pelo ambiente)"
        );
      } else {
        console.error("❌ Erro ao atualizar .env:", error);
      }
    }
  }

  /**
   * Atualiza ou adiciona uma variável no conteúdo do .env
   */
  private updateEnvVariable(
    content: string,
    key: string,
    value: string
  ): string {
    const regex = new RegExp(`^${key}=.*$`, "m");

    if (regex.test(content)) {
      // Atualizar valor existente
      return content.replace(regex, `${key}=${value}`);
    } else {
      // Adicionar nova variável
      return content + `\n${key}=${value}`;
    }
  }

  /**
   * Gera URL de autenticação OAuth2
   */
  getAuthUrl(): string {
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
    if (
      !redirectUri.startsWith("http://") &&
      !redirectUri.startsWith("https://")
    ) {
      throw new Error(
        `GOOGLE_REDIRECT_URI deve começar com http:// ou https://. Valor atual: ${redirectUri}`
      );
    }

    logger.info("🔗 Gerando URL de autenticação OAuth2");
    logger.debug(`🔗 Redirect URI: ${redirectUri}`);
    logger.debug(`🔗 Scopes: ${scopes.join(", ")}`);

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      include_granted_scopes: true,
      redirect_uri: redirectUri,
    });

    logger.debug(`🔗 URL gerada: ${authUrl.substring(0, 100)}...`);
    return authUrl;
  }

  async getTokensFromCode(code: string): Promise<OAuth2Credentials> {
    try {
      const { tokens } = await this.oauth2Client.getToken({
        code,
      });

      this.oauth2Client.setCredentials(tokens);
      await this.saveTokens(tokens);

      return tokens;
    } catch (error: any) {
      logger.error("❌ Erro ao obter tokens:", error.message);
      throw new Error("Falha ao autenticar com Google Drive");
    }
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      const updatedTokens = {
        ...this.oauth2Client.credentials,
        ...credentials,
      };

      this.oauth2Client.setCredentials(updatedTokens);
      await this.saveTokens(updatedTokens);
    } catch (error: any) {
      logger.error("❌ Erro ao renovar access token:", error.message);
      throw new Error(
        "Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize"
      );
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.oauth2Client.credentials) {
      throw new Error(
        "Não autenticado. Execute o fluxo OAuth2 via GET /oauth/authorize"
      );
    }

    const { access_token, refresh_token } = this.oauth2Client.credentials;

    if (!access_token && !refresh_token) {
      throw new Error(
        "Credenciais OAuth2 insuficientes. Execute o fluxo OAuth2 via GET /oauth/authorize"
      );
    }

    // Se não temos access_token mas temos refresh_token, o cliente vai atualizar automaticamente na próxima chamada
    logger.debug(
      "🔍 Credenciais OAuth2 verificadas - cliente atualizará automaticamente se necessário"
    );
  }

  async createFolder(
    folderName: string,
    parentFolderId?: string
  ): Promise<string> {
    try {
      await this.ensureValidToken();

      const parents = [];
      if (parentFolderId) {
        parents.push(parentFolderId);
      } else if (this.rootFolderId) {
        parents.push(this.rootFolderId);
      }

      const fileMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: parents.length > 0 ? parents : [],
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: "id, name",
      });

      return response.data.id;
    } catch (error: any) {
      logger.error("❌ Erro ao criar pasta no Google Drive:", error.message);
      throw new Error("Falha ao criar pasta de customização no Google Drive");
    }
  }

  async clearTokens(): Promise<void> {
    try {
      if (
        this.tokenPath &&
        (await fs.stat(this.tokenPath).catch(() => false))
      ) {
        await fs.unlink(this.tokenPath);
      }
      // Clear in-memory credentials
      if (this.oauth2Client) this.oauth2Client.credentials = {};
      logger.info("✅ Google Drive tokens cleared");
    } catch (err) {
      console.warn("Não foi possível remover token local:", String(err));
    }
  }

  async uploadFile(
    filePath: string,
    fileName: string,
    folderId: string,
    mimeType?: string
  ): Promise<UploadedFile> {
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
    } catch (error: any) {
      logger.error("❌ Erro ao fazer upload:", error.message);
      throw new Error("Falha ao fazer upload do arquivo para o Google Drive");
    }
  }

  /**
   * Faz upload de múltiplos arquivos
   */
  async uploadMultipleFiles(
    files: Array<{ path: string; name: string; mimeType?: string }>,
    folderId: string
  ): Promise<UploadedFile[]> {
    const uploadPromises = files.map((file) =>
      this.uploadFile(file.path, file.name, folderId, file.mimeType)
    );

    const results = await Promise.all(uploadPromises);

    return results;
  }

  async uploadBuffer(
    buffer: Buffer,
    fileName: string,
    folderId: string,
    mimeType?: string
  ): Promise<UploadedFile> {
    try {
      await this.ensureValidToken();

      const fileMetadata = {
        name: fileName,
        parents: [folderId],
      };

      const media = {
        mimeType: mimeType || "application/octet-stream",
        body: Readable.from(buffer),
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
      } catch (permErr) {
        // For service accounts or restricted drives, setting permissions might fail - log and continue
        console.warn(
          "Could not set file permissions to anyone: ",
          String(permErr)
        );
      }

      const directImageUrl = `https://drive.google.com/uc?id=${response.data.id}`;

      return {
        id: response.data.id,
        name: response.data.name,
        webViewLink: response.data.webViewLink || directImageUrl,
        webContentLink: response.data.webContentLink || directImageUrl,
      };
    } catch (error: any) {
      console.error("❌ Erro ao fazer upload via buffer:", String(error));
      console.error("🔎 folderId usado no upload:", folderId);
      // Detect specific errors and provide actionable messages
      const message = String(error?.message || error);
      if (
        message.includes("invalid_grant") ||
        message.includes("invalid_grant")
      ) {
        throw new Error(
          "Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize"
        );
      }
      if (
        message.includes("File not found") ||
        message.includes("file not found")
      ) {
        throw new Error(
          "Arquivo não encontrado ou Drive configurado incorretamente. Verifique o folderId/permissões e se o Drive configurado está acessível"
        );
      }
      if (
        message.includes("insufficientFilePermissions") ||
        message.includes("Forbidden") ||
        message.includes("permission")
      ) {
        // Permission denied - OAuth account may not have rights to the target folder
        throw new Error(
          "Permissão negada: a conta autenticada não tem acesso à pasta/folderId. Verifique as permissões e se a pasta pertence ao Drive correto."
        );
      }

      throw new Error("Falha ao fazer upload do arquivo para o Google Drive");
    }
  }

  /**
   * Obtém URL da pasta no Google Drive
   */
  getFolderUrl(folderId: string): string {
    return `https://drive.google.com/drive/folders/${folderId}`;
  }

  /**
   * Obtém URL de visualização de um arquivo
   */
  getFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  /**
   * Obtém URL de download direto de um arquivo
   */
  getDirectDownloadUrl(fileId: string): string {
    return `https://drive.google.com/uc?id=${fileId}&export=download`;
  }

  /**
   * Lista arquivos de uma pasta no Google Drive
   */
  async listFiles(folderId: string): Promise<UploadedFile[]> {
    try {
      await this.ensureValidToken();

      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id, name, webViewLink, webContentLink, mimeType)",
        orderBy: "name",
      });

      return response.data.files.map((file: any) => ({
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink,
        webContentLink: `https://drive.google.com/uc?id=${file.id}&export=download`,
      }));
    } catch (error: any) {
      console.error("❌ Erro ao listar arquivos:", error.message);
      return [];
    }
  }

  /**
   * Deleta um arquivo do Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.ensureValidToken();

      await this.drive.files.delete({
        fileId: fileId,
      });
    } catch (error: any) {
      console.error("❌ Erro ao deletar arquivo:", error.message);
      throw new Error("Falha ao deletar arquivo do Google Drive");
    }
  }

  async deleteFolder(folderId: string): Promise<void> {
    try {
      await this.ensureValidToken();

      const files = await this.listFiles(folderId);
      await Promise.all(files.map((file) => this.deleteFile(file.id)));

      await this.drive.files.delete({
        fileId: folderId,
      });
    } catch (error: any) {
      console.error("❌ Erro ao deletar pasta:", error.message);
      throw new Error("Falha ao deletar pasta do Google Drive");
    }
  }

  /**
   * Torna uma pasta pública
   */
  async makeFolderPublic(folderId: string): Promise<void> {
    try {
      await this.ensureValidToken();

      await this.drive.permissions.create({
        fileId: folderId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (error: any) {
      console.error("❌ Erro ao tornar pasta pública:", error.message);
    }
  }

  isConfigured(): boolean {
    // OAuth-only: consider configured if we have tokens
    return (
      !!this.oauth2Client.credentials?.access_token ||
      !!this.oauth2Client.credentials?.refresh_token
    );
  }

  getStatus(): {
    configured: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    tokenExpiry: Date | null;
    isServiceAccount: boolean;
    serviceAccountEmail?: string | null;
  } {
    const credentials = this.oauth2Client.credentials;

    return {
      configured: this.isConfigured(),
      hasAccessToken: !!credentials?.access_token,
      hasRefreshToken: !!credentials?.refresh_token,
      tokenExpiry: credentials?.expiry_date
        ? new Date(credentials.expiry_date)
        : null,
      isServiceAccount: false,
      serviceAccountEmail: null,
    };
  }

  getServiceAccountInfo(): { enabled: boolean; email?: string | null } {
    return { enabled: false, email: null };
  }

  async debugServiceAccount(): Promise<any> {
    const info: any = {
      isServiceAccount: false,
      serviceAccountEmail: null,
      hasOAuthClient: !!this.oauth2Client,
      hasDriveClient: !!this.drive,
      rootFolderId: this.rootFolderId,
      tokenPath: this.tokenPath,
      baseUrl: this.baseUrl,
    };

    if (
      this.oauth2Client &&
      typeof (this.oauth2Client as any).getAccessToken === "function"
    ) {
      try {
        const token = await (this.oauth2Client as any).getAccessToken();
        info.tokenObtained = !!token;
        info.tokenExpiry = token?.res?.data?.expiry_date;
      } catch (err) {
        info.tokenError = String(err);
      }
    }

    return info;
  }
}

export default new GoogleDriveService();
