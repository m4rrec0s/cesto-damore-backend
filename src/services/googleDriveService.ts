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

/**
 * Local Storage Service (Alternativa ao Google Drive)
 *
 * Salva arquivos localmente e gera URLs públicas via BASE_URL (ngrok)
 *
 * Estrutura:
 * images/customizations/
 *   ├── pedido_123_1234567890/
 *   │   ├── foto1.jpg
 *   │   ├── foto2.png
 *   │   └── foto3.webp
 */
class GoogleDriveService {
  private customizationsDir: string;
  private baseUrl: string;

  constructor() {
    this.customizationsDir = path.join(
      process.cwd(),
      "images",
      "customizations"
    );
    this.baseUrl = process.env.BASE_URL || "http://localhost:3333";
    this.ensureCustomizationsDir();
  }

  private async ensureCustomizationsDir() {
    try {
      await fs.access(this.customizationsDir);
      console.log("✅ Diretório de customizações já existe");
    } catch {
      await fs.mkdir(this.customizationsDir, { recursive: true });
      console.log(
        "📁 Diretório de customizações criado:",
        this.customizationsDir
      );
    }
  }

  async isConfigured(): Promise<boolean> {
    // Sempre configurado (armazenamento local)
    return true;
  }

  async createFolder(
    folderName: string,
    parentFolderId?: string
  ): Promise<CreateFolderResult> {
    try {
      // Criar pasta local
      const folderPath = path.join(this.customizationsDir, folderName);
      await fs.mkdir(folderPath, { recursive: true });

      // Gerar URL pública
      const publicUrl = `${this.baseUrl}/images/customizations/${folderName}`;

      console.log(`📁 Pasta criada localmente: ${folderName}`);
      console.log(`🔗 URL pública: ${publicUrl}`);

      return {
        id: folderName, // ID é o próprio nome da pasta
        url: publicUrl,
      };
    } catch (error: any) {
      console.error("❌ Erro ao criar pasta:", error.message);
      throw new Error(`Erro ao criar pasta: ${error.message}`);
    }
  }

  async uploadFile(options: UploadFileOptions): Promise<UploadFileResult> {
    try {
      const { filePath, fileName, folderId } = options;

      // Caminho de destino
      const destFolder = path.join(this.customizationsDir, folderId);
      const destPath = path.join(destFolder, fileName);

      // Garantir que a pasta existe
      await fs.mkdir(destFolder, { recursive: true });

      // Copiar arquivo
      await fs.copyFile(filePath, destPath);

      // Gerar URL pública
      const publicUrl = `${this.baseUrl}/images/customizations/${folderId}/${fileName}`;

      console.log(`✅ Arquivo salvo: ${fileName}`);
      console.log(`🔗 URL: ${publicUrl}`);

      return {
        id: fileName,
        url: publicUrl,
      };
    } catch (error: any) {
      console.error("❌ Erro ao fazer upload:", error.message);
      throw new Error(`Erro ao fazer upload: ${error.message}`);
    }
  }

  async uploadMultipleFiles(
    files: Array<{ filePath: string; fileName: string }>,
    folderId: string
  ): Promise<UploadFileResult[]> {
    try {
      const results: UploadFileResult[] = [];

      for (const file of files) {
        const result = await this.uploadFile({
          filePath: file.filePath,
          fileName: file.fileName,
          folderId,
        });
        results.push(result);
      }

      console.log(`✅ ${results.length} arquivos enviados com sucesso`);

      return results;
    } catch (error: any) {
      console.error("❌ Erro ao fazer upload múltiplo:", error.message);
      throw new Error(`Erro ao fazer upload múltiplo: ${error.message}`);
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      // fileId contém o caminho relativo: folderId/fileName
      const filePath = path.join(this.customizationsDir, fileId);

      await fs.unlink(filePath);
      console.log(`🗑️ Arquivo deletado: ${fileId}`);
    } catch (error: any) {
      console.error("❌ Erro ao deletar arquivo:", error.message);
      throw new Error(`Erro ao deletar arquivo: ${error.message}`);
    }
  }

  async listFiles(
    folderId: string
  ): Promise<Array<{ id: string; name: string; url: string }>> {
    try {
      const folderPath = path.join(this.customizationsDir, folderId);

      const files = await fs.readdir(folderPath);

      return files.map((fileName) => ({
        id: `${folderId}/${fileName}`,
        name: fileName,
        url: `${this.baseUrl}/images/customizations/${folderId}/${fileName}`,
      }));
    } catch (error: any) {
      console.error("❌ Erro ao listar arquivos:", error.message);
      return [];
    }
  }

  /**
   * Obter URL pública de uma pasta
   */
  getFolderUrl(folderId: string): string {
    return `${this.baseUrl}/images/customizations/${folderId}`;
  }

  /**
   * Obter URL pública de um arquivo
   */
  getFileUrl(folderId: string, fileName: string): string {
    return `${this.baseUrl}/images/customizations/${folderId}/${fileName}`;
  }
}

export default new GoogleDriveService();
