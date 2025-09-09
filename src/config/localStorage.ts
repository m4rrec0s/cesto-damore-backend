import fs from "fs";
import path from "path";

// Configuração do diretório de imagens
const IMAGES_DIR = path.join(process.cwd(), "images");
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";

// Garante que o diretório de imagens existe
export const ensureImagesDirectory = () => {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    console.log("📁 Diretório de imagens criado:", IMAGES_DIR);
  }
};

// Salva uma imagem no sistema local
export const saveImageLocally = async (
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<string> => {
  try {
    // Garantir que o diretório existe
    ensureImagesDirectory();

    // Gerar nome único para o arquivo
    const timestamp = Date.now();
    const baseFileName = path.parse(originalName).name; // Nome sem extensão
    const extension =
      path.extname(originalName) || getExtensionFromMimeType(mimeType);
    const fileName = `${timestamp}-${sanitizeFileName(
      baseFileName
    )}${extension}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    // Salvar o arquivo
    fs.writeFileSync(filePath, buffer);

    // Retornar URL para acessar a imagem
    const imageUrl = `${BASE_URL}/api/images/${fileName}`;

    console.log("✅ Imagem salva:", {
      originalName,
      fileName,
      size: buffer.length,
      path: filePath,
      url: imageUrl,
    });

    return imageUrl;
  } catch (error: any) {
    console.error("❌ Erro ao salvar imagem:", error.message);
    throw new Error(`Erro ao salvar imagem: ${error.message}`);
  }
};

// Remove uma imagem do sistema local
export const deleteImageLocally = async (imageUrl: string): Promise<void> => {
  try {
    // Extrair nome do arquivo da URL
    const fileName = path.basename(new URL(imageUrl).pathname);
    const filePath = path.join(IMAGES_DIR, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("🗑️ Imagem deletada:", filePath);
    } else {
      console.log("⚠️ Arquivo não encontrado:", filePath);
    }
  } catch (error: any) {
    console.error("❌ Erro ao deletar imagem:", error.message);
    throw new Error(`Erro ao deletar imagem: ${error.message}`);
  }
};

// Remove a imagem de um produto (sem falhar se a imagem não existir)
export const deleteProductImage = async (
  imageUrl: string | null
): Promise<void> => {
  if (!imageUrl) {
    console.log("📄 Produto sem imagem associada, nada para deletar");
    return;
  }

  try {
    await deleteImageLocally(imageUrl);
    console.log("✅ Imagem do produto deletada com sucesso");
  } catch (error: any) {
    // Log do erro mas não falha a operação de deletar produto
    console.warn(
      "⚠️ Não foi possível deletar a imagem do produto:",
      error.message
    );
    console.warn("🔄 Produto será deletado mesmo assim");
  }
};

// Lista todas as imagens salvas
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
          url: `${BASE_URL}/api/images/${file}`,
          size: stats.size,
        };
      });
  } catch (error: any) {
    console.error("❌ Erro ao listar imagens:", error.message);
    return [];
  }
};

// Funções auxiliares
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
