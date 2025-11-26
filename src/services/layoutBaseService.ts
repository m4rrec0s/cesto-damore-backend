import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";

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

interface CreateLayoutBaseInput {
  name: string;
  item_type: string;
  image_url: string;
  width: number;
  height: number;
  slots: SlotDef[];
  additional_time?: number;
}

interface UpdateLayoutBaseInput {
  name?: string;
  image_url?: string;
  width?: number;
  height?: number;
  slots?: SlotDef[];
  additional_time?: number;
}

class LayoutBaseService {
  /**
   * Criar novo layout base
   */
  async create(data: CreateLayoutBaseInput) {
    // Validar slots
    this.validateSlots(data.slots);

    const layoutBase = await prisma.layoutBase.create({
      data: {
        name: data.name,
        item_type: data.item_type,
        image_url: data.image_url,
        width: data.width,
        height: data.height,
        slots: data.slots as any,
        additional_time: data.additional_time || 0,
      },
    });

    return layoutBase;
  }

  /**
   * Buscar layout por ID
   */
  async getById(id: string) {
    const layoutBase = await prisma.layoutBase.findUnique({
      where: { id },
    });

    if (!layoutBase) {
      throw new Error("Layout base não encontrado");
    }

    return layoutBase;
  }

  /**
   * Listar layouts
   */
  async list(itemType?: string) {
    const where = itemType ? { item_type: itemType } : {};

    const layouts = await prisma.layoutBase.findMany({
      where,
      orderBy: { created_at: "desc" },
    });

    return layouts;
  }

  /**
   * Atualizar layout base
   */
  async update(id: string, data: UpdateLayoutBaseInput) {
    // Verificar se existe
    await this.getById(id);

    // Validar slots se fornecidos
    if (data.slots) {
      this.validateSlots(data.slots);
    }

    const updateData: Record<string, unknown> = {};

    if (data.name) updateData.name = data.name;
    if (data.image_url) updateData.image_url = data.image_url;
    if (data.width) updateData.width = data.width;
    if (data.height) updateData.height = data.height;
    if (data.slots) updateData.slots = data.slots;
    if (data.additional_time !== undefined) updateData.additional_time = data.additional_time;

    const updated = await prisma.layoutBase.update({
      where: { id },
      data: updateData,
    });

    return updated;
  }

  /**
   * Deletar layout base
   */
  async delete(id: string) {
    const layoutBase = await this.getById(id);

    // Verificar se há itens que referenciam este layout como layout_base
    const itemsUsingLayoutCount = await prisma.item.count({
      where: { layout_base_id: id },
    });

    if (itemsUsingLayoutCount > 0) {
      throw new Error(
        `Não é possível deletar. Este layout está vinculado a ${itemsUsingLayoutCount} item(s). Atualize ou remova o vínculo antes de deletar.`
      );
    }

    // Verificar se existem Customizations (definições) cujo customization_data referenciam este layout
    // Observação: customization_data é JSON livre - fazemos uma busca textual para evitar referenciar tabela legada
    const customizationCountResult: Array<{ count: string }> =
      await prisma.$queryRaw`
      SELECT COUNT(*) FROM "Customization" WHERE customization_data::text LIKE ${
        "%" + id + "%"
      }
    `;
    const customizationCount = Number(
      customizationCountResult?.[0]?.count || 0
    );
    if (customizationCount > 0) {
      throw new Error(
        `Não é possível deletar. Este layout é usado em ${customizationCount} customização(ões). Atualize a customização antes de deletar.`
      );
    }

    // Deletar arquivo físico se existir
    if (layoutBase.image_url) {
      const imagePath = path.join(
        process.cwd(),
        "public",
        layoutBase.image_url.replace(/^\//, "")
      );

      try {
        await fs.unlink(imagePath);
      } catch (error) {
        console.warn(`Erro ao deletar arquivo físico: ${imagePath}`, error);
      }
    }

    // Deletar do banco
    await prisma.layoutBase.delete({
      where: { id },
    });

    return { message: "Layout base deletado com sucesso" };
  }

  /**
   * Validar estrutura dos slots
   */
  private validateSlots(slots: SlotDef[]) {
    // Slots são opcionais - permitir array vazio
    if (!Array.isArray(slots)) {
      throw new Error("Slots devem ser um array (pode ser vazio)");
    }

    // Se não houver slots, retornar (sem erros)
    if (slots.length === 0) {
      return;
    }

    for (const slot of slots) {
      // Validar campos obrigatórios
      if (!slot.id || typeof slot.id !== "string") {
        throw new Error("Cada slot deve ter um 'id' string");
      }

      // Validar percentuais (0-100)
      if (typeof slot.x !== "number" || slot.x < 0 || slot.x > 100) {
        throw new Error(
          `Slot '${slot.id}': 'x' deve ser um número entre 0 e 100`
        );
      }

      if (typeof slot.y !== "number" || slot.y < 0 || slot.y > 100) {
        throw new Error(
          `Slot '${slot.id}': 'y' deve ser um número entre 0 e 100`
        );
      }

      if (
        typeof slot.width !== "number" ||
        slot.width <= 0 ||
        slot.width > 100
      ) {
        throw new Error(
          `Slot '${slot.id}': 'width' deve ser um número entre 0 e 100`
        );
      }

      if (
        typeof slot.height !== "number" ||
        slot.height <= 0 ||
        slot.height > 100
      ) {
        throw new Error(
          `Slot '${slot.id}': 'height' deve ser um número entre 0 e 100`
        );
      }

      // Validar fit se fornecido
      if (slot.fit && !["cover", "contain"].includes(slot.fit)) {
        throw new Error(
          `Slot '${slot.id}': 'fit' deve ser 'cover' ou 'contain'`
        );
      }

      // Validar rotation se fornecido
      if (slot.rotation !== undefined && typeof slot.rotation !== "number") {
        throw new Error(`Slot '${slot.id}': 'rotation' deve ser um número`);
      }

      // Validar zIndex se fornecido
      if (slot.zIndex !== undefined && typeof slot.zIndex !== "number") {
        throw new Error(`Slot '${slot.id}': 'zIndex' deve ser um número`);
      }
    }

    // Validar IDs únicos
    const ids = slots.map((s) => s.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new Error("IDs dos slots devem ser únicos");
    }
  }
}

export default new LayoutBaseService();
