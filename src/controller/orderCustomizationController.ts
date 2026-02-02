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
    fileName: string = "artwork",
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
            `❌ Formato base64 inválido: ${base64String.substring(0, 50)}`,
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
        error.stack,
      );
      return null;
    }
  }

  /**
   * Processa recursivamente o payload para converter base64 em URLs temporárias
   * Detecta e converte:
   * - { base64: "data:...", ... }
   * - { photos: [{ base64: "...", ...}, ...] }
   * - { previewUrl: "data:image...", ... }
   * - { highQualityUrl: "data:image...", ... }
   * ✅ IMPORTANTE: Remove base64 do payload SEMPRE, mantém apenas preview_url
   * ✅ CRÍTICO: Deve deletar base64 em TODOS os objetos recursivamente
   */
  private async processBase64InData(data: any): Promise<any> {
    if (!data) return data;

    // Se for array, processar cada item
    if (Array.isArray(data)) {
      return Promise.all(data.map((item) => this.processBase64InData(item)));
    }

    // Se for objeto
    if (typeof data === "object") {
      const processed: any = {};

      // 🔥 CRÍTICO: Detectar e remover previewUrl/highQualityUrl com base64
      if (
        data.previewUrl &&
        typeof data.previewUrl === "string" &&
        data.previewUrl.startsWith("data:image")
      ) {
        logger.warn(
          "⚠️ [processBase64InData] Detectado previewUrl com base64! Removendo para evitar salvar no BD",
        );
        // Se já tem final_artwork.preview_url, usar ela; senão remover
        if (!data.final_artwork?.preview_url) {
          processed.previewUrl = undefined;
        }
      } else if (data.previewUrl) {
        processed.previewUrl = data.previewUrl;
      }

      if (
        data.highQualityUrl &&
        typeof data.highQualityUrl === "string" &&
        data.highQualityUrl.startsWith("data:image")
      ) {
        logger.warn(
          "⚠️ [processBase64InData] Detectado highQualityUrl com base64! Removendo para evitar salvar no BD",
        );
        processed.highQualityUrl = undefined;
      } else if (data.highQualityUrl) {
        processed.highQualityUrl = data.highQualityUrl;
      }

      for (const [key, value] of Object.entries(data)) {
        // Pular previewUrl/highQualityUrl já processados acima
        if (key === "previewUrl" || key === "highQualityUrl") {
          continue;
        }

        // ✅ SPECIAL CASE: Se for array de fotos, processar cada item
        if (key === "photos" && Array.isArray(value)) {
          logger.debug(
            `🔄 [processBase64InData] Detectado array "photos" com ${value.length} itens`,
          );
          processed[key] = await Promise.all(
            value.map(async (photo: any, idx: number) => {
              if (!photo || typeof photo !== "object") {
                return photo;
              }

              const { base64, ...photoSemBase64 } = photo;

              if (base64 && photo.preview_url) {
                logger.debug(
                  `   [${idx}] Foto com preview_url detectada, removendo base64`,
                );
                return photoSemBase64;
              }

              if (base64) {
                logger.info(
                  `   [${idx}] Foto com base64 detectada, convertendo...`,
                );
                const url = await this.convertBase64ToFile(
                  base64,
                  photo.original_name || `photo-${idx}`,
                );
                if (url) {
                  logger.info(`   [${idx}] ✅ Convertida para: ${url}`);
                  return {
                    ...photoSemBase64,
                    preview_url: url,
                  };
                } else {
                  logger.warn(`   [${idx}] ⚠️ Falha ao converter base64`);
                  return photoSemBase64;
                }
              }

              return photoSemBase64;
            }),
          );
          continue;
        }

        // Se for campo com base64 ou artwork
        if (
          (key.includes("base64") ||
            key === "artwork" ||
            key === "finalArtwork" ||
            key === "image") &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          const obj = value as any;

          // ✅ CRÍTICO: SEMPRE deletar base64 primeiro
          const { base64: objBase64, ...objSemBase64 } = obj;

          // Se tinha base64 e consegue converter
          if (objBase64 && typeof objBase64 === "string") {
            logger.info(
              `🔄 [processBase64InData] Detectado base64 em "${key}"`,
            );
            const url = await this.convertBase64ToFile(
              objBase64,
              obj.fileName || "artwork",
            );
            if (url) {
              processed[key] = { ...objSemBase64, preview_url: url };
              logger.debug(`✅ Convertido "${key}" para URL: ${url}`);
            } else {
              // Falha na conversão, retornar sem base64 mesmo assim
              logger.warn(
                `⚠️ Falha ao converter base64 em "${key}", retornando sem base64`,
              );
              processed[key] = objSemBase64;
            }
          } else {
            // Sem base64 ou não é string, processar recursivamente
            const processedObj = await this.processBase64InData(objSemBase64);
            processed[key] = processedObj;
          }
        } else if (typeof value === "object" && value !== null) {
          // ✅ Processar recursivamente
          const processedValue = await this.processBase64InData(value);
          // ✅ CRÍTICO: SEMPRE deletar base64 de qualquer objeto
          if (
            typeof processedValue === "object" &&
            !Array.isArray(processedValue)
          ) {
            const { base64: nestedBase64, ...valueSemBase64 } = processedValue;
            if (nestedBase64) {
              logger.debug(
                `🗑️ [processBase64InData] Removendo base64 aninhado em "${key}"`,
              );
            }
            processed[key] = valueSemBase64;
          } else {
            processed[key] = processedValue;
          }
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

      const items =
        await orderCustomizationService.listOrderCustomizations(orderId);

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

  saveOrderItemCustomization = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        orderId: z.string().uuid({ message: "Identificador inválido" }),
        itemId: z.string().uuid({ message: "Identificador inválido" }),
      });

      const { orderId, itemId } = paramsSchema.parse(req.params);
      logger.info(
        `🎯 [saveOrderItemCustomization] orderId=${orderId}, itemId=${itemId}`,
      );

      const payload = customizationPayloadSchema.parse(req.body);
      logger.info(`📦 Payload recebido: tipo=${payload.customizationType}`);
      logger.debug(`   finalArtwork? ${!!payload.finalArtwork}`);
      logger.debug(`   finalArtworks? ${!!payload.finalArtworks}`);
      logger.debug(
        `   finalArtwork.base64? ${
          payload.finalArtwork ? !!payload.finalArtwork.base64 : "N/A"
        }`,
      );

      // ✅ DEBUG: Log do payload.data para DYNAMIC_LAYOUT
      if (payload.customizationType === "DYNAMIC_LAYOUT") {
        logger.debug(
          `📦 [DYNAMIC_LAYOUT] Payload.data:`,
          JSON.stringify(payload.data).substring(0, 500),
        );
      }

      await orderCustomizationService.ensureOrderItem(orderId, itemId);

      // ✅ NOVO: Processar base64 antes de salvar
      logger.info(
        `📝 Processando customização com base64... tipo=${payload.customizationType}`,
      );

      const customizationData = {
        ...payload.data,
      };

      // Se tiver finalArtwork com base64, converter para arquivo
      if (payload.finalArtwork && payload.finalArtwork.base64) {
        logger.info(
          `🔄 Detectado finalArtwork com base64! Convertendo... fileName=${payload.finalArtwork.fileName}`,
        );
        const url = await this.convertBase64ToFile(
          payload.finalArtwork.base64,
          payload.finalArtwork.fileName || "artwork",
        );
        if (url) {
          // ✅ Deletar base64 do objeto
          const { base64, ...artworkSemBase64 } = payload.finalArtwork;
          const finalArtworkData = {
            ...artworkSemBase64,
            preview_url: url,
          };
          customizationData.final_artwork = finalArtworkData;
          // ✅ CRÍTICO: Também salvar no campo text para compatibilidade e melhor qualidade no preview
          customizationData.text = url;
          // Se for DYNAMIC_LAYOUT, também atualizar campo image
          if (payload.customizationType === "DYNAMIC_LAYOUT") {
            customizationData.image = finalArtworkData;
          }
          logger.info(`✅ finalArtwork convertido para: ${url}`);
        } else {
          logger.warn(`⚠️ Falha ao converter finalArtwork base64`);
        }
      } else if (payload.finalArtwork) {
        logger.info(
          `ℹ️ finalArtwork sem base64, usando como está: ${JSON.stringify(
            payload.finalArtwork,
          ).substring(0, 100)}`,
        );
        // ✅ Mesmo sem base64, deletar o campo se existir
        const { base64, ...artworkSemBase64 } = payload.finalArtwork;
        customizationData.final_artwork = artworkSemBase64;
      }

      // Se tiver finalArtworks (array), converter cada um
      if (payload.finalArtworks && Array.isArray(payload.finalArtworks)) {
        logger.info(
          `🔄 Processando array de ${payload.finalArtworks.length} artworks...`,
        );
        customizationData.final_artworks = await Promise.all(
          payload.finalArtworks.map(async (artwork, idx) => {
            if (artwork.base64) {
              logger.info(`   [${idx}] Convertendo artwork com base64...`);
              const url = await this.convertBase64ToFile(
                artwork.base64,
                artwork.fileName || `artwork-${idx}`,
              );
              if (url) {
                logger.info(`   [${idx}] ✅ Convertido para: ${url}`);
                // ✅ Deletar base64 do objeto
                const { base64, ...artworkSemBase64 } = artwork;
                return {
                  ...artworkSemBase64,
                  preview_url: url,
                };
              } else {
                logger.warn(`   [${idx}] ⚠️ Falha na conversão`);
                return artwork;
              }
            }
            logger.debug(`   [${idx}] Sem base64, passando como está`);
            // ✅ Deletar base64 mesmo sem conversão
            const { base64, ...artworkSemBase64 } = artwork;
            return artworkSemBase64;
          }),
        );
      }

      // ✅ FIX DYNAMIC_LAYOUT: Processar imagem em data.image ANTES de processBase64InData
      if (
        payload.customizationType === "DYNAMIC_LAYOUT" &&
        customizationData.image &&
        typeof customizationData.image === "object" &&
        customizationData.image.base64
      ) {
        logger.info(
          `🔄 [DYNAMIC_LAYOUT] Detectado image.base64 em data.image, convertendo...`,
        );
        const url = await this.convertBase64ToFile(
          customizationData.image.base64,
          customizationData.image.fileName || "base-layout-image",
        );
        if (url) {
          logger.info(`✅ [DYNAMIC_LAYOUT] Imagem convertida para: ${url}`);
          const { base64, ...imageSemBase64 } = customizationData.image;
          customizationData.image = { ...imageSemBase64, preview_url: url };
        } else {
          logger.warn(`⚠️ [DYNAMIC_LAYOUT] Falha ao converter imagem`);
          const { base64, ...imageSemBase64 } = customizationData.image;
          customizationData.image = imageSemBase64;
        }
      } else if (payload.customizationType === "DYNAMIC_LAYOUT") {
        // ✅ DEBUG: Se é DYNAMIC_LAYOUT mas não tem image.base64, logar para investigar
        logger.warn(
          `⚠️ [DYNAMIC_LAYOUT] Sem image.base64! customizationData:`,
          JSON.stringify(customizationData).substring(0, 300),
        );
      }

      // ✅ NOVO: Processar recursivamente qualquer base64 nos dados
      logger.debug(
        `📝 [ANTES processBase64InData] customizationData para ${payload.customizationType}:`,
        JSON.stringify(customizationData).substring(0, 500),
      );

      let processedData = await this.processBase64InData(customizationData);

      logger.debug(
        `✅ [DEPOIS processBase64InData] customizationData para ${payload.customizationType}:`,
        JSON.stringify(processedData).substring(0, 500),
      );

      const record = await orderCustomizationService.saveOrderItemCustomization(
        {
          orderItemId: itemId,
          customizationRuleId: payload.customizationRuleId,
          customizationType: payload.customizationType,
          title: payload.title,
          customizationData: processedData,
          selectedLayoutId: payload.selectedLayoutId,
        },
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
  };
}

export default new OrderCustomizationController();
