import tempFileService from "./tempFileService";
import logger from "../utils/logger";

const BASE64_FIELDS = new Set(["base64", "base64Data"]);
const DIRECT_URL_FIELDS = new Set([
  "previewUrl",
  "preview_url",
  "highQualityUrl",
  "high_quality_url",
  "text",
  "url",
]);

class CustomizationAssetPersistenceService {
  async convertBase64ToTempUrl(
    base64String: string,
    fileName: string = "artwork",
  ): Promise<string | null> {
    try {
      let buffer: Buffer;
      let mimeType = "image/png"; // default

      if (base64String.startsWith("data:")) {
        const matches = base64String.match(/data:([^;]+);base64,(.+)/);
        if (!matches) {
          logger.warn(
            `[CustomizationAssetPersistenceService] Formato base64 invalido para ${fileName}`,
          );
          return null;
        }
        mimeType = matches[1];
        buffer = Buffer.from(matches[2], "base64");
      } else {
        buffer = Buffer.from(base64String, "base64");
      }

      // Adicionar extensão baseada no mimeType se não houver
      let finalFileName = fileName;
      if (!fileName.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
        const ext = mimeType.split("/")[1] || "png";
        finalFileName = `${fileName}.${ext}`;
      }

      const result = await tempFileService.saveFile(buffer, finalFileName);
      return result.url;
    } catch (error: any) {
      logger.error(
        `[CustomizationAssetPersistenceService] Erro ao converter base64 para temp file (${fileName}):`,
        error,
      );
      return null;
    }
  }

  async processBase64InData(data: any): Promise<any> {
    if (!data) return data;

    if (Array.isArray(data)) {
      return Promise.all(data.map((item) => this.processBase64InData(item)));
    }

    if (typeof data !== "object") {
      return data;
    }

    const processed: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (
        typeof value === "string" &&
        DIRECT_URL_FIELDS.has(key) &&
        value.startsWith("data:image")
      ) {
        const fileName = this.buildFileName(key, data);
        const url = await this.convertBase64ToTempUrl(value, fileName);

        if (url) {
          processed[key] = url;
        }

        continue;
      }

      if (
        typeof value === "string" &&
        BASE64_FIELDS.has(key) &&
        value.startsWith("data:image")
      ) {
        const fileName = this.buildFileName(key, data);
        const url = await this.convertBase64ToTempUrl(value, fileName);

        if (url) {
          this.applyResolvedUrl(processed, data, url);
        }

        continue;
      }

      if (Array.isArray(value)) {
        processed[key] = await Promise.all(
          value.map((item) => this.processBase64InData(item)),
        );
        continue;
      }

      if (value && typeof value === "object") {
        const nested = await this.processBase64InData(value);
        processed[key] = nested;
        continue;
      }

      processed[key] = value;
    }

    return processed;
  }

  private applyResolvedUrl(
    target: Record<string, any>,
    original: Record<string, any>,
    url: string,
  ) {
    if (
      "preview_url" in original ||
      "preview_url" in target ||
      "original_name" in original ||
      "temp_file_id" in original
    ) {
      target.preview_url = url;
      return;
    }

    if ("url" in original || "slot" in original) {
      target.url = url;
      return;
    }

    if (
      "previewUrl" in original ||
      "highQualityUrl" in original ||
      "high_quality_url" in original
    ) {
      target.previewUrl = url;
      return;
    }

    target.preview_url = url;
  }

  private buildFileName(key: string, source: Record<string, any>): string {
    const preferred =
      source.fileName ||
      source.filename ||
      source.original_name ||
      source.name ||
      key ||
      "artwork";

    return String(preferred).trim() || "artwork";
  }
}

export default new CustomizationAssetPersistenceService();
