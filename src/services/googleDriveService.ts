import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import crypto from "crypto";

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
  private isServiceAccount: boolean = false;
  private serviceAccountEmail?: string | null = null;
  private saInitPromise?: Promise<void>;

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

    // Service Account first: check for service account key JSON or a path
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

    // Allow multiple ways to configure a service account:
    // 1) Full JSON content via GOOGLE_SERVICE_ACCOUNT_KEY
    // 2) Path to JSON via GOOGLE_SERVICE_ACCOUNT_KEY_PATH
    // 3) Individual env vars (GOOGLE_PRIVATE_KEY, GOOGLE_CLIENT_EMAIL, GOOGLE_PROJECT_ID, etc.)
    const attemptServiceAccount = Boolean(
      serviceAccountKey ||
        serviceAccountKeyPath ||
        process.env.GOOGLE_PRIVATE_KEY
    );
    if (attemptServiceAccount) {
      let keyJson;
      try {
        if (serviceAccountKey) keyJson = JSON.parse(serviceAccountKey);
        else
          keyJson = JSON.parse(
            require("fs").readFileSync(serviceAccountKeyPath, "utf-8")
          );
      } catch (err) {
        console.error("❌ Falha ao carregar chave da Service Account:", err);
        keyJson = null;
      }

      // If not provided, build keyJson from env vars
      if (
        !keyJson &&
        process.env.GOOGLE_PRIVATE_KEY &&
        process.env.GOOGLE_CLIENT_EMAIL
      ) {
        try {
          const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
          // Some environments store private key newlines as \n - normalize
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
            auth_provider_x509_cert_url:
              process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
            client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
          } as any;
        } catch (err) {
          console.warn(
            "⚠️ Falha ao montar Service Account key JSON a partir das env vars:",
            String(err)
          );
        }
      }

      if (keyJson) {
        // Validate private key is a correct PEM
        if (keyJson.private_key && typeof keyJson.private_key === "string") {
          try {
            // This will throw if the key can't be parsed
            crypto.createPrivateKey({
              key: keyJson.private_key,
              format: "pem",
            });
          } catch (err) {
            console.error("❌ Private key PEM invalid:", String(err));
            keyJson = null; // prevent using an invalid key
          }
        }
        // Initialize service account auth async and keep promise
        this.isServiceAccount = false; // temporary until init succeeds
        this.saInitPromise = this.initServiceAccount(keyJson).catch((err) => {
          // Ensure the promise resolves successfully even on error
          return;
        });
      }
    }

    // Fallback to OAuth2 flow only if we didn't attempt service account init
    if (!attemptServiceAccount) {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
      );

      this.drive = google.drive({ version: "v3", auth: this.oauth2Client });
      this.isServiceAccount = false;
      this.loadSavedTokens();
    }

    // If we attempted service account init and it failed OR we attempted and still want OAuth fallback,
    // we will chain the fallback after init completes.
    if (attemptServiceAccount && this.saInitPromise) {
      this.saInitPromise.then(() => {
        if (!this.isServiceAccount) {
          // Setup OAuth fallback
          this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            redirectUri
          );
          this.drive = google.drive({ version: "v3", auth: this.oauth2Client });
          this.loadSavedTokens();
        }
      });
    }
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

  private async initServiceAccount(keyJson: any) {
    try {
      // Normalize private key if present
      if (keyJson.private_key && typeof keyJson.private_key === "string") {
        let pk = keyJson.private_key;
        // Remove surrounding quotes if they exist
        if (pk.startsWith('"') && pk.endsWith('"')) {
          pk = pk.substring(1, pk.length - 1);
        }
        pk = pk.replace(/\\n/g, "\n").trim();
        // Ensure it starts and ends with proper PEM headers
        if (!pk.includes("-----BEGIN PRIVATE KEY-----")) {
          pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;
        }
        keyJson.private_key = pk;
      }

      const auth = new google.auth.GoogleAuth({
        credentials: keyJson,
        scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/drive",
        ],
      });
      const client = await auth.getClient();
      this.oauth2Client = client;
      // GoogleAuth.getClient returns an AuthClient; cast to any to satisfy TS overload
      this.drive = google.drive({ version: "v3", auth: client as any });
      this.isServiceAccount = true;
      this.serviceAccountEmail = keyJson.client_email || null;
      console.log(
        "✅ Google Drive: Service Account mode active for",
        this.serviceAccountEmail
      );
      if (keyJson.private_key) {
        console.log(
          `🔐 Service Account private key length: ${
            String(keyJson.private_key).length
          }`
        );
        console.log(`🔐 Service Account email: ${this.serviceAccountEmail}`);
      }
      // Validate that the credentials can make a simple, harmless Drive request
      try {
        // Try to obtain an access token to verify JWT signature
        if (client && typeof (client as any).getAccessToken === "function") {
          await (client as any).getAccessToken();
        }
        await this.drive.files.list({ pageSize: 1, fields: "files(id)" });
      } catch (testErr: any) {
        // If JWT signature or permission issues occur, log and disable SA (fallback)
        console.error("❌ Service Account validation failed:", String(testErr));
        this.isServiceAccount = false;
        this.serviceAccountEmail = null;
        // For debugging, rethrow up the chain (but we will catch below)
        throw testErr;
      }
    } catch (err) {
      this.isServiceAccount = false;
      this.serviceAccountEmail = null;
      console.error("❌ Falha ao inicializar Service Account", String(err));
    }
  }

  private async saveTokens(tokens: OAuth2Credentials): Promise<void> {
    try {
      await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));

      // try to persist tokens in .env; allowed in dev but may be skipped in production
      try {
        await this.updateEnvFile(tokens);
      } catch (err) {
        // Ignore failure to persist in production
      }
    } catch (error) {
      console.error("❌ Erro ao salvar tokens:", error);
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
      console.log("✅ Arquivo .env atualizado com sucesso");
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
  async getTokensFromCode(code: string): Promise<OAuth2Credentials> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      await this.saveTokens(tokens);

      return tokens;
    } catch (error: any) {
      console.error("❌ Erro ao obter tokens:", error.message);
      throw new Error("Falha ao autenticar com Google Drive");
    }
  }

  /**
   * Renova o token de acesso se estiver expirado
   */
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
      console.error("❌ Erro ao renovar access token:", error.message);
      throw new Error(
        "Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize"
      );
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (this.isServiceAccount) {
      // Service account uses JWT - always valid unless misconfigured
      return;
    }

    if (!this.oauth2Client.credentials) {
      throw new Error(
        "Não autenticado. Execute o fluxo OAuth2 via GET /oauth/authorize"
      );
    }

    const { expiry_date, refresh_token } = this.oauth2Client.credentials;

    if (!expiry_date) {
      if (!refresh_token) {
        throw new Error(
          "Token inválido. Execute o fluxo OAuth2 via GET /oauth/authorize"
        );
      }
      await this.refreshAccessToken();
      return;
    }

    const expiresIn = expiry_date - Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresIn < fiveMinutes) {
      if (!refresh_token) {
        throw new Error(
          "Refresh token ausente. Execute o fluxo OAuth2 via GET /oauth/authorize"
        );
      }
      await this.refreshAccessToken();
    }
  }

  async createFolder(folderName: string): Promise<string> {
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
    } catch (error: any) {
      console.error("❌ Erro ao criar pasta no Google Drive:", error.message);
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
      console.log("✅ Google Drive tokens cleared");
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
      console.error("❌ Erro ao fazer upload:", error.message);
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
        this.isServiceAccount &&
        (message.includes("insufficientFilePermissions") ||
          message.includes("Forbidden") ||
          message.includes("permission"))
      ) {
        const email = this.serviceAccountEmail || "<service-account-email>";
        throw new Error(
          `Permissão negada: a Service Account ${email} não tem acesso à pasta/folderId. Compartilhe a pasta no Drive com esse email ou use OAuth para autorizar um usuário de conta do Drive.`
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
    if (this.isServiceAccount) return true;
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
      isServiceAccount: this.isServiceAccount,
      serviceAccountEmail: this.serviceAccountEmail,
    };
  }

  getServiceAccountInfo(): { enabled: boolean; email?: string | null } {
    return { enabled: this.isServiceAccount, email: this.serviceAccountEmail };
  }
}

export default new GoogleDriveService();
