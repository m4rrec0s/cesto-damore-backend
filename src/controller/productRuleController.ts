import { Request, Response } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import prisma from "../database/prisma";

const uuidSchema = z.string().uuid({ message: "Identificador inválido" });

const ruleTypeSchema = z.enum([
  "PHOTO_UPLOAD",
  "LAYOUT_PRESET",
  "LAYOUT_WITH_PHOTOS",
  "TEXT_INPUT",
  "OPTION_SELECT",
  "ITEM_SUBSTITUTION",
]);

const productRuleInputSchema = z.object({
  product_type_id: uuidSchema,
  rule_type: ruleTypeSchema,
  title: z.string().min(1, "Título é obrigatório"),
  description: z.string().optional(),
  required: z.boolean().default(false),
  max_items: z.number().int().positive().nullable().optional(),
  conflict_with: z.array(z.string()).nullable().optional(),
  dependencies: z.array(z.string()).nullable().optional(),
  available_options: z.any().nullable().optional(),
  preview_image_url: z.string().url().nullable().optional(),
  display_order: z.number().int().default(0),
});

class ProductRuleController {
  /**
   * Lista todas as regras de um tipo de produto
   * GET /admin/customization/rule/type/:productTypeId
   */
  async getRulesByType(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        productTypeId: uuidSchema,
      });

      const { productTypeId } = paramsSchema.parse(req.params);

      const rules = await prisma.productRule.findMany({
        where: { product_type_id: productTypeId },
        orderBy: { display_order: "asc" },
      });

      return res.json(rules);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao buscar regras:", error);
      return res.status(500).json({
        error: "Erro ao buscar regras",
        details: error.message,
      });
    }
  }

  /**
   * Cria uma nova regra de customização
   * POST /admin/customization/rule
   * Suporta multipart/form-data com campo "image" opcional
   */
  async createRule(req: Request, res: Response) {
    try {
      // Parse do body (pode vir como JSON em campos do FormData)
      let parsedBody = req.body;

      // Se tiver campos que são strings JSON, fazer parse
      if (typeof parsedBody.conflict_with === "string") {
        try {
          parsedBody.conflict_with = JSON.parse(parsedBody.conflict_with);
        } catch {
          parsedBody.conflict_with = null;
        }
      }

      if (typeof parsedBody.dependencies === "string") {
        try {
          parsedBody.dependencies = JSON.parse(parsedBody.dependencies);
        } catch {
          parsedBody.dependencies = null;
        }
      }

      if (typeof parsedBody.available_options === "string") {
        try {
          parsedBody.available_options = JSON.parse(
            parsedBody.available_options
          );
        } catch {
          parsedBody.available_options = null;
        }
      }

      // Converter strings de boolean e number
      if (typeof parsedBody.required === "string") {
        parsedBody.required = parsedBody.required === "true";
      }

      if (typeof parsedBody.max_items === "string") {
        const num = parseInt(parsedBody.max_items, 10);
        parsedBody.max_items = isNaN(num) ? null : num;
      }

      if (typeof parsedBody.display_order === "string") {
        const num = parseInt(parsedBody.display_order, 10);
        parsedBody.display_order = isNaN(num) ? 0 : num;
      }

      const payload = productRuleInputSchema.parse(parsedBody);

      // Verificar se o product type existe
      const productType = await prisma.productType.findUnique({
        where: { id: payload.product_type_id },
      });

      if (!productType) {
        return res.status(404).json({
          error: "Tipo de produto não encontrado",
        });
      }

      // Processar upload de imagem se houver
      let previewImageUrl = payload.preview_image_url || null;

      if (req.file) {
        const customizationDir = path.join(
          process.cwd(),
          "images",
          "customizations"
        );

        if (!fs.existsSync(customizationDir)) {
          fs.mkdirSync(customizationDir, { recursive: true });
        }

        const timestamp = Date.now();
        const sanitizedOriginalName = req.file.originalname
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .toLowerCase();
        const filename = `${timestamp}-${sanitizedOriginalName}`;
        const filepath = path.join(customizationDir, filename);

        fs.writeFileSync(filepath, req.file.buffer);

        previewImageUrl = `/images/customizations/${filename}`;
      }

      const rule = await prisma.productRule.create({
        data: {
          product_type_id: payload.product_type_id,
          rule_type: payload.rule_type,
          title: payload.title,
          description: payload.description || null,
          required: payload.required || false,
          max_items: payload.max_items || null,
          conflict_with: payload.conflict_with
            ? JSON.stringify(payload.conflict_with)
            : null,
          dependencies: payload.dependencies
            ? JSON.stringify(payload.dependencies)
            : null,
          available_options:
            payload.available_options !== undefined
              ? JSON.stringify(payload.available_options)
              : null,
          preview_image_url: previewImageUrl,
          display_order: payload.display_order || 0,
        },
      });

      return res.status(201).json(rule);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao criar regra:", error);
      return res.status(500).json({
        error: "Erro ao criar regra",
        details: error.message,
      });
    }
  }

  /**
   * Atualiza uma regra existente
   * PUT /admin/customization/rule/:ruleId
   * Suporta multipart/form-data com campo "image" opcional
   */
  async updateRule(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        ruleId: uuidSchema,
      });

      const { ruleId } = paramsSchema.parse(req.params);

      // Parse do body (pode vir como JSON em campos do FormData)
      let parsedBody = req.body;

      // Se tiver campos que são strings JSON, fazer parse
      if (typeof parsedBody.conflict_with === "string") {
        try {
          parsedBody.conflict_with = JSON.parse(parsedBody.conflict_with);
        } catch {
          parsedBody.conflict_with = null;
        }
      }

      if (typeof parsedBody.dependencies === "string") {
        try {
          parsedBody.dependencies = JSON.parse(parsedBody.dependencies);
        } catch {
          parsedBody.dependencies = null;
        }
      }

      if (typeof parsedBody.available_options === "string") {
        try {
          parsedBody.available_options = JSON.parse(
            parsedBody.available_options
          );
        } catch {
          parsedBody.available_options = null;
        }
      }

      // Converter strings de boolean e number
      if (typeof parsedBody.required === "string") {
        parsedBody.required = parsedBody.required === "true";
      }

      if (typeof parsedBody.max_items === "string") {
        const num = parseInt(parsedBody.max_items, 10);
        parsedBody.max_items = isNaN(num) ? null : num;
      }

      if (typeof parsedBody.display_order === "string") {
        const num = parseInt(parsedBody.display_order, 10);
        parsedBody.display_order = isNaN(num) ? 0 : num;
      }

      const payload = productRuleInputSchema.partial().parse(parsedBody);

      // Verificar se a regra existe
      const existing = await prisma.productRule.findUnique({
        where: { id: ruleId },
      });

      if (!existing) {
        return res.status(404).json({
          error: "Regra não encontrada",
        });
      }

      const updateData: any = {};

      if (payload.rule_type !== undefined)
        updateData.rule_type = payload.rule_type;
      if (payload.title !== undefined) updateData.title = payload.title;
      if (payload.description !== undefined)
        updateData.description = payload.description || null;
      if (payload.required !== undefined)
        updateData.required = payload.required;
      if (payload.max_items !== undefined)
        updateData.max_items = payload.max_items;
      if (payload.conflict_with !== undefined) {
        updateData.conflict_with = payload.conflict_with
          ? JSON.stringify(payload.conflict_with)
          : null;
      }
      if (payload.dependencies !== undefined) {
        updateData.dependencies = payload.dependencies
          ? JSON.stringify(payload.dependencies)
          : null;
      }
      if (payload.available_options !== undefined) {
        updateData.available_options =
          payload.available_options !== null
            ? JSON.stringify(payload.available_options)
            : null;
      }
      if (payload.preview_image_url !== undefined)
        updateData.preview_image_url = payload.preview_image_url;
      if (payload.display_order !== undefined)
        updateData.display_order = payload.display_order;

      // Processar upload de nova imagem se houver
      if (req.file) {
        const customizationDir = path.join(
          process.cwd(),
          "images",
          "customizations"
        );

        if (!fs.existsSync(customizationDir)) {
          fs.mkdirSync(customizationDir, { recursive: true });
        }

        const timestamp = Date.now();
        const sanitizedOriginalName = req.file.originalname
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .toLowerCase();
        const filename = `${timestamp}-${sanitizedOriginalName}`;
        const filepath = path.join(customizationDir, filename);

        fs.writeFileSync(filepath, req.file.buffer);

        updateData.preview_image_url = `/images/customizations/${filename}`;

        // Opcional: Deletar imagem antiga se houver
        if (
          existing.preview_image_url &&
          existing.preview_image_url.startsWith("/images/customizations/")
        ) {
          try {
            const oldFilename = existing.preview_image_url.replace(
              "/images/customizations/",
              ""
            );
            const oldFilepath = path.join(customizationDir, oldFilename);
            if (fs.existsSync(oldFilepath)) {
              fs.unlinkSync(oldFilepath);
            }
          } catch (err) {
            console.warn("Não foi possível deletar imagem antiga:", err);
          }
        }
      }

      const rule = await prisma.productRule.update({
        where: { id: ruleId },
        data: updateData,
      });

      return res.json(rule);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao atualizar regra:", error);
      return res.status(500).json({
        error: "Erro ao atualizar regra",
        details: error.message,
      });
    }
  }

  /**
   * Deleta uma regra
   * DELETE /admin/customization/rule/:ruleId
   */
  async deleteRule(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        ruleId: uuidSchema,
      });

      const { ruleId } = paramsSchema.parse(req.params);

      // Verificar se a regra existe
      const existing = await prisma.productRule.findUnique({
        where: { id: ruleId },
      });

      if (!existing) {
        return res.status(404).json({
          error: "Regra não encontrada",
        });
      }

      await prisma.productRule.delete({
        where: { id: ruleId },
      });

      return res.json({
        message: "Regra deletada com sucesso",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao deletar regra:", error);
      return res.status(500).json({
        error: "Erro ao deletar regra",
        details: error.message,
      });
    }
  }
}

export default new ProductRuleController();
