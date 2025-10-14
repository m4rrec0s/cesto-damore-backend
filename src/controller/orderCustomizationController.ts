import { Request, Response } from "express";
import { z } from "zod";
import { CustomizationType } from "@prisma/client";
import prisma from "../database/prisma";
import orderCustomizationService from "../services/orderCustomizationService";

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
        orderId: uuidSchema,
        itemId: uuidSchema,
      });

      const { orderId, itemId } = paramsSchema.parse(req.params);
      const payload = customizationPayloadSchema.parse(req.body);

      await orderCustomizationService.ensureOrderItem(orderId, itemId);

      const customizationData = {
        ...payload.data,
      };

      if (payload.finalArtwork) {
        customizationData.final_artwork = payload.finalArtwork;
      }

      if (payload.finalArtworks) {
        customizationData.final_artworks = payload.finalArtworks;
      }

      const record = await orderCustomizationService.saveOrderItemCustomization(
        {
          orderItemId: itemId,
          customizationRuleId: payload.customizationRuleId,
          customizationType: payload.customizationType,
          title: payload.title,
          customizationData,
          selectedLayoutId: payload.selectedLayoutId,
        }
      );

      return res.status(201).json(record);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao salvar customização do item:", error);
      return res.status(500).json({
        error: "Erro ao salvar customização",
        details: error.message,
      });
    }
  }
}

export default new OrderCustomizationController();
