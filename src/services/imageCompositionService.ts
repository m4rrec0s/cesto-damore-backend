import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

interface SlotDef {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
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
  

  async composeImage(
    baseImagePath: string,
    baseWidth: number,
    baseHeight: number,
    slots: SlotDef[],
    images: ImageSlot[]
  ): Promise<CompositionResult> {

    try {
      await fs.access(baseImagePath);
    } catch (error) {
      throw new Error(`Imagem base não encontrada: ${baseImagePath}`);
    }

    let baseImage = sharp(baseImagePath);

    baseImage = baseImage.resize(baseWidth, baseHeight, {
      fit: "cover",
      position: "center",
    });

    const sortedSlots = [...slots].sort(
      (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
    );

    const composites: sharp.OverlayOptions[] = [];

    for (const slot of sortedSlots) {

      const imageSlot = images.find((img) => img.slotId === slot.id);
      if (!imageSlot) continue;

      try {
        await fs.access(imageSlot.imagePath);
      } catch (error) {
        console.warn(
          `Imagem não encontrada para slot ${slot.id}: ${imageSlot.imagePath}`
        );
        continue;
      }

      const slotPx = {
        x: Math.round((slot.x / 100) * baseWidth),
        y: Math.round((slot.y / 100) * baseHeight),
        width: Math.round((slot.width / 100) * baseWidth),
        height: Math.round((slot.height / 100) * baseHeight),
      };

      const processedImage = await this.processSlotImage(
        imageSlot.imagePath,
        slotPx.width,
        slotPx.height,
        slot.fit || "cover",
        slot.rotation || 0
      );

      composites.push({
        input: processedImage,
        left: slotPx.x,
        top: slotPx.y,
      });
    }

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

  

  private async processSlotImage(
    imagePath: string,
    targetWidth: number,
    targetHeight: number,
    fit: "cover" | "contain",
    rotation: number
  ): Promise<Buffer> {
    let image = sharp(imagePath);

    const metadata = await image.metadata();
    const origWidth = metadata.width || 0;
    const origHeight = metadata.height || 0;

    if (!origWidth || !origHeight) {
      throw new Error(
        `Não foi possível obter dimensões da imagem: ${imagePath}`
      );
    }

    if (fit === "cover") {

      const scale = Math.max(
        targetWidth / origWidth,
        targetHeight / origHeight
      );

      const newW = Math.ceil(origWidth * scale);
      const newH = Math.ceil(origHeight * scale);

      image = image.resize(newW, newH, {
        fit: "cover",
        position: "center",
      });

      const offsetX = Math.floor((newW - targetWidth) / 2);
      const offsetY = Math.floor((newH - targetHeight) / 2);

      image = image.extract({
        left: Math.max(0, offsetX),
        top: Math.max(0, offsetY),
        width: targetWidth,
        height: targetHeight,
      });
    } else {

      image = image.resize(targetWidth, targetHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    if (rotation !== 0) {
      image = image.rotate(rotation, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    return await image.toBuffer();
  }

  

  async generatePreview(
    baseImagePath: string,
    baseWidth: number,
    baseHeight: number,
    slots: SlotDef[],
    images: ImageSlot[],
    maxWidth: number = 800
  ): Promise<Buffer> {

    const scale = Math.min(1, maxWidth / baseWidth);
    const previewWidth = Math.round(baseWidth * scale);
    const previewHeight = Math.round(baseHeight * scale);

    const result = await this.composeImage(
      baseImagePath,
      previewWidth,
      previewHeight,
      slots,
      images
    );

    return result.buffer;
  }

  

  async validateImage(
    imagePath: string,
    maxSizeMB: number = 20,
    minWidth?: number,
    minHeight?: number
  ): Promise<{ valid: boolean; error?: string }> {
    try {

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

      const metadata = await sharp(imagePath).metadata();

      if (!metadata.width || !metadata.height) {
        return {
          valid: false,
          error: "Não foi possível obter dimensões da imagem",
        };
      }

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
