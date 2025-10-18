import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";

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

  constructor() {
    this.rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
    this.customizationsDir = path.join(
      process.cwd(),
      "images",
      "customizations"
    );
    this.tokenPath = path.join(process.cwd(), "google-drive-token.json");
    this.baseUrl = process.env.BASE_URL || "http://localhost:8080";

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:8080/api/oauth/callback";

    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    this.drive = google.drive({ version: "v3", auth: this.oauth2Client });
    this.loadSavedTokens();
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
      console.log("✅ Tokens OAuth2 carregados das variáveis de ambiente");
      return;
    }

    try {
      const tokenFile = await fs.readFile(this.tokenPath, "utf-8");
      const tokens = JSON.parse(tokenFile);
      this.oauth2Client.setCredentials(tokens);
      console.log("✅ Tokens OAuth2 carregados com sucesso");
    } catch (error) {
      console.warn(
        "⚠️ Arquivo de tokens não encontrado ou inválido. Execute a autenticação OAuth2."
      );
    }
  }

  /**
   * Salva tokens OAuth2 no arquivo e atualiza .env
   */
  private async saveTokens(tokens: OAuth2Credentials): Promise<void> {
    try {
      // Salvar no google-drive-token.json
      await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
      console.log("✅ Tokens OAuth2 salvos em:", this.tokenPath);

      // Atualizar .env
      await this.updateEnvFile(tokens);
      console.log("✅ Arquivo .env atualizado com novos tokens");
    } catch (error) {
      console.error("❌ Erro ao salvar tokens:", error);
    }
  }

  /**
   * Atualiza variáveis de ambiente no arquivo .env
   */
  private async updateEnvFile(tokens: OAuth2Credentials): Promise<void> {
    try {
      const envPath = path.join(process.cwd(), ".env");
      let envContent = await fs.readFile(envPath, "utf-8");

      // Atualizar ou adicionar cada token
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
    } catch (error) {
      console.error("❌ Erro ao atualizar .env:", error);
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

      console.log("✅ Autenticação OAuth2 concluída com sucesso!");
      console.log(
        "📝 Refresh token:",
        tokens.refresh_token ? "✅ Obtido" : "❌ Não obtido"
      );

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
      console.log("🔄 Renovando access token...");
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      // Mesclar com credenciais existentes (preservar refresh_token)
      const updatedTokens = {
        ...this.oauth2Client.credentials,
        ...credentials,
      };

      this.oauth2Client.setCredentials(updatedTokens);
      await this.saveTokens(updatedTokens);

      console.log("✅ Access token renovado automaticamente");
      console.log(
        `   📅 Nova expiração: ${new Date(
          updatedTokens.expiry_date || 0
        ).toLocaleString()}`
      );
    } catch (error: any) {
      console.error("❌ Erro ao renovar access token:", error.message);
      throw new Error(
        "Falha ao renovar autenticação. Execute o fluxo OAuth2 novamente via /oauth/authorize"
      );
    }
  }

  /**
   * Verifica se precisa renovar token antes de cada operação
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.oauth2Client.credentials) {
      throw new Error(
        "Não autenticado. Execute o fluxo OAuth2 via GET /oauth/authorize"
      );
    }

    const { expiry_date, refresh_token } = this.oauth2Client.credentials;

    // Se não há data de expiração, tentar usar o token atual
    if (!expiry_date) {
      if (!refresh_token) {
        throw new Error(
          "Token inválido. Execute o fluxo OAuth2 via GET /oauth/authorize"
        );
      }
      // Forçar renovação se não sabemos quando expira
      await this.refreshAccessToken();
      return;
    }

    // Renovar se expirou ou expira em menos de 5 minutos
    const expiresIn = expiry_date - Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresIn < fiveMinutes) {
      if (!refresh_token) {
        throw new Error(
          "Refresh token ausente. Execute o fluxo OAuth2 via GET /oauth/authorize"
        );
      }
      console.log(
        `🔄 Token expira em ${Math.round(
          expiresIn / 1000 / 60
        )} minuto(s), renovando...`
      );
      await this.refreshAccessToken();
    }
  }

  /**
   * Cria uma pasta no Google Drive
   */
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

      console.log(
        `📁 Pasta criada no Google Drive: ${response.data.name} (${response.data.id})`
      );
      return response.data.id;
    } catch (error: any) {
      console.error("❌ Erro ao criar pasta no Google Drive:", error.message);
      throw new Error("Falha ao criar pasta de customização no Google Drive");
    }
  }

  /**
   * Faz upload de um arquivo para o Google Drive
   */
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

      console.log(
        `📤 Arquivo enviado para Google Drive: ${response.data.name}`
      );

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
    console.log(
      `✅ ${results.length} arquivo(s) enviado(s) para o Google Drive`
    );

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

      await this.drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      console.log(`📤 Arquivo (buffer) enviado para Google Drive: ${fileName}`);

      // URL de visualização direta (formato que funciona com <img>)
      const directImageUrl = `https://drive.google.com/uc?id=${response.data.id}`;

      return {
        id: response.data.id,
        name: response.data.name,
        webViewLink: directImageUrl, // Usar formato direto no webViewLink
        webContentLink: directImageUrl, // Manter consistência
      };
    } catch (error: any) {
      console.error("❌ Erro ao fazer upload via buffer:", error.message);
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

      console.log(`🗑️ Arquivo deletado do Google Drive: ${fileId}`);
    } catch (error: any) {
      console.error("❌ Erro ao deletar arquivo:", error.message);
      throw new Error("Falha ao deletar arquivo do Google Drive");
    }
  }

  /**
   * Deleta uma pasta e todos os seus arquivos
   */
  async deleteFolder(folderId: string): Promise<void> {
    try {
      await this.ensureValidToken();

      const files = await this.listFiles(folderId);
      await Promise.all(files.map((file) => this.deleteFile(file.id)));

      await this.drive.files.delete({
        fileId: folderId,
      });

      console.log(`🗑️ Pasta deletada do Google Drive: ${folderId}`);
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

      console.log(`🔓 Pasta ${folderId} tornada pública`);
    } catch (error: any) {
      console.error("❌ Erro ao tornar pasta pública:", error.message);
    }
  }

  /**
   * Verifica se o serviço está configurado e autenticado
   */
  isConfigured(): boolean {
    return (
      !!this.oauth2Client.credentials?.access_token ||
      !!this.oauth2Client.credentials?.refresh_token
    );
  }

  /**
   * Obtém informações sobre a configuração atual
   */
  getStatus(): {
    configured: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    tokenExpiry: Date | null;
  } {
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

export default new GoogleDriveService();
