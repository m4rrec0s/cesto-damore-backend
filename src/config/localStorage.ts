import fs from "fs";
import path from "path";
import crypto from "crypto";
import logger from "../utils/logger";

const IMAGES_DIR =
  process.env.NODE_ENV === "production"
    ? "/app/images"
    : path.join(process.cwd(), "images");

const BASE_URL = process.env.BASE_URL;

logger.info("📁 [STORAGE CONFIG]", {
  NODE_ENV: process.env.NODE_ENV,
  IMAGES_DIR,
  BASE_URL,
});

export const ensureImagesDirectory = () => {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  } else {
  }
};

export const saveImageLocally = async (
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<string> => {
  try {
    ensureImagesDirectory();

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const shortHash = hash.slice(0, 12);

    const timestamp = Date.now();
    const baseFileName = path.parse(originalName).name;
    const extension =
      path.extname(originalName) || getExtensionFromMimeType(mimeType);

    const existing = fs
      .readdirSync(IMAGES_DIR)
      .find(
        (f) =>
          f.includes(`-${shortHash}-`) ||
          f.includes(`-${shortHash}${extension}`),
      );

    if (existing) {
      return `${BASE_URL}/images/${existing}`;
    }

    const fileName = `${timestamp}-${shortHash}-${sanitizeFileName(
      baseFileName,
    )}${extension}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    fs.writeFileSync(filePath, buffer);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      logger.info(
        `[STORAGE] Imagem salva com sucesso! Tamanho: ${stats.size} bytes`,
      );
    } else {
      logger.error("❌ [STORAGE] ARQUIVO NÃO EXISTE APÓS writeFileSync!");
    }

    const imageUrl = `${BASE_URL}/images/${fileName}`;

    return imageUrl;
  } catch (error: any) {
    logger.error("❌ [ERRO CRÍTICO] saveImageLocally falhou:", error);
    logger.error("❌ Stack trace:", error.stack);
    throw new Error(`Erro ao salvar imagem: ${error.message}`);
  }
};

/**
 * Salva uma imagem em base64 localmente e retorna a URL
 */
export const saveBase64Image = async (
  base64String: string,
  prefix: string = "layout",
): Promise<string> => {
  if (!base64String || !base64String.startsWith("data:image")) {
    return base64String; // Retorna como está se não for base64
  }

  try {
    ensureImagesDirectory();

    const matches = base64String.match(
      /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/,
    );

    if (!matches || matches.length !== 3) {
      return base64String;
    }

    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    const extension = getExtensionFromMimeType(mimeType);
    const hash = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex")
      .slice(0, 12);
    const fileName = `${prefix}-${Date.now()}-${hash}${extension}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    fs.writeFileSync(filePath, buffer);

    logger.info(`✅ [STORAGE] Imagem base64 salva: ${fileName}`);
    return `${BASE_URL}/images/${fileName}`;
  } catch (error: any) {
    logger.error("❌ Erro ao salvar imagem base64:", error);
    return base64String; // Fallback para o base64 original em caso de erro
  }
};

export const deleteImageLocally = async (imageUrl: string): Promise<void> => {
  try {
    if (!imageUrl) return;

    let fileName = "";

    if (imageUrl.startsWith("http")) {
      try {
        fileName = path.basename(new URL(imageUrl).pathname);
      } catch (e) {
        fileName = path.basename(imageUrl);
      }
    } else if (imageUrl.startsWith("/")) {
      fileName = path.basename(imageUrl);
    } else {
      fileName = imageUrl;
    }

    const filePath = path.join(IMAGES_DIR, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`🗑️ [STORAGE] Arquivo deletado: ${fileName}`);
    } else {
      logger.warn(
        `⚠️ [STORAGE] Arquivo não encontrado para deletar: ${filePath}`,
      );
    }
  } catch (error: any) {
    logger.error("❌ Erro ao deletar imagem:", error.message);
  }
};

export const deleteProductImage = async (
  imageUrl: string | null,
): Promise<void> => {
  if (!imageUrl) {
    return;
  }

  try {
    await deleteImageLocally(imageUrl);
  } catch (error: any) {
    logger.warn(
      "⚠️ Não foi possível deletar a imagem do produto:",
      error.message,
    );
    console.warn("🔄 Produto será deletado mesmo assim");
  }
};

export const deleteAdditionalImage = async (
  imageUrl: string | null,
): Promise<void> => {
  if (!imageUrl) {
    return;
  }

  try {
    await deleteImageLocally(imageUrl);
  } catch (error: any) {
    logger.warn(
      "⚠️ Não foi possível deletar a imagem adicional:",
      error.message,
    );
    console.warn("🔄 Imagem adicional será deletada mesmo assim");
  }
};

export const listLocalImages = (): {
  fileName: string;
  url: string;
  size: number;
}[] => {
  try {
    ensureImagesDirectory();

    const files = fs.readdirSync(IMAGES_DIR);
    return files
      .filter((file) => isImageFile(file))
      .map((file) => {
        const filePath = path.join(IMAGES_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          fileName: file,
          url: `${BASE_URL}/images/${file}`,
          size: stats.size,
        };
      });
  } catch (error: any) {
    logger.error("❌ Erro ao listar imagens:", error.message);
    return [];
  }
};

const sanitizeFileName = (fileName: string): string => {
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
};

const getExtensionFromMimeType = (mimeType: string): string => {
  const mimeToExt: { [key: string]: string } = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
  };
  return mimeToExt[mimeType] || ".jpg";
};

const isImageFile = (fileName: string): boolean => {
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
  ];
  const ext = path.extname(fileName).toLowerCase();
  return imageExtensions.includes(ext);
};

export { IMAGES_DIR };
