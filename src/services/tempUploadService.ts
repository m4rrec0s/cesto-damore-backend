import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../database/prisma";
import logger from "../utils/logger";

const normalizeStoragePath = (envVar?: string, defaultPath: string = "") => {
  if (!envVar) return path.join(process.cwd(), defaultPath);
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

const ensureDirectory = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
      logger.info(`📁 Diretório criado: ${dirPath}`);
    } catch (error) {
      logger.error(`❌ Erro ao criar diretório ${dirPath}:`, error);

      const fallbackPath = dirPath.replace(/^\/app\//, "./");
      if (fallbackPath !== dirPath) {
        try {
          fs.mkdirSync(fallbackPath, { recursive: true, mode: 0o755 });
          logger.info(`📁 Diretório criado (fallback): ${fallbackPath}`);
        } catch (fallbackError) {
          logger.error(
            `❌ Erro ao criar diretório fallback ${fallbackPath}:`,
            fallbackError,
          );
        }
      }
    }
  }
};

ensureDirectory(TEMP_UPLOADS_DIR);
ensureDirectory(FINAL_UPLOADS_DIR);

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
  

  async saveTempUpload(
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string,
    options: UploadOptions = {},
  ) {
    const { userId, clientIp, ttlHours = DEFAULT_TTL_HOURS } = options;

    try {

      const ext = path.extname(originalFilename);
      const hash = crypto.randomBytes(16).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filePath = path.join(TEMP_UPLOADS_DIR, filename);

      ensureDirectory(TEMP_UPLOADS_DIR);

      try {
        fs.writeFileSync(filePath, fileBuffer);
      } catch (writeError: any) {

        logger.error(`⚠️ Erro ao escrever em ${filePath}:`, writeError.message);

        const fallbackPath = path.join("./storage/temp", filename);
        ensureDirectory(path.dirname(fallbackPath));
        fs.writeFileSync(fallbackPath, fileBuffer);

        logger.info(`✅ Arquivo salvo em fallback: ${fallbackPath}`);
      }

      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

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

  

  async makePermanent(uploadId: string, orderId: string) {
    try {
      const upload = await prisma.tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        throw new Error("Upload não encontrado");
      }

      const destPath = path.join(
        FINAL_UPLOADS_DIR,
        `${orderId}_${upload.filename}`,
      );
      fs.copyFileSync(upload.filePath, destPath);

      await prisma.tempUpload.update({
        where: { id: uploadId },
        data: {
          expiresAt: new Date("2099-12-31"),
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

  

  async getTempUpload(uploadId: string) {
    try {
      const upload = await prisma.tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        throw new Error("Upload não encontrado");
      }

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

  

  async deleteTempUpload(uploadId: string) {
    try {
      const upload = await prisma.tempUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        throw new Error("Upload não encontrado");
      }

      if (fs.existsSync(upload.filePath)) {
        fs.unlinkSync(upload.filePath);
      }

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

  

  async cleanupExpiredUploads(): Promise<CleanupResult> {
    const result: CleanupResult = {
      deletedCount: 0,
      deletedSize: 0,
      errors: [],
    };

    try {
      logger.info("🧹 Iniciando limpeza de uploads expirados...");

      const now = new Date();

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

          if (fs.existsSync(upload.filePath)) {
            const stats = fs.statSync(upload.filePath);
            fs.unlinkSync(upload.filePath);
            result.deletedSize += stats.size;
          }

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
