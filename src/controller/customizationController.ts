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

  /**
   * Lista todas as customizações (com filtro opcional por item)
   */
  async index(req: Request, res: Response) {
    try {
      const querySchema = z.object({
        itemId: z.string().uuid().optional(),
      });

      const { itemId } = querySchema.parse(req.query);
      const customizations = await customizationService.listAll(itemId);

      return res.json(customizations);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao listar customizações:", error);
      return res.status(500).json({
        error: "Erro ao listar customizações",
        details: error.message,
      });
    }
  }

  /**
   * Busca uma customização por ID
   */
  async show(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid({ message: "ID inválido" }),
      });

      const { id } = paramsSchema.parse(req.params);
      const customization = await customizationService.getById(id);

      return res.json(customization);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      if (error.message === "Customização não encontrada") {
        return res.status(404).json({ error: error.message });
      }

      console.error("Erro ao buscar customização:", error);
      return res.status(500).json({
        error: "Erro ao buscar customização",
        details: error.message,
      });
    }
  }

  /**
   * Cria uma nova customização
   */
  async create(req: Request, res: Response) {
    try {
      const bodySchema = z.object({
        item_id: z.string().uuid({ message: "item_id inválido" }),
        type: z.nativeEnum(CustomizationType),
        name: z.string().min(1, "Nome é obrigatório"),
        description: z.string().optional(),
        isRequired: z.boolean().default(false),
        customization_data: z.record(z.any()),
        price: z.number().min(0).default(0),
      });

      const payload = bodySchema.parse(req.body);
      const customization = await customizationService.create(payload);

      return res.status(201).json(customization);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao criar customização:", error);
      return res.status(500).json({
        error: "Erro ao criar customização",
        details: error.message,
      });
    }
  }

  /**
   * Atualiza uma customização existente
   */
  async update(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid({ message: "ID inválido" }),
      });

      const bodySchema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        isRequired: z.boolean().optional(),
        customization_data: z.record(z.any()).optional(),
        price: z.number().min(0).optional(),
      });

      const { id } = paramsSchema.parse(req.params);
      const payload = bodySchema.parse(req.body);

      const customization = await customizationService.update(id, payload);

      return res.json(customization);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      if (error.message === "Customização não encontrada") {
        return res.status(404).json({ error: error.message });
      }

      console.error("Erro ao atualizar customização:", error);
      return res.status(500).json({
        error: "Erro ao atualizar customização",
        details: error.message,
      });
    }
  }

  /**
   * Remove uma customização
   */
  async remove(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid({ message: "ID inválido" }),
      });

      const { id } = paramsSchema.parse(req.params);
      await customizationService.delete(id);

      return res.status(204).send();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      if (error.message === "Customização não encontrada") {
        return res.status(404).json({ error: error.message });
      }

      console.error("Erro ao remover customização:", error);
      return res.status(500).json({
        error: "Erro ao remover customização",
        details: error.message,
      });
    }
  }
}

export default new CustomizationController();
