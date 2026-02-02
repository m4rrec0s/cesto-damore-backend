import fs from "fs";
import path from "path";
import logger from "../utils/logger";

class TempFileService {
  private basePath: string;

  constructor() {
    const envPath = process.env.TEMP_UPLOADS_DIR;
    if (envPath) {
      this.basePath = path.resolve(envPath);
    } else {
      this.basePath = path.join(process.cwd(), "storage", "temp");
    }

    this.ensureDirectory();
  }

  /**
   * Garante que o diretório de temp existe com permissões corretas
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      try {
        fs.mkdirSync(this.basePath, { recursive: true, mode: 0o755 });
        logger.info(`✅ Criado diretório de temp: ${this.basePath}`);
      } catch (error: any) {
        logger.error(
          `❌ Erro ao criar diretório ${this.basePath}:`,
          error.message,
        );

        // Fallback: tentar com caminho relativo
        const fallbackPath = path.join(process.cwd(), "storage", "temp");
        if (fallbackPath !== this.basePath) {
          try {
            fs.mkdirSync(fallbackPath, { recursive: true, mode: 0o755 });
            this.basePath = fallbackPath;
            logger.info(
              `✅ Criado diretório de temp (fallback): ${fallbackPath}`,
            );
          } catch (fallbackError) {
            logger.error(`❌ Erro ao criar diretório fallback:`, fallbackError);
          }
        }
      }
    }
  }

  /**
   * Salva um arquivo temporário
   * Retorna: { filename, filepath, url }
   */
  async saveFile(
    buffer: Buffer,
    originalName: string,
  ): Promise<{
    filename: string;
    filepath: string;
    url: string;
  }> {
    try {
      // Garantir que o diretório existe
      this.ensureDirectory();

      // Sanitizar nome do arquivo
      const sanitized = originalName
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .toLowerCase();

      // Gerar nome único
      const timestamp = Date.now();
      const filename = `${timestamp}-${sanitized}`;
      const filepath = path.join(this.basePath, filename);

      // Salvar arquivo com tratamento de erro
      try {
        fs.writeFileSync(filepath, buffer);
      } catch (writeError: any) {
        logger.error(`⚠️ Erro ao escrever em ${filepath}:`, writeError.message);

        // Fallback: tentar com caminho relativo
        const fallbackPath = path.join(
          process.cwd(),
          "storage",
          "temp",
          filename,
        );
        fs.mkdirSync(path.dirname(fallbackPath), {
          recursive: true,
          mode: 0o755,
        });
        fs.writeFileSync(fallbackPath, buffer);

        logger.info(`✅ Arquivo salvo em fallback: ${fallbackPath}`);
      }

      // Construir URL para acesso
      const baseUrl = process.env.BASE_URL || "http://localhost:3333";
      const url = `${baseUrl}/uploads/temp/${filename}`;

      logger.info(
        `✅ Arquivo temporário salvo: ${filename} (${buffer.length} bytes)`,
      );
      logger.info(`   Caminho: ${filepath}`);
      logger.info(`   URL: ${url}`);
      logger.info(`   BASE_URL env: ${process.env.BASE_URL || "NOT SET"}`);

      return {
        filename,
        filepath,
        url,
      };
    } catch (error: any) {
      logger.error(`❌ Erro ao salvar arquivo temporário:`, error);
      throw error;
    }
  }

  listFiles(): {
    filename: string;
    size: number;
    createdAt: Date;
  }[] {
    try {
      if (!fs.existsSync(this.basePath)) {
        return [];
      }

      const files = fs.readdirSync(this.basePath);
      return files.map((filename) => {
        const filepath = path.join(this.basePath, filename);
        const stats = fs.statSync(filepath);
        return {
          filename,
          size: stats.size,
          createdAt: stats.birthtime,
        };
      });
    } catch (error: any) {
      logger.error(`❌ Erro ao listar arquivos temp:`, error);
      return [];
    }
  }

