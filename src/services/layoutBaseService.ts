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
  

  async create(data: CreateLayoutBaseInput) {

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

  

  async getById(id: string) {

    const dynamicLayout = await prisma.dynamicLayout.findUnique({
      where: { id },
    });

    if (dynamicLayout) {

      return {
        id: dynamicLayout.id,
        name: dynamicLayout.name,
        item_type: this.mapDynamicType(dynamicLayout.type),
        image_url: dynamicLayout.baseImageUrl,
        width: dynamicLayout.width,
        height: dynamicLayout.height,
        slots: [],
        fabric_json_state: dynamicLayout.fabricJsonState,
        additional_time: 0,
        is_dynamic: true,
        created_at: dynamicLayout.createdAt,
        updated_at: dynamicLayout.updatedAt,
      };
    }

    const layoutBase = await prisma.layoutBase.findUnique({
      where: { id },
    });

    if (layoutBase) {
      return {
        ...layoutBase,
        is_dynamic: false,
      };
    }

    throw new Error("Layout base não encontrado");
  }

  

  private mapDynamicType(type: string): string {
    const mapping: Record<string, string> = {
      mug: "CANECA",
      frame: "QUADRO",
      puzzle: "QUEBRA_CABECA",
      custom: "OUTROS",
    };
    return mapping[type.toLowerCase()] || type.toUpperCase();
  }

  

  private mapReverseType(itemType: string): string {
    const mapping: Record<string, string> = {
      CANECA: "mug",
      QUADRO: "frame",
      QUEBRA_CABECA: "puzzle",
      OUTROS: "custom",
    };
    return mapping[itemType.toUpperCase()] || itemType.toLowerCase();
  }

  

  async list(itemType?: string) {

    const dynamicLayouts = await prisma.dynamicLayout.findMany({
      where: {
        ...(itemType ? { type: this.mapReverseType(itemType) } : {}),
        isPublished: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const mappedDynamic = dynamicLayouts.map((dl) => ({
      id: dl.id,
      name: dl.name,
      item_type: this.mapDynamicType(dl.type),
      image_url: dl.baseImageUrl,
      width: dl.width,
      height: dl.height,
      slots: [],
      fabric_json_state: dl.fabricJsonState,
      additional_time: 0,
      is_dynamic: true,
      created_at: dl.createdAt,
      updated_at: dl.updatedAt,
    }));

    const legacyLayouts = await prisma.layoutBase.findMany({
      where: itemType ? { item_type: itemType } : {},
      orderBy: { created_at: "desc" },
    });

    const mappedLegacy = legacyLayouts.map((lb) => ({
      ...lb,
      is_dynamic: false,
    }));

    return [...mappedDynamic, ...mappedLegacy];
  }

  

  async update(id: string, data: UpdateLayoutBaseInput) {

    await this.getById(id);

    if (data.slots) {
      this.validateSlots(data.slots);
    }

    const updateData: Record<string, unknown> = {};

    if (data.name) updateData.name = data.name;
    if (data.image_url) updateData.image_url = data.image_url;
    if (data.width) updateData.width = data.width;
    if (data.height) updateData.height = data.height;
    if (data.slots) updateData.slots = data.slots;
    if (data.additional_time !== undefined)
      updateData.additional_time = data.additional_time;

    const updated = await prisma.layoutBase.update({
      where: { id },
      data: updateData,
    });

    return updated;
  }

  

  async delete(id: string) {
    const layoutBase = await this.getById(id);

    const itemsUsingLayoutCount = await prisma.item.count({
      where: { layout_base_id: id },
    });

    if (itemsUsingLayoutCount > 0) {
      throw new Error(
        `Não é possível deletar. Este layout está vinculado a ${itemsUsingLayoutCount} item(s). Atualize ou remova o vínculo antes de deletar.`,
      );
    }

    const customizationCountResult: Array<{ count: string }> =
      await prisma.$queryRaw`
      SELECT COUNT(*) FROM "Customization" WHERE customization_data::text LIKE ${"%" + id + "%"
        }
    `;
    const customizationCount = Number(
      customizationCountResult?.[0]?.count || 0,
    );
    if (customizationCount > 0) {
      throw new Error(
        `Não é possível deletar. Este layout é usado em ${customizationCount} customização(ões). Atualize a customização antes de deletar.`,
      );
    }

    if (layoutBase.image_url) {
      const imagePath = path.join(
        process.cwd(),
        "public",
        layoutBase.image_url.replace(/^\//, ""),
      );

      try {
        await fs.unlink(imagePath);
      } catch (error) {
        console.warn(`Erro ao deletar arquivo físico: ${imagePath}`, error);
      }
    }

    await prisma.layoutBase.delete({
      where: { id },
    });

    return { message: "Layout base deletado com sucesso" };
  }

  

  private validateSlots(slots: SlotDef[]) {

    if (!Array.isArray(slots)) {
      throw new Error("Slots devem ser um array (pode ser vazio)");
    }

    if (slots.length === 0) {
      return;
    }

    for (const slot of slots) {

      if (!slot.id || typeof slot.id !== "string") {
        throw new Error("Cada slot deve ter um 'id' string");
      }

      if (typeof slot.x !== "number" || slot.x < 0 || slot.x > 100) {
        throw new Error(
          `Slot '${slot.id}': 'x' deve ser um número entre 0 e 100`,
        );
      }

      if (typeof slot.y !== "number" || slot.y < 0 || slot.y > 100) {
        throw new Error(
          `Slot '${slot.id}': 'y' deve ser um número entre 0 e 100`,
        );
      }

      if (
        typeof slot.width !== "number" ||
        slot.width <= 0 ||
        slot.width > 100
      ) {
        throw new Error(
          `Slot '${slot.id}': 'width' deve ser um número entre 0 e 100`,
        );
      }

      if (
        typeof slot.height !== "number" ||
        slot.height <= 0 ||
        slot.height > 100
      ) {
        throw new Error(
          `Slot '${slot.id}': 'height' deve ser um número entre 0 e 100`,
        );
      }

      if (slot.fit && !["cover", "contain"].includes(slot.fit)) {
        throw new Error(
          `Slot '${slot.id}': 'fit' deve ser 'cover' ou 'contain'`,
        );
      }

      if (slot.rotation !== undefined && typeof slot.rotation !== "number") {
        throw new Error(`Slot '${slot.id}': 'rotation' deve ser um número`);
      }

      if (slot.zIndex !== undefined && typeof slot.zIndex !== "number") {
        throw new Error(`Slot '${slot.id}': 'zIndex' deve ser um número`);
      }
    }

    const ids = slots.map((s) => s.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new Error("IDs dos slots devem ser únicos");
    }
  }
}

export default new LayoutBaseService();
