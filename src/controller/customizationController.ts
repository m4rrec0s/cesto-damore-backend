import { Request, Response } from "express";
import { z } from "zod";
import { CustomizationType } from "@prisma/client";
import customizationService, {
  CustomizationInput,
} from "../services/customizationService";

const customizationInputSchema: z.ZodType<CustomizationInput> = z.object({
  customization_id: z.string().uuid(),
  customization_type: z.nativeEnum(CustomizationType),
  data: z.record(z.any()),
});

class CustomizationController {
  /**
   * Busca customizações disponíveis para um item
   */
  async getItemCustomizations(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        itemId: z.string().uuid({ message: "itemId inválido" }),
      });

      const { itemId } = paramsSchema.parse(req.params);
      const config = await customizationService.getItemCustomizations(itemId);

      return res.json(config);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao buscar customizações:", error);
      return res.status(500).json({
        error: "Erro ao buscar customizações",
        details: error.message,
      });
    }
  }

  /**
   * Valida customizações de um item
   */
  async validateCustomizations(req: Request, res: Response) {
    try {
      const bodySchema = z.object({
        itemId: z.string().uuid({ message: "itemId inválido" }),
        inputs: z.array(customizationInputSchema).default([]),
      });

      const payload = bodySchema.parse(req.body);
      const validation = await customizationService.validateCustomizations(
        payload
      );

      return res.json(validation);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao validar customizações:", error);
      return res.status(500).json({
        error: "Erro ao validar customizações",
        details: error.message,
      });
    }
  }

  /**
   * Gera preview de customizações
   */
  async buildPreview(req: Request, res: Response) {
    try {
      const bodySchema = z.object({
        itemId: z.string().uuid({ message: "itemId inválido" }),
        customizations: z
          .array(customizationInputSchema)
          .min(1, "Forneça ao menos uma customização"),
      });

      const payload = bodySchema.parse(req.body);
      const preview = await customizationService.buildPreviewPayload(payload);

      return res.json(preview);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao gerar preview:", error);
      return res.status(500).json({
        error: "Erro ao gerar preview",
        details: error.message,
      });
    }
  }
}

export default new CustomizationController();
