import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

interface SlotDef {
  id: string;
  x: number; // % do left relativo à base (0-100)
  y: number; // % do top relativo à base (0-100)
  width: number; // % da largura da base
  height: number; // % da altura da base
  rotation?: number; // graus
  zIndex?: number;
  fit?: "cover" | "contain";
}

interface ImageSlot {
  slotId: string;
  imagePath: string;
}

interface CompositionResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export class ImageCompositionService {
  /**
   * Compõe imagem final baseado no layout base e imagens do cliente
   * @param baseImagePath Caminho da imagem base do layout
   * @param baseWidth Largura da imagem base em px
   * @param baseHeight Altura da imagem base em px
   * @param slots Definições dos slots (posições em percentual)
   * @param images Array com slotId e caminho da imagem do cliente
   * @returns Buffer da imagem composta
   */
  async composeImage(
    baseImagePath: string,
    baseWidth: number,
    baseHeight: number,
    slots: SlotDef[],
    images: ImageSlot[]
  ): Promise<CompositionResult> {
    // Validar caminho da imagem base
    try {
      await fs.access(baseImagePath);
    } catch (error) {
      throw new Error(`Imagem base não encontrada: ${baseImagePath}`);
    }

    // Carregar imagem base
    let baseImage = sharp(baseImagePath);

    // Garantir dimensões corretas
    baseImage = baseImage.resize(baseWidth, baseHeight, {
      fit: "cover",
      position: "center",
    });

    // Ordenar slots por zIndex (menor primeiro, fica no fundo)
    const sortedSlots = [...slots].sort(
      (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
    );

    // Preparar composites
    const composites: sharp.OverlayOptions[] = [];

    for (const slot of sortedSlots) {
      // Verificar se há imagem para este slot
      const imageSlot = images.find((img) => img.slotId === slot.id);
      if (!imageSlot) continue;

      // Validar se arquivo existe
      try {
        await fs.access(imageSlot.imagePath);
      } catch (error) {
        console.warn(
          `Imagem não encontrada para slot ${slot.id}: ${imageSlot.imagePath}`
        );
        continue;
      }

      // Converter slot percentual para pixels
      const slotPx = {
        x: Math.round((slot.x / 100) * baseWidth),
        y: Math.round((slot.y / 100) * baseHeight),
        width: Math.round((slot.width / 100) * baseWidth),
        height: Math.round((slot.height / 100) * baseHeight),
      };

      // Processar imagem do cliente
      const processedImage = await this.processSlotImage(
        imageSlot.imagePath,
        slotPx.width,
        slotPx.height,
        slot.fit || "cover",
        slot.rotation || 0
      );

      // Adicionar ao composite
      composites.push({
        input: processedImage,
        left: slotPx.x,
        top: slotPx.y,
      });
    }

    // Aplicar composição
    const finalBuffer = await baseImage
      .composite(composites)
      .png({ compressionLevel: 9, quality: 95 })
      .toBuffer();

    return {
      buffer: finalBuffer,
      width: baseWidth,
      height: baseHeight,
    };
  }

  /**
   * Processa imagem do cliente para caber no slot
   * @param imagePath Caminho da imagem original
   * @param targetWidth Largura alvo em px
   * @param targetHeight Altura alvo em px
   * @param fit Modo de ajuste (cover ou contain)
   * @param rotation Rotação em graus
   * @returns Buffer da imagem processada
   */
  private async processSlotImage(
    imagePath: string,
    targetWidth: number,
    targetHeight: number,
    fit: "cover" | "contain",
    rotation: number
  ): Promise<Buffer> {
    let image = sharp(imagePath);

    // Obter dimensões originais
    const metadata = await image.metadata();
    const origWidth = metadata.width || 0;
    const origHeight = metadata.height || 0;

    if (!origWidth || !origHeight) {
      throw new Error(
        `Não foi possível obter dimensões da imagem: ${imagePath}`
      );
    }

    if (fit === "cover") {
      // Modo cover: redimensionar e cortar para preencher completamente o slot
      const scale = Math.max(
        targetWidth / origWidth,
        targetHeight / origHeight
      );

      const newW = Math.ceil(origWidth * scale);
      const newH = Math.ceil(origHeight * scale);

      // Redimensionar
      image = image.resize(newW, newH, {
        fit: "cover",
        position: "center",
      });

      // Extrair região central
      const offsetX = Math.floor((newW - targetWidth) / 2);
      const offsetY = Math.floor((newH - targetHeight) / 2);

      image = image.extract({
        left: Math.max(0, offsetX),
        top: Math.max(0, offsetY),
        width: targetWidth,
        height: targetHeight,
      });
    } else {
      // Modo contain: redimensionar mantendo proporção sem cortar
      image = image.resize(targetWidth, targetHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparente
      });
    }

    // Aplicar rotação se necessário
    if (rotation !== 0) {
      image = image.rotate(rotation, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    return await image.toBuffer();
  }

  /**
   * Gera preview em resolução menor para feedback rápido
   * @param baseImagePath Caminho da imagem base
   * @param baseWidth Largura original
   * @param baseHeight Altura original
   * @param slots Slots
   * @param images Imagens
   * @param maxWidth Largura máxima do preview (default: 800)
   * @returns Buffer do preview
   */
  async generatePreview(
    baseImagePath: string,
    baseWidth: number,
    baseHeight: number,
    slots: SlotDef[],
    images: ImageSlot[],
    maxWidth: number = 800
  ): Promise<Buffer> {
    // Calcular escala para preview
    const scale = Math.min(1, maxWidth / baseWidth);
    const previewWidth = Math.round(baseWidth * scale);
    const previewHeight = Math.round(baseHeight * scale);

    // Escalar slots proporcionalmente (percentuais não mudam)
    const result = await this.composeImage(
      baseImagePath,
      previewWidth,
      previewHeight,
      slots,
      images
    );

    return result.buffer;
  }

  /**
   * Valida dimensões e tamanho da imagem
   * @param imagePath Caminho da imagem
   * @param maxSizeMB Tamanho máximo em MB
   * @param minWidth Largura mínima
   * @param minHeight Altura mínima
   */
  async validateImage(
    imagePath: string,
    maxSizeMB: number = 20,
    minWidth?: number,
    minHeight?: number
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      // Verificar tamanho do arquivo
      const stats = await fs.stat(imagePath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > maxSizeMB) {
        return {
          valid: false,
          error: `Imagem muito grande: ${sizeMB.toFixed(
            2
          )}MB (máximo: ${maxSizeMB}MB)`,
        };
      }

      // Verificar dimensões
      const metadata = await sharp(imagePath).metadata();

      if (!metadata.width || !metadata.height) {
        return {
          valid: false,
          error: "Não foi possível obter dimensões da imagem",
        };
      }

      // Validar dimensões mínimas
      if (minWidth && metadata.width < minWidth) {
        return {
          valid: false,
          error: `Largura muito pequena: ${metadata.width}px (mínimo: ${minWidth}px)`,
        };
      }

      if (minHeight && metadata.height < minHeight) {
        return {
          valid: false,
          error: `Altura muito pequena: ${metadata.height}px (mínimo: ${minHeight}px)`,
        };
      }

      // Validar megapixels (máximo 20MP)
      const megapixels = (metadata.width * metadata.height) / 1000000;
      if (megapixels > 20) {
        return {
          valid: false,
          error: `Resolução muito alta: ${megapixels.toFixed(
            1
          )}MP (máximo: 20MP)`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Erro ao validar imagem: ${error}`,
      };
    }
  }
}

export default new ImageCompositionService();
