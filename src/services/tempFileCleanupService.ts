import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import cron from "node-cron";

const prisma = new PrismaClient();

class TempFileCleanupService {
  /**
   * Limpar arquivos temporários expirados
   */
  async cleanupExpiredFiles() {
    console.log(
      "[TempFileCleanup] Iniciando limpeza de arquivos temporários..."
    );

    try {
      const now = new Date();

      // Buscar arquivos expirados
      const expiredFiles = await prisma.temporaryCustomizationFile.findMany({
        where: {
          expires_at: {
            lt: now,
          },
        },
      });

      console.log(
        `[TempFileCleanup] Encontrados ${expiredFiles.length} arquivos expirados`
      );

      let deletedCount = 0;
      let errorCount = 0;

      for (const file of expiredFiles) {
        try {
          // Deletar arquivo físico
          const filePath = path.join(process.cwd(), file.file_path);

          try {
            await fs.unlink(filePath);
            console.log(
              `[TempFileCleanup] Arquivo deletado: ${file.file_path}`
            );
          } catch (fsError) {
            // Arquivo pode não existir mais, continuar
            console.warn(
              `[TempFileCleanup] Arquivo não encontrado: ${file.file_path}`
            );
          }

          // Deletar registro do banco
          await prisma.temporaryCustomizationFile.delete({
            where: { id: file.id },
          });

          deletedCount++;
        } catch (error) {
          console.error(
            `[TempFileCleanup] Erro ao deletar arquivo ${file.id}:`,
            error
          );
          errorCount++;
        }
      }

      console.log(
        `[TempFileCleanup] Limpeza concluída. Deletados: ${deletedCount}, Erros: ${errorCount}`
      );

      // Limpar diretórios vazios
      await this.cleanupEmptyDirectories();

      return {
        deletedCount,
        errorCount,
      };
    } catch (error) {
      console.error("[TempFileCleanup] Erro na limpeza:", error);
      throw error;
    }
  }

  /**
   * Limpar diretórios vazios em storage/temp
   */
  private async cleanupEmptyDirectories() {
    try {
      const tempDir = path.join(process.cwd(), "storage", "temp");

      // Verificar se diretório existe
      try {
        await fs.access(tempDir);
      } catch {
        return; // Diretório não existe
      }

      const sessions = await fs.readdir(tempDir);

      for (const session of sessions) {
        const sessionPath = path.join(tempDir, session);

        // Verificar se é diretório
        const stats = await fs.stat(sessionPath);
        if (!stats.isDirectory()) continue;

        // Verificar se está vazio
        const files = await fs.readdir(sessionPath);
        if (files.length === 0) {
          await fs.rmdir(sessionPath);
          console.log(
            `[TempFileCleanup] Diretório vazio removido: ${sessionPath}`
          );
        }
      }
    } catch (error) {
      console.warn(
        "[TempFileCleanup] Erro ao limpar diretórios vazios:",
        error
      );
    }
  }

  /**
   * Iniciar job de limpeza automática (cron)
   * Roda a cada 1 hora
   */
  startCleanupJob() {
    console.log(
      "[TempFileCleanup] Job de limpeza automática iniciado (a cada 1 hora)"
    );

    // Executar a cada 1 hora
    cron.schedule("0 * * * *", async () => {
      console.log("[TempFileCleanup] Executando job de limpeza automática...");
      try {
        await this.cleanupExpiredFiles();
      } catch (error) {
        console.error("[TempFileCleanup] Erro no job de limpeza:", error);
      }
    });

    // Executar imediatamente na inicialização
    this.cleanupExpiredFiles().catch((error) => {
      console.error("[TempFileCleanup] Erro na limpeza inicial:", error);
    });
  }
}

export default new TempFileCleanupService();