  /**
   * Deleta um arquivo temporário ou de customização específico
   */
  deleteFile(filename: string): boolean {
    if (!filename) return false;

    try {
      // 1. Tentar no diretório de temp
      let filepath = path.join(this.basePath, filename);

      // Validação de segurança básica para o temp
      const isInsideTemp = filepath.startsWith(this.basePath);

      if (isInsideTemp && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.debug(`🗑️ Arquivo temporário deletado: ${filename}`);
        return true;
      }

      // 2. Fallback: Tentar no diretório de customizations
      const customPath = process.env.UPLOAD_DIR
        ? path.resolve(process.env.UPLOAD_DIR, "customizations")
        : path.join(process.cwd(), "images", "customizations");

      const customFilepath = path.join(customPath, filename);

      if (fs.existsSync(customFilepath)) {
        fs.unlinkSync(customFilepath);
        logger.debug(`🗑️ Arquivo de customização deletado: ${filename}`);
        return true;
      }

      // 3. Fallback 2: Tentar no diretório de final uploads
      const finalEnvPath = process.env.FINAL_UPLOADS_DIR;
      const finalPath = finalEnvPath
        ? path.resolve(finalEnvPath)
        : path.join(process.cwd(), "storage", "final");

      // No storage/final os nomes costumam vir prefixados com ORDER_ID_
      // Mas o filename passado pode ser o original ou o prefixado.
      // Vamos tentar direto com o filename primeiro.
      const finalFilepath = path.join(finalPath, filename);
      if (fs.existsSync(finalFilepath)) {
        fs.unlinkSync(finalFilepath);
        logger.debug(`🗑️ Arquivo final deletado: ${filename}`);
        return true;
      }

      // 4. Se chegou aqui, não encontrou em nenhum lugar
      logger.warn(
        `⚠️ Arquivo não encontrado em temp (${this.basePath}), custom (${customPath}) nem final (${finalPath}): ${filename}`,
      );
      return false;
    } catch (error: any) {
      logger.error(`❌ Erro ao deletar arquivo:`, error);
      return false;
    }
  }

  /**
   * Deleta múltiplos arquivos
   */
  deleteFiles(filenames: string[]): { deleted: number; failed: number } {
    let deleted = 0;
    let failed = 0;

    filenames.forEach((filename) => {
      if (this.deleteFile(filename)) {
        deleted++;
      } else {
        failed++;
      }
    });

    logger.info(
      `🗑️ Limpeza de temp files: ${deleted} deletados, ${failed} falharam`,
    );
    return { deleted, failed };
  }

  /**
   * Limpeza automática: deleta arquivos com mais de X horas
   * Útil para rodar como cron job
   */
  cleanupOldFiles(hoursThreshold: number = 48): {
    deleted: number;
    failed: number;
  } {
    try {
      if (!fs.existsSync(this.basePath)) {
        return { deleted: 0, failed: 0 };
      }

      const files = fs.readdirSync(this.basePath);
      const now = Date.now();
      const thresholdMs = hoursThreshold * 60 * 60 * 1000;

      let deleted = 0;
      let failed = 0;

      files.forEach((filename) => {
        const filepath = path.join(this.basePath, filename);
        try {
          const stats = fs.statSync(filepath);
          const ageMs = now - stats.mtimeMs;

          if (ageMs > thresholdMs) {
            fs.unlinkSync(filepath);
            deleted++;
            logger.debug(
              `🗑️ Arquivo antigo deletado: ${filename} (${Math.round(
                ageMs / 1000 / 60,
              )} minutos)`,
            );
          }
        } catch (error: any) {
          logger.error(`❌ Erro ao processar arquivo ${filename}:`, error);
          failed++;
        }
      });

      if (deleted > 0 || failed > 0) {
        logger.info(
          `🧹 Limpeza de arquivos antigos: ${deleted} deletados, ${failed} falharam`,
        );
      }

      return { deleted, failed };
    } catch (error: any) {
      logger.error(`❌ Erro na limpeza de arquivos antigos:`, error);
      return { deleted: 0, failed: 0 };
    }
  }

  /**
   * Obtém caminho completo de um arquivo
   */
  getFilePath(filename: string): string {
    return path.join(this.basePath, filename);
  }

  /**
   * Verifica se um arquivo existe
   */
  fileExists(filename: string): boolean {
    const filepath = path.join(this.basePath, filename);
    return fs.existsSync(filepath);
  }

  /**
   * Obtém informações de um arquivo
   */
  getFileInfo(filename: string): { size: number; createdAt: Date } | null {
    try {
      const filepath = path.join(this.basePath, filename);
      if (!fs.existsSync(filepath)) {
        return null;
      }

      const stats = fs.statSync(filepath);
      return {
        size: stats.size,
        createdAt: stats.birthtime,
      };
    } catch (error: any) {
      logger.error(`❌ Erro ao obter info do arquivo:`, error);
      return null;
    }
  }
}

export default new TempFileService();
