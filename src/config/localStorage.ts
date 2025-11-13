import fs from "fs";
import path from "path";
import crypto from "crypto";

// Pasta de imagens FORA do diretório do código
// Em produção (Docker): /app/images (mapeado via volume)
// Em desenvolvimento: ./images (dentro do projeto)
const IMAGES_DIR =
  process.env.NODE_ENV === "production"
    ? "/app/images"
    : path.join(process.cwd(), "images");

const BASE_URL = process.env.BASE_URL;

// Log para debug
console.log("📁 [STORAGE CONFIG]", {
  NODE_ENV: process.env.NODE_ENV,
  IMAGES_DIR,
  BASE_URL,
});

export const ensureImagesDirectory = () => {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.log(`📁 [STORAGE] Criando diretório: ${IMAGES_DIR}`);
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  } else {
    console.log(`✅ [STORAGE] Diretório existe: ${IMAGES_DIR}`);
  }
};

export const saveImageLocally = async (
  buffer: Buffer,
  originalName: string,
  mimeType: string
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
          f.includes(`-${shortHash}${extension}`)
      );

    if (existing) {
      console.log(`♻️ [STORAGE] Imagem já existe: ${existing}`);
      return `${BASE_URL}/images/${existing}`;
    }

    const fileName = `${timestamp}-${shortHash}-${sanitizeFileName(
      baseFileName
    )}${extension}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    console.log(`💾 [STORAGE] Salvando imagem em: ${filePath}`);
    fs.writeFileSync(filePath, buffer);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(
        `✅ [STORAGE] Imagem salva com sucesso! Tamanho: ${stats.size} bytes`
      );
      console.log(`✅ [STORAGE] Caminho completo: ${filePath}`);
    } else {
      console.error("❌ [STORAGE] ARQUIVO NÃO EXISTE APÓS writeFileSync!");
    }

    const imageUrl = `${BASE_URL}/images/${fileName}`;
    console.log(`🔗 [STORAGE] URL da imagem: ${imageUrl}`);

    return imageUrl;
  } catch (error: any) {
    console.error("❌ [ERRO CRÍTICO] saveImageLocally falhou:", error);
    console.error("❌ Stack trace:", error.stack);
    throw new Error(`Erro ao salvar imagem: ${error.message}`);
  }
};

export const deleteImageLocally = async (imageUrl: string): Promise<void> => {
  try {
    const fileName = path.basename(new URL(imageUrl).pathname);
    const filePath = path.join(IMAGES_DIR, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return;
    } else {
      console.warn("⚠️ Arquivo não encontrado:", filePath);
    }
  } catch (error: any) {
    console.error("❌ Erro ao deletar imagem:", error.message);
    throw new Error(`Erro ao deletar imagem: ${error.message}`);
  }
};

export const deleteProductImage = async (
  imageUrl: string | null
): Promise<void> => {
  if (!imageUrl) {
    return;
  }

  try {
    await deleteImageLocally(imageUrl);
  } catch (error: any) {
    console.warn(
      "⚠️ Não foi possível deletar a imagem do produto:",
      error.message
    );
    console.warn("🔄 Produto será deletado mesmo assim");
  }
};

export const deleteAdditionalImage = async (
  imageUrl: string | null
): Promise<void> => {
  if (!imageUrl) {
    return;
  }

  try {
    await deleteImageLocally(imageUrl);
  } catch (error: any) {
    console.warn(
      "⚠️ Não foi possível deletar a imagem adicional:",
      error.message
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
    console.error("❌ Erro ao listar imagens:", error.message);
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
