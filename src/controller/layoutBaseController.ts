import { Request, Response } from "express";
import layoutBaseService from "../services/layoutBaseService";
import googleDriveService from "../services/googleDriveService";

const DRIVE_FOLDERS = {
  CANECA: process.env.GOOGLE_DRIVE_CUP_FOLDER_ID!,
  QUADRO: process.env.GOOGLE_DRIVE_FRAME_FOLDER_ID!,
};

class LayoutBaseController {
  async create(req: Request, res: Response) {
    try {
      const { name, item_type, width, height, slots } = req.body;

      // Validar campos obrigatórios
      if (!name || !item_type || !width || !height) {
        return res.status(400).json({
          error: "Campos obrigatórios: name, item_type, width, height",
        });
      }

      // Validar tipo de item
      if (!["CANECA", "QUADRO"].includes(item_type)) {
        return res.status(400).json({
          error: "Tipo de item inválido. Valores permitidos: CANECA, QUADRO",
        });
      }

      // Validar se tem arquivo
      if (!req.file) {
        return res.status(400).json({
          error: "Imagem do layout é obrigatória",
        });
      }

      // Selecionar pasta do Google Drive baseada no tipo
      const folderId = DRIVE_FOLDERS[item_type as keyof typeof DRIVE_FOLDERS];

      // Gerar nome único mantendo a extensão original
      const timestamp = Date.now();
      const randomSuffix = Math.round(Math.random() * 1e9);
      const originalExt = req.file.originalname.split(".").pop();
      const fileName = `layout-${timestamp}-${randomSuffix}.${originalExt}`;

      const uploadedFile = await googleDriveService.uploadBuffer(
        req.file.buffer,
        fileName,
        folderId,
        req.file.mimetype
      );

      const image_url = uploadedFile.webViewLink;

      const parsedSlots = slots ? JSON.parse(slots) : [];

      const layoutBase = await layoutBaseService.create({
        name,
        item_type,
        image_url,
        width: parseInt(width),
        height: parseInt(height),
        slots: parsedSlots,
      });

      return res.status(201).json(layoutBase);
    } catch (error) {
      console.error("Erro ao criar layout base:", error);
      return res.status(400).json({
        error:
          error instanceof Error ? error.message : "Erro ao criar layout base",
      });
    }
  }

  async list(req: Request, res: Response) {
    try {
      const { item_type } = req.query;

      const layouts = await layoutBaseService.list(item_type as string);

      return res.json(layouts);
    } catch (error) {
      console.error("Erro ao listar layouts:", error);
      return res.status(500).json({
        error: "Erro ao listar layouts",
      });
    }
  }

  async show(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const layoutBase = await layoutBaseService.getById(id);

      return res.json(layoutBase);
    } catch (error) {
      console.error("Erro ao buscar layout:", error);
      return res.status(404).json({
        error: error instanceof Error ? error.message : "Layout não encontrado",
      });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, item_type, width, height, slots } = req.body;

      const updateData: {
        name?: string;
        image_url?: string;
        width?: number;
        height?: number;
        slots?: any;
      } = {};

      if (name) updateData.name = name;
      if (width) updateData.width = parseInt(width);
      if (height) updateData.height = parseInt(height);
      if (slots) updateData.slots = JSON.parse(slots);

      if (req.file && item_type) {
        if (!["CANECA", "QUADRO"].includes(item_type)) {
          return res.status(400).json({
            error: "Tipo de item inválido. Valores permitidos: CANECA, QUADRO",
          });
        }

        const folderId = DRIVE_FOLDERS[item_type as keyof typeof DRIVE_FOLDERS];

        const timestamp = Date.now();
        const randomSuffix = Math.round(Math.random() * 1e9);
        const originalExt = req.file.originalname.split(".").pop();
        const fileName = `layout-${timestamp}-${randomSuffix}.${originalExt}`;

        const uploadedFile = await googleDriveService.uploadBuffer(
          req.file.buffer,
          fileName,
          folderId,
          req.file.mimetype
        );

        updateData.image_url = uploadedFile.webViewLink;
      }

      const updated = await layoutBaseService.update(id, updateData);

      return res.json(updated);
    } catch (error) {
      console.error("Erro ao atualizar layout:", error);
      return res.status(400).json({
        error:
          error instanceof Error ? error.message : "Erro ao atualizar layout",
      });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const result = await layoutBaseService.delete(id);

      return res.json(result);
    } catch (error) {
      console.error("Erro ao deletar layout:", error);
      return res.status(400).json({
        error:
          error instanceof Error ? error.message : "Erro ao deletar layout",
      });
    }
  }
}

export default new LayoutBaseController();
