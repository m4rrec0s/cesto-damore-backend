import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import imageCompositionService from "./imageCompositionService";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

interface SlotDef {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  fit?: "cover" | "contain";
}

interface ImageData {
  slotId: string;
  tempId: string; // ID do arquivo temporário
  tempUrl: string;
  width: number;
  height: number;
  originalName: string;
}

interface CommitPersonalizationInput {
  orderId: string;
  itemId: string;
  layoutBaseId: string;
  configJson: Record<string, unknown>; // cores, variações, metadata
  images: ImageData[];
}

class PersonalizationService {
  /**
   * Commit da personalização - gera imagem final e salva no Drive
   */
  async commitPersonalization(
    userId: string,
    data: CommitPersonalizationInput
  ) {
    // Verificar se o pedido pertence ao usuário
    const order = await prisma.order.findFirst({
      where: {
        id: data.orderId,
        user_id: userId,
      },
    });

    if (!order) {
      throw new Error("Pedido não encontrado ou não pertence ao usuário");
    }

    // Verificar se pedido permite personalização (status deve ser PENDING)
    if (order.status !== "PENDING") {
      throw new Error("Pedido não está em estado válido para personalização");
    }

    // Buscar layout base
    const layoutBase = await prisma.layoutBase.findUnique({
      where: { id: data.layoutBaseId },
    });

    if (!layoutBase) {
      throw new Error("Layout base não encontrado");
    }

    // Buscar item
    const item = await prisma.item.findUnique({
      where: { id: data.itemId },
    });

    if (!item) {
      throw new Error("Item não encontrado");
    }

    // Validar que o item permite customização
    if (!item.allows_customization) {
      throw new Error("Este item não permite personalização");
    }

    const slots = layoutBase.slots as unknown as SlotDef[];

    // Preparar imagens temporárias
    const imageSlots: Array<{ slotId: string; imagePath: string }> = [];

    for (const img of data.images) {
      // Buscar arquivo temporário
      const tempFile = await prisma.temporaryCustomizationFile.findUnique({
        where: { id: img.tempId },
      });

      if (!tempFile) {
        throw new Error(`Arquivo temporário não encontrado: ${img.tempId}`);
      }

      // Verificar se arquivo existe
      const tempFilePath = path.join(process.cwd(), tempFile.file_path);
      try {
        await fs.access(tempFilePath);
      } catch {
        throw new Error(`Arquivo temporário não existe: ${tempFile.file_path}`);
      }

      imageSlots.push({
        slotId: img.slotId,
        imagePath: tempFilePath,
      });
    }

    // Compor imagem final
    const baseImagePath = path.join(
      process.cwd(),
      "public",
      layoutBase.image_url.replace(/^\//, "")
    );

    const compositionResult = await imageCompositionService.composeImage(
      baseImagePath,
      layoutBase.width,
      layoutBase.height,
      slots,
      imageSlots
    );

    // Salvar PNG final em storage
    const finalFileName = `${data.orderId}_${data.itemId}_${Date.now()}.png`;
    const finalDir = path.join(
      process.cwd(),
      "storage",
      "orders",
      data.orderId,
      data.itemId
    );

    // Criar diretórios se não existirem
    await fs.mkdir(finalDir, { recursive: true });

    const finalFilePath = path.join(finalDir, finalFileName);
    await fs.writeFile(finalFilePath, compositionResult.buffer);

    // TODO: Upload para Google Drive (integrar com serviço existente)
    // const driveUrl = await DriveService.upload(data.orderId, finalFilePath, `${data.itemId}/${finalFileName}`);
    const driveUrl = null; // Temporário até integração com Drive

    // Salvar personalização no banco (transação)
    const personalization = await prisma.personalization.create({
      data: {
        order_id: data.orderId,
        item_id: data.itemId,
        layout_base_id: data.layoutBaseId,
        config_json: data.configJson as any,
        images: data.images as any,
        final_image_url:
          driveUrl ||
          `/storage/orders/${data.orderId}/${data.itemId}/${finalFileName}`,
      },
    });

    // Limpar arquivos temporários
    for (const img of data.images) {
      try {
        const tempFile = await prisma.temporaryCustomizationFile.findUnique({
          where: { id: img.tempId },
        });

        if (tempFile) {
          // Deletar arquivo físico
          const tempPath = path.join(process.cwd(), tempFile.file_path);
          await fs.unlink(tempPath).catch(() => {});

          // Deletar registro do banco
          await prisma.temporaryCustomizationFile.delete({
            where: { id: img.tempId },
          });
        }
      } catch (error) {
        console.warn(`Erro ao limpar arquivo temporário ${img.tempId}:`, error);
      }
    }

    return {
      personalizationId: personalization.id,
      finalImageUrl: personalization.final_image_url,
    };
  }

  /**
   * Buscar personalização por ID
   */
  async getById(id: string) {
    const personalization = await prisma.personalization.findUnique({
      where: { id },
      include: {
        order: true,
        item: true,
        layout_base: true,
      },
    });

    if (!personalization) {
      throw new Error("Personalização não encontrada");
    }

    return personalization;
  }

  /**
   * Listar personalizações de um pedido
   */
  async listByOrder(orderId: string, userId?: string) {
    // Se userId fornecido, validar que o pedido pertence ao usuário
    if (userId) {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          user_id: userId,
        },
      });

      if (!order) {
        throw new Error("Pedido não encontrado ou não pertence ao usuário");
      }
    }

    const personalizations = await prisma.personalization.findMany({
      where: { order_id: orderId },
      include: {
        item: true,
        layout_base: true,
      },
    });

    return personalizations;
  }

  /**
   * Gerar preview da composição (sem salvar)
   */
  async generatePreview(
    layoutBaseId: string,
    images: ImageData[],
    maxWidth: number = 800
  ) {
    const layoutBase = await prisma.layoutBase.findUnique({
      where: { id: layoutBaseId },
    });

    if (!layoutBase) {
      throw new Error("Layout base não encontrado");
    }

    const slots = layoutBase.slots as unknown as SlotDef[];

    // Preparar imagens
    const imageSlots: Array<{ slotId: string; imagePath: string }> = [];

    for (const img of images) {
      const tempFile = await prisma.temporaryCustomizationFile.findUnique({
        where: { id: img.tempId },
      });

      if (!tempFile) continue;

      const tempFilePath = path.join(process.cwd(), tempFile.file_path);
      try {
        await fs.access(tempFilePath);
        imageSlots.push({
          slotId: img.slotId,
          imagePath: tempFilePath,
        });
      } catch {
        continue;
      }
    }

    const baseImagePath = path.join(
      process.cwd(),
      "public",
      layoutBase.image_url.replace(/^\//, "")
    );

    const previewBuffer = await imageCompositionService.generatePreview(
      baseImagePath,
      layoutBase.width,
      layoutBase.height,
      slots,
      imageSlots,
      maxWidth
    );

    return previewBuffer;
  }
}

export default new PersonalizationService();
