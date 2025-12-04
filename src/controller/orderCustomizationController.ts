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
      logger.info(`🔄 [convertBase64ToFile] Iniciando conversão: ${fileName}`);
      let buffer: Buffer;

      // Se começar com data:, extrair apenas o conteúdo base64
      if (base64String.startsWith("data:")) {
        logger.debug(`   Base64 com prefixo data:, extraindo...`);
        const matches = base64String.match(/data:[^;]+;base64,(.+)/);
        if (!matches) {
          logger.warn(
            `❌ Formato base64 inválido: ${base64String.substring(0, 50)}`
          );
          return null;
        }
        buffer = Buffer.from(matches[1], "base64");
        logger.info(`   ✅ Base64 decodificado: ${buffer.length} bytes`);
      } else {
        // Raw base64
        logger.debug(`   Raw base64, decodificando...`);
        buffer = Buffer.from(base64String, "base64");
        logger.info(`   ✅ Base64 raw decodificado: ${buffer.length} bytes`);
      }

      // Salvar arquivo em /app/storage/temp
      logger.info(`   💾 Salvando arquivo via tempFileService...`);
      const result = await tempFileService.saveFile(buffer, fileName);
      logger.info(`✅ [convertBase64ToFile] Sucesso! URL: ${result.url}`);
      return result.url;
    } catch (error: any) {
      logger.error(
        `❌ [convertBase64ToFile] Erro: ${error.message}`,
        error.stack
      );
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
      logger.info(
        `🎯 [saveOrderItemCustomization] orderId=${orderId}, itemId=${itemId}`
      );

      const payload = customizationPayloadSchema.parse(req.body);
      logger.info(`📦 Payload recebido: tipo=${payload.customizationType}`);
      logger.debug(`   finalArtwork? ${!!payload.finalArtwork}`);
      logger.debug(`   finalArtworks? ${!!payload.finalArtworks}`);
      logger.debug(
        `   finalArtwork.base64? ${
          payload.finalArtwork ? !!payload.finalArtwork.base64 : "N/A"
        }`
      );

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
        logger.info(
          `🔄 Detectado finalArtwork com base64! Convertendo... fileName=${payload.finalArtwork.fileName}`
        );
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
        } else {
          logger.warn(`⚠️ Falha ao converter finalArtwork base64`);
        }
      } else if (payload.finalArtwork) {
        logger.info(
          `ℹ️ finalArtwork sem base64, usando como está: ${JSON.stringify(
            payload.finalArtwork
          ).substring(0, 100)}`
        );
        customizationData.final_artwork = payload.finalArtwork;
      } else {
        logger.debug(`ℹ️ Sem finalArtwork no payload`);
      }

      // Se tiver finalArtworks (array), converter cada um
      if (payload.finalArtworks && Array.isArray(payload.finalArtworks)) {
        logger.info(
          `🔄 Processando array de ${payload.finalArtworks.length} artworks...`
        );
        customizationData.final_artworks = await Promise.all(
          payload.finalArtworks.map(async (artwork, idx) => {
            if (artwork.base64) {
              logger.info(`   [${idx}] Convertendo artwork com base64...`);
              const url = await this.convertBase64ToFile(
                artwork.base64,
                artwork.fileName || `artwork-${idx}`
              );
              if (url) {
                logger.info(`   [${idx}] ✅ Convertido para: ${url}`);
                return {
                  ...artwork,
                  preview_url: url,
                  base64: undefined,
                };
              } else {
                logger.warn(`   [${idx}] ⚠️ Falha na conversão`);
                return artwork;
              }
            }
            logger.debug(`   [${idx}] Sem base64, passando como está`);
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
