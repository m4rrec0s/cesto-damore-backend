import { Request, Response } from "express";
import { z } from "zod";
import { CustomizationType } from "@prisma/client";
import prisma from "../database/prisma";
import orderCustomizationService from "../services/orderCustomizationService";
import tempFileService from "../services/tempFileService";
import logger from "../utils/logger";

const uuidSchema = z.string().uuid({ message: "Identificador inválido" });

const artworkSchema = z.object({
  base64: z.string().min(1, "Conteúdo base64 obrigatório"),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
});

const customizationPayloadSchema = z.object({
  customizationRuleId: uuidSchema.optional().nullable(),
  customizationType: z.nativeEnum(CustomizationType),
  title: z.string().min(1),
  selectedLayoutId: uuidSchema.optional().nullable(),
  data: z.record(z.any()).default({}),
  finalArtwork: artworkSchema.optional(),
  finalArtworks: z.array(artworkSchema).optional(),
});

class OrderCustomizationController {
  /**
   * Converte base64 para arquivo temporário
   * Suporta:
   * - data:image/jpeg;base64,/9j/4AAQ...
   * - /9j/4AAQ... (raw base64)
   */
  private async convertBase64ToFile(
    base64String: string,
    fileName: string = "artwork"
  ): Promise<string | null> {
    try {
      let buffer: Buffer;

      // Se começar com data:, extrair apenas o conteúdo base64
      if (base64String.startsWith("data:")) {
        const matches = base64String.match(/data:[^;]+;base64,(.+)/);
        if (!matches) {
          logger.warn(
            `❌ Formato base64 inválido: ${base64String.substring(0, 50)}`
          );
          return null;
        }
        buffer = Buffer.from(matches[1], "base64");
      } else {
        // Raw base64
        buffer = Buffer.from(base64String, "base64");
      }

      // Salvar arquivo em /app/storage/temp
      const result = await tempFileService.saveFile(buffer, fileName);
      logger.info(`✅ Base64 convertido para arquivo: ${result.filename}`);
      return result.url;
    } catch (error: any) {
      logger.error(`❌ Erro ao converter base64: ${error.message}`);
      return null;
    }
  }

  /**
   * Processa recursivamente o payload para converter base64 em URLs temporárias
   */
  private async processBase64InData(data: any): Promise<any> {
    if (!data) return data;

    // Se for array
    if (Array.isArray(data)) {
      return Promise.all(data.map((item) => this.processBase64InData(item)));
    }

    // Se for objeto
    if (typeof data === "object") {
      const processed: any = {};

      for (const [key, value] of Object.entries(data)) {
        // Se for campo com base64
        if (
          (key.includes("base64") ||
            key === "artwork" ||
            key === "finalArtwork" ||
            key.includes("photo")) &&
          typeof value === "object"
        ) {
          const obj = value as any;

          // Se tiver campo base64, converter para URL
          if (obj.base64 && typeof obj.base64 === "string") {
            const url = await this.convertBase64ToFile(
              obj.base64,
              obj.fileName || "artwork"
            );
            if (url) {
              processed[key] = { ...obj, preview_url: url, base64: undefined };
              logger.debug(`✅ Convertido ${key} base64 para URL: ${url}`);
            } else {
              processed[key] = obj;
            }
          } else {
            processed[key] = await this.processBase64InData(value);
          }
        } else if (typeof value === "object" && value !== null) {
          processed[key] = await this.processBase64InData(value);
        } else {
          processed[key] = value;
        }
      }

      return processed;
    }

    return data;
  }

  async listOrderCustomizations(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        orderId: uuidSchema,
      });

      const { orderId } = paramsSchema.parse(req.params);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true },
      });

      if (!order) {
        return res.status(404).json({ error: "Pedido não encontrado" });
      }

      const items = await orderCustomizationService.listOrderCustomizations(
        orderId
      );

      return res.json({
        orderId,
        items,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao listar customizações do pedido:", error);
      return res.status(500).json({
        error: "Erro ao listar customizações",
        details: error.message,
      });
    }
  }

  async saveOrderItemCustomization(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        orderId: z.string().uuid({ message: "Identificador inválido" }),
        itemId: z.string().uuid({ message: "Identificador inválido" }),
      });

      const { orderId, itemId } = paramsSchema.parse(req.params);
      const payload = customizationPayloadSchema.parse(req.body);

      await orderCustomizationService.ensureOrderItem(orderId, itemId);

      // ✅ NOVO: Processar base64 antes de salvar
      logger.info(
        `📝 Processando customização com base64... tipo=${payload.customizationType}`
      );

      const customizationData = {
        ...payload.data,
      };

      // Se tiver finalArtwork com base64, converter para arquivo
      if (payload.finalArtwork && payload.finalArtwork.base64) {
        const url = await this.convertBase64ToFile(
          payload.finalArtwork.base64,
          payload.finalArtwork.fileName || "artwork"
        );
        if (url) {
          customizationData.final_artwork = {
            ...payload.finalArtwork,
            preview_url: url,
            base64: undefined,
          };
          logger.info(`✅ finalArtwork convertido para: ${url}`);
        }
      } else if (payload.finalArtwork) {
        customizationData.final_artwork = payload.finalArtwork;
      }

      // Se tiver finalArtworks (array), converter cada um
      if (payload.finalArtworks && Array.isArray(payload.finalArtworks)) {
        customizationData.final_artworks = await Promise.all(
          payload.finalArtworks.map(async (artwork) => {
            if (artwork.base64) {
              const url = await this.convertBase64ToFile(
                artwork.base64,
                artwork.fileName || "artwork"
              );
              if (url) {
                logger.info(`✅ finalArtwork (array) convertido para: ${url}`);
                return {
                  ...artwork,
                  preview_url: url,
                  base64: undefined,
                };
              }
            }
            return artwork;
          })
        );
      }

      // ✅ NOVO: Processar recursivamente qualquer base64 nos dados
      const processedData = await this.processBase64InData(customizationData);

      const record = await orderCustomizationService.saveOrderItemCustomization(
        {
          orderItemId: itemId,
          customizationRuleId: payload.customizationRuleId,
          customizationType: payload.customizationType,
          title: payload.title,
          customizationData: processedData,
          selectedLayoutId: payload.selectedLayoutId,
        }
      );

      logger.info(`✅ Customização salva com sucesso: ${record.id}`);
      return res.status(201).json(record);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      logger.error("Erro ao salvar customização do item:", error);
      return res.status(500).json({
        error: "Erro ao salvar customização",
        details: error.message,
      });
    }
  }
}

export default new OrderCustomizationController();
