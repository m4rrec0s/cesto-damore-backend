import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../database/prisma";
import logger from "../utils/logger";

// Normalização de caminhos para evitar erro EACCES em Docker
const normalizeStoragePath = (envVar?: string, defaultPath: string = "") => {
  if (!envVar) return path.join(process.cwd(), defaultPath);
  // Se o caminho for absoluto e começar com /app/ (legado), converter para relativo ao WORKDIR
  if (path.isAbsolute(envVar) && envVar.startsWith("/app/")) {
    return path.join(process.cwd(), envVar.replace("/app/", ""));
  }
  return path.resolve(envVar);
};

const TEMP_UPLOADS_DIR = normalizeStoragePath(
  process.env.TEMP_UPLOADS_DIR,
  "storage/temp",
);
const FINAL_UPLOADS_DIR = normalizeStoragePath(
  process.env.FINAL_UPLOADS_DIR,
  "storage/final",
);

const DEFAULT_TTL_HOURS = parseInt(process.env.TEMP_UPLOAD_TTL_HOURS || "24");

// Garantir que os diretórios existem
if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
  fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(FINAL_UPLOADS_DIR)) {
  fs.mkdirSync(FINAL_UPLOADS_DIR, { recursive: true });
}

interface UploadOptions {
  userId?: string;
  clientIp?: string;
  ttlHours?: number;
}

interface CleanupResult {
  deletedCount: number;
  deletedSize: number;
  errors: string[];
}

class TempUploadService {
  /**
   * Salvar arquivo temporário com TTL
   */
  async saveTempUpload(
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string,
    options: UploadOptions = {},
  ) {
    const { userId, clientIp, ttlHours = DEFAULT_TTL_HOURS } = options;

    try {
      // Gerar nome único
      const ext = path.extname(originalFilename);
      const hash = crypto.randomBytes(16).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filePath = path.join(TEMP_UPLOADS_DIR, filename);

      // Salvar arquivo
      fs.writeFileSync(filePath, fileBuffer);

      // Calcular expiração
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

      // Registrar no DB
      const upload = await prisma.tempUpload.create({
        data: {
          filename,
          originalName: originalFilename,
          filePath,
          fileSize: fileBuffer.length,
          mimeType,
          expiresAt,
          userId,
          clientIp,
        },
      });

      logger.info(`✅ Arquivo temporário salvo: ${filename}`);

      // Retornar URL relativa (cliente pode usar como "/uploads/temp/{filename}")
      const publicUrl = `/uploads/temp/${filename}`;

      return {
        id: upload.id,
        filename,
        url: publicUrl,
        expiresAt: upload.expiresAt,
        fileSize: upload.fileSize,
      };
    } catch (error) {
      logger.error("❌ Erro ao salvar arquivo temporário:", error);
      throw error;
    }
  }

