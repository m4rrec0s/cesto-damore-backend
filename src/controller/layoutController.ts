import { Request, Response } from "express";
import { z } from "zod";
import prisma from "../database/prisma";
import fs from "fs";
import path from "path";

class LayoutController {
  /**
   * Lista todos os layouts (com filtro opcional por item)
   */
  async index(req: Request, res: Response) {
    try {
      const querySchema = z.object({
        itemId: z.string().uuid().optional(),
      });

      const { itemId } = querySchema.parse(req.query);

      const layouts = await prisma.layout.findMany({
        where: itemId ? { item_id: itemId } : undefined,
        orderBy: { created_at: "desc" },
      });

      return res.json(layouts);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao listar layouts:", error);
      return res.status(500).json({
        error: "Erro ao listar layouts",
        details: error.message,
      });
    }
  }

  /**
   * Busca um layout por ID
   */
  async show(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid({ message: "ID inválido" }),
      });

      const { id } = paramsSchema.parse(req.params);

      const layout = await prisma.layout.findUnique({
        where: { id },
      });

      if (!layout) {
        return res.status(404).json({ error: "Layout não encontrado" });
      }

      return res.json(layout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao buscar layout:", error);
      return res.status(500).json({
        error: "Erro ao buscar layout",
        details: error.message,
      });
    }
  }

  /**
   * Cria um novo layout 3D
   */
  async create(req: Request, res: Response) {
    try {
      const bodySchema = z.object({
        item_id: z.string().uuid({ message: "item_id inválido" }),
        name: z.string().min(1, "Nome é obrigatório"),
        layout_data: z.object({
          model_url: z.string().url("URL do modelo 3D é obrigatória"),
          print_areas: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                position: z.object({
                  x: z.number(),
                  y: z.number(),
                  z: z.number(),
                }),
                rotation: z.object({
                  x: z.number(),
                  y: z.number(),
                  z: z.number(),
                }),
                scale: z.object({
                  width: z.number(),
                  height: z.number(),
                }),
              })
            )
            .optional(),
          camera_position: z
            .object({
              x: z.number(),
              y: z.number(),
              z: z.number(),
            })
            .optional(),
          camera_target: z
            .object({
              x: z.number(),
              y: z.number(),
              z: z.number(),
            })
            .optional(),
        }),
      });

      const payload = bodySchema.parse(req.body);

      // Verificar se o item existe
      const item = await prisma.item.findUnique({
        where: { id: payload.item_id },
      });

      if (!item) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const layout = await prisma.layout.create({
        data: {
          item_id: payload.item_id,
          name: payload.name,
          image_url: payload.layout_data.model_url, // Preview image (pode ser screenshot do modelo)
          layout_data: payload.layout_data,
        },
      });

      return res.status(201).json(layout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao criar layout:", error);
      return res.status(500).json({
        error: "Erro ao criar layout",
        details: error.message,
      });
    }
  }

  /**
   * Atualiza um layout existente
   */
  async update(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid({ message: "ID inválido" }),
      });

      const bodySchema = z.object({
        name: z.string().min(1).optional(),
        layout_data: z
          .object({
            model_url: z.string().url().optional(),
            print_areas: z
              .array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  position: z.object({
                    x: z.number(),
                    y: z.number(),
                    z: z.number(),
                  }),
                  rotation: z.object({
                    x: z.number(),
                    y: z.number(),
                    z: z.number(),
                  }),
                  scale: z.object({
                    width: z.number(),
                    height: z.number(),
                  }),
                })
              )
              .optional(),
            camera_position: z
              .object({
                x: z.number(),
                y: z.number(),
                z: z.number(),
              })
              .optional(),
            camera_target: z
              .object({
                x: z.number(),
                y: z.number(),
                z: z.number(),
              })
              .optional(),
          })
          .optional(),
      });

      const { id } = paramsSchema.parse(req.params);
      const payload = bodySchema.parse(req.body);

      const existing = await prisma.layout.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Layout não encontrado" });
      }

      const layout = await prisma.layout.update({
        where: { id },
        data: {
          name: payload.name,
          image_url: payload.layout_data?.model_url,
          layout_data: payload.layout_data,
        },
      });

      return res.json(layout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Dados inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao atualizar layout:", error);
      return res.status(500).json({
        error: "Erro ao atualizar layout",
        details: error.message,
      });
    }
  }

  /**
   * Remove um layout
   */
  async remove(req: Request, res: Response) {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid({ message: "ID inválido" }),
      });

      const { id } = paramsSchema.parse(req.params);

      const layout = await prisma.layout.findUnique({
        where: { id },
      });

      if (!layout) {
        return res.status(404).json({ error: "Layout não encontrado" });
      }

      // Deletar arquivo 3D se existir localmente
      const layoutData = layout.layout_data as any;
      if (layoutData?.model_url && !layoutData.model_url.startsWith("http")) {
        const modelPath = path.join(__dirname, "../../", layoutData.model_url);
        if (fs.existsSync(modelPath)) {
          fs.unlinkSync(modelPath);
        }
      }

      await prisma.layout.delete({
        where: { id },
      });

      return res.status(204).send();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Parâmetros inválidos",
          details: error.issues,
        });
      }

      console.error("Erro ao remover layout:", error);
      return res.status(500).json({
        error: "Erro ao remover layout",
        details: error.message,
      });
    }
  }

  /**
   * Upload de arquivo 3D (.glb, .gltf)
   */
  async upload3DModel(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo não fornecido" });
      }

      const allowedExtensions = [".glb", ".gltf"];
      const fileExtension = path.extname(req.file.originalname).toLowerCase();

      if (!allowedExtensions.includes(fileExtension)) {
        // Remover arquivo se não for válido
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error:
            "Formato de arquivo inválido. Apenas .glb e .gltf são permitidos",
        });
      }

      const modelUrl = `/3d-models/${req.file.filename}`;

      return res.json({
        success: true,
        url: modelUrl,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (error: any) {
      console.error("Erro ao fazer upload do modelo 3D:", error);
      return res.status(500).json({
        error: "Erro ao fazer upload do modelo 3D",
        details: error.message,
      });
    }
  }
}

export default new LayoutController();
