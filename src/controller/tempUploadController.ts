import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import fileType from "file-type";

const prisma = new PrismaClient();

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

class TempUploadController {
  /**
   * POST /uploads/temp
   * Upload de imagem temporária do cliente
   */
  async uploadTemp(req: Request, res: Response) {
    try {
      const { sessionId, slotId } = req.body;

      // Validar campos
      if (!sessionId) {
        return res.status(400).json({
          error: "sessionId é obrigatório",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Arquivo é obrigatório",
        });
      }

      // Validar tamanho
      if (req.file.size > MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({
          error: `Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`,
        });
      }

      // Validar mime type usando file-type
      const fileBuffer = await fs.readFile(req.file.path);
      const detectedFileType = await fileType.fromBuffer(fileBuffer);

      if (
        !detectedFileType ||
        !ALLOWED_MIME_TYPES.includes(detectedFileType.mime)
      ) {
        // Limpar arquivo
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          error: "Tipo de arquivo não permitido. Use JPEG, PNG, WebP ou GIF",
        });
      }

      // Obter dimensões da imagem
      const metadata = await sharp(req.file.path).metadata();

      if (!metadata.width || !metadata.height) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          error: "Não foi possível obter dimensões da imagem",
        });
      }

      // Validar dimensões (máximo 20MP)
      const megapixels = (metadata.width * metadata.height) / 1000000;
      if (megapixels > 20) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          error: `Resolução muito alta: ${megapixels.toFixed(
            1
          )}MP (máximo: 20MP)`,
        });
      }

      // Calcular data de expiração (24 horas)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      // Salvar no banco
      const tempFile = await prisma.temporaryCustomizationFile.create({
        data: {
          session_id: sessionId,
          slot_id: slotId || null,
          file_path: req.file.path,
          mime_type: detectedFileType.mime,
          original_name: req.file.originalname,
          file_size: req.file.size,
          width: metadata.width,
          height: metadata.height,
          expires_at: expiresAt,
        },
      });

      // Retornar dados
      return res.status(201).json({
        tempId: tempFile.id,
        tempUrl: `/storage/temp/${sessionId}/${path.basename(req.file.path)}`,
        width: metadata.width,
        height: metadata.height,
        originalName: req.file.originalname,
      });
    } catch (error) {
      console.error("Erro no upload temporário:", error);

      // Limpar arquivo se foi criado
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }

      return res.status(500).json({
        error: "Erro ao fazer upload da imagem",
      });
    }
  }

  /**
   * GET /uploads/temp/:sessionId
   * Listar arquivos temporários de uma sessão
   */
  async listBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      const files = await prisma.temporaryCustomizationFile.findMany({
        where: {
          session_id: sessionId,
          expires_at: {
            gt: new Date(),
          },
        },
        orderBy: {
          created_at: "desc",
        },
      });

      return res.json(files);
    } catch (error) {
      console.error("Erro ao listar arquivos:", error);
      return res.status(500).json({
        error: "Erro ao listar arquivos",
      });
    }
  }

  /**
   * DELETE /uploads/temp/:id
   * Deletar arquivo temporário
   */
  async deleteTemp(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const tempFile = await prisma.temporaryCustomizationFile.findUnique({
        where: { id },
      });

      if (!tempFile) {
        return res.status(404).json({
          error: "Arquivo não encontrado",
        });
      }

      // Deletar arquivo físico
      const filePath = path.join(process.cwd(), tempFile.file_path);
      await fs.unlink(filePath).catch(() => {});

      // Deletar registro
      await prisma.temporaryCustomizationFile.delete({
        where: { id },
      });

      return res.json({
        message: "Arquivo deletado com sucesso",
      });
    } catch (error) {
      console.error("Erro ao deletar arquivo:", error);
      return res.status(500).json({
        error: "Erro ao deletar arquivo",
      });
    }
  }
}

export default new TempUploadController();