  /**
   * Converter arquivo temporário para permanente (após compra)
   */
  async makePermanent(uploadId: string, orderId: string) {
    try {
      const upload = await prisma.tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        throw new Error("Upload não encontrado");
      }

      // Copiar para pasta de permanentes
      const destPath = path.join(
        FINAL_UPLOADS_DIR,
        `${orderId}_${upload.filename}`,
      );
      fs.copyFileSync(upload.filePath, destPath);

      // Atualizar BD: remover TTL e associar com ordem
      await prisma.tempUpload.update({
        where: { id: uploadId },
        data: {
          expiresAt: new Date("2099-12-31"), // Marcar como permanente
          orderId,
        },
      });

      logger.info(
        `✅ Arquivo ${upload.filename} convertido para permanente (Order: ${orderId})`,
      );

      return {
        id: uploadId,
        permanentUrl: `ws:orders/${orderId}/${upload.filename}`,
      };
    } catch (error) {
      logger.error("❌ Erro ao converter arquivo para permanente:", error);
      throw error;
    }
  }

  /**
   * Obter arquivo temporário (verificar se ainda é válido)
   */
  async getTempUpload(uploadId: string) {
    try {
      const upload = await prisma.tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        throw new Error("Upload não encontrado");
      }

      // Verificar expiração
      if (new Date() > upload.expiresAt && !upload.deletedAt) {
        logger.warn(`⚠️ Upload ${uploadId} expirado`);
        return null;
      }

      return upload;
    } catch (error) {
      logger.error("❌ Erro ao obter upload:", error);
      throw error;
    }
  }

  /**
   * Deletar arquivo temporário manualmente
   */
  async deleteTempUpload(uploadId: string) {
    try {
      const upload = await prisma.tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        throw new Error("Upload não encontrado");
      }

      // Deletar arquivo
      if (fs.existsSync(upload.filePath)) {
        fs.unlinkSync(upload.filePath);
      }

      // Marcar como deletado no BD
      await prisma.tempUpload.update({
        where: { id: uploadId },
        data: { deletedAt: new Date() },
      });

      logger.info(`✅ Upload ${uploadId} deletado`);
    } catch (error) {
      logger.error("❌ Erro ao deletar upload:", error);
      throw error;
    }
  }

  /**
   * Limpeza automática de arquivos expirados (CRON JOB)
   */
  async cleanupExpiredUploads(): Promise<CleanupResult> {
    const result: CleanupResult = {
      deletedCount: 0,
      deletedSize: 0,
      errors: [],
    };

    try {
      logger.info("🧹 Iniciando limpeza de uploads expirados...");

      const now = new Date();

      // Buscar uploads expirados ainda não deletados
      const expiredUploads = await prisma.tempUpload.findMany({
        where: {
          expiresAt: { lt: now },
          deletedAt: null,
        },
      });

      logger.info(
        `📋 Encontrados ${expiredUploads.length} uploads para deletar`,
      );

      for (const upload of expiredUploads) {
        try {
          // Deletar arquivo do disco
          if (fs.existsSync(upload.filePath)) {
            const stats = fs.statSync(upload.filePath);
            fs.unlinkSync(upload.filePath);
            result.deletedSize += stats.size;
          }

          // Marcar como deletado no BD
          await prisma.tempUpload.update({
            where: { id: upload.id },
            data: { deletedAt: now },
          });

          result.deletedCount++;
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          result.errors.push(`Erro ao deletar ${upload.filename}: ${err}`);
          logger.error(`❌ Erro ao deletar ${upload.filename}:`, error);
        }
      }

      // Cleanup: deletar registros muito antigos (após 30 dias de expiração)
      // ✅ NOVO: Aumentado para 30 dias para manter customizações finais por mais tempo
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await prisma.tempUpload.deleteMany({
        where: {
          deletedAt: { lt: thirtyDaysAgo },
        },
      });

      logger.info(
        `✅ Limpeza concluída: ${result.deletedCount} arquivos deletados, ${(result.deletedSize / 1024 / 1024).toFixed(2)}MB liberados`,
      );

      return result;
    } catch (error) {
      logger.error("❌ Erro durante limpeza de uploads:", error);
      throw error;
    }
  }

  /**
   * Obter estatísticas de uso
   */
  async getStorageStats() {
    try {
      const tempCount = await prisma.tempUpload.count({
        where: { deletedAt: null },
      });

      const permanentCount = await prisma.tempUpload.count({
        where: {
          deletedAt: null,
          expiresAt: { gt: new Date("2099-01-01") },
        },
      });

      // Calcular tamanho ocupado
      const tempSize = fs
        .readdirSync(TEMP_UPLOADS_DIR)
        .reduce((total, file) => {
          const filePath = path.join(TEMP_UPLOADS_DIR, file);
          try {
            return total + fs.statSync(filePath).size;
          } catch {
            return total;
          }
        }, 0);

      const permanentSize = fs
        .readdirSync(FINAL_UPLOADS_DIR)
        .reduce((total, file) => {
          const filePath = path.join(FINAL_UPLOADS_DIR, file);
          try {
            return total + fs.statSync(filePath).size;
          } catch {
            return total;
          }
        }, 0);

      return {
        temp: {
          count: tempCount,
          size: tempSize,
          sizeGB: (tempSize / 1024 / 1024 / 1024).toFixed(2),
        },
        permanent: {
          count: permanentCount,
          size: permanentSize,
          sizeGB: (permanentSize / 1024 / 1024 / 1024).toFixed(2),
        },
        total: {
          size: tempSize + permanentSize,
          sizeGB: ((tempSize + permanentSize) / 1024 / 1024 / 1024).toFixed(2),
        },
      };
    } catch (error) {
      logger.error("❌ Erro ao obter estatísticas:", error);
      throw error;
    }
  }
}

export default new TempUploadService();
