import { Request, Response } from "express";
import { z } from "zod";
import prisma from "../database/prisma";

const uuidSchema = z.string().uuid({ message: "Identificador inválido" });

const itemTypeSchema = z.enum(["PRODUCT", "ADDITIONAL"]);
const constraintTypeSchema = z.enum(["MUTUALLY_EXCLUSIVE", "REQUIRES"]);

const itemConstraintInputSchema = z.object({
  target_item_id: uuidSchema,
  target_item_type: itemTypeSchema,
  constraint_type: constraintTypeSchema,
  related_item_id: uuidSchema,
  related_item_type: itemTypeSchema,
  message: z.string().optional(),
});

class ItemConstraintController {
  

  async listAll(req: Request, res: Response) {
    try {
      return res.json([]);
    } catch (error: any) {
      console.error("Erro ao listar constraints:", error);
      return res.status(500).json({
        error: "Erro ao listar constraints",
        details: error.message,
      });
    }
  }

  async getByItem(req: Request, res: Response) {
    try {
      return res.json([]);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao buscar constraints:", error);
      return res.status(500).json({
        error: "Erro ao buscar constraints",
        details: error.message,
      });
    }
  }
  

  async create(req: Request, res: Response) {
    try {

      return res.status(501).json({
        error: "Funcionalidade desabilitada - Tabela removida",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao criar constraint:", error);
      return res.status(500).json({
        error: "Erro ao criar constraint",
        details: error.message,
      });
    }
  }

  

  async update(req: Request, res: Response) {
    try {

      return res.status(501).json({
        error: "Funcionalidade desabilitada - Tabela removida",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao atualizar constraint:", error);
      return res.status(500).json({
        error: "Erro ao atualizar constraint",
        details: error.message,
      });
    }
  }

  

  async delete(req: Request, res: Response) {
    try {

      return res.json({
        message: "Constraint deletado com sucesso (simulado)",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao deletar constraint:", error);
      return res.status(500).json({
        error: "Erro ao deletar constraint",
        details: error.message,
      });
    }
  }

  async searchItems(req: Request, res: Response) {
    try {
      const querySchema = z.object({
        q: z.string().min(1, "Termo de busca é obrigatório"),
      });

      const { q } = querySchema.parse(req.query);

      const [products, additionals] = await Promise.all([
        prisma.product.findMany({
          where: {
            name: {
              contains: q,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
            name: true,
            image_url: true,
          },
          take: 10,
        }),
        prisma.item.findMany({
          where: {
            name: {
              contains: q,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
            name: true,
            image_url: true,
          },
          take: 10,
        }),
      ]);

      return res.json({
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          type: "PRODUCT" as const,
          image_url: p.image_url,
        })),
        additionals: additionals.map((a) => ({
          id: a.id,
          name: a.name,
          type: "ADDITIONAL" as const,
          image_url: a.image_url,
        })),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao buscar itens:", error);
      return res.status(500).json({
        error: "Erro ao buscar itens",
        details: error.message,
      });
    }
  }
}

export default new ItemConstraintController();
