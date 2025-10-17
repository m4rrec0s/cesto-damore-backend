import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../database/prisma";

interface PrintAreaInput {
  id?: string;
  label: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  z?: number;
  rotation?: number;
  mapping?: string;
  metadata?: Record<string, unknown>;
}

interface LayoutPayload {
  name?: string;
  printAreas?: PrintAreaInput[];
  description?: string;
  metadata?: Record<string, unknown>;
  modelFile?: Express.Multer.File;
  previewImage?: Express.Multer.File;
}

const MODELS_DIR = path.join(process.cwd(), "customizations", "models");
const CUSTOMIZATION_IMAGES_DIR = path.join(
  process.cwd(),
  "images",
  "customizations"
);

const ensureDirExists = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const sanitizeFilename = (filename: string) =>
  filename.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();

const formatPrintArea = (area: PrintAreaInput) => ({
  id: area.id ?? randomUUID(),
  label: area.label,
  width: Number(area.width),
  height: Number(area.height),
  x: Number(area.x ?? 0),
  y: Number(area.y ?? 0),
  z: Number(area.z ?? 0),
  rotation: Number(area.rotation ?? 0),
  mapping: area.mapping ?? "cylindrical",
  metadata: area.metadata ?? {},
});

const cloneAsJson = <T>(value: T) => {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as unknown;
};

const formatLayoutResponse = (layout: any) => {
  const data = (layout.layout_data ?? {}) as Record<string, any>;
  const metadata = (data.metadata ?? {}) as Record<string, any>;

  return {
    id: layout.id,
    item_id: layout.item_id,
    name: layout.name,
    description: metadata.description ?? null,
    image_url: layout.image_url ?? null,
    model_url: data.modelUrl ?? null,
    print_areas: data.printAreas ?? [],
    metadata,
    created_at: layout.created_at,
    updated_at: layout.updated_at,
  };
};

class LayoutService {
  async listLayouts(itemId: string) {
    const layouts = await prisma.layout.findMany({
      where: { item_id: itemId },
      orderBy: { created_at: "asc" },
    });

    return layouts.map(formatLayoutResponse);
  }

  async createLayout(itemId: string, payload: LayoutPayload) {
    if (!payload.name?.trim()) {
      throw new Error("Nome do layout é obrigatório");
    }

    const data = await this.prepareLayoutData(itemId, payload);
    const layoutName = payload.name.trim();

    const rawMetadataDescription = payload.metadata?.["description"];
    const metadataDescription =
      typeof rawMetadataDescription === "string"
        ? rawMetadataDescription
        : null;
    const metadata = {
      ...(payload.metadata ?? {}),
      description: payload.description?.trim() ?? metadataDescription,
    };

    const layoutJson = {
      modelUrl: data.modelUrl,
      printAreas: cloneAsJson(data.printAreas) as Prisma.JsonValue,
      metadata: cloneAsJson(metadata) as Prisma.JsonValue,
      createdAt: new Date().toISOString(),
    } as Prisma.JsonObject;

    const created = await prisma.layout.create({
      data: {
        item_id: itemId,
        name: layoutName,
        image_url: data.previewUrl ?? "",
        layout_data: layoutJson,
      },
    });

    return formatLayoutResponse(created);
  }

  async updateLayout(itemId: string, layoutId: string, payload: LayoutPayload) {
    const layout = await prisma.layout.findFirst({
      where: { id: layoutId, item_id: itemId },
    });

    if (!layout) {
      throw new Error("Layout não encontrado");
    }

    const data = await this.prepareLayoutData(itemId, payload, layout);

    const existingData = (layout.layout_data ?? {}) as Record<string, any>;
    const existingMetadata = (existingData.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const rawMetadataDescription = payload.metadata?.["description"];
    const metadataDescription =
      typeof rawMetadataDescription === "string"
        ? rawMetadataDescription
        : null;

    const metadata = {
      ...existingMetadata,
      ...(payload.metadata ?? {}),
      description:
        payload.description?.trim() ??
        metadataDescription ??
        (typeof existingMetadata["description"] === "string"
          ? (existingMetadata["description"] as string)
          : null),
    };

    const layoutJson: Prisma.JsonObject = {
      ...existingData,
      modelUrl:
        data.modelUrl ??
        (typeof existingData.modelUrl === "string"
          ? (existingData.modelUrl as string)
          : null),
      printAreas: cloneAsJson(
        (data.printAreas?.length ? data.printAreas : existingData.printAreas) ??
          []
      ) as Prisma.JsonValue,
      metadata: cloneAsJson(metadata) as Prisma.JsonValue,
      updatedAt: new Date().toISOString(),
    };

    const updated = await prisma.layout.update({
      where: { id: layoutId },
      data: {
        name: payload.name?.trim() ?? layout.name,
        image_url: data.previewUrl ?? layout.image_url ?? "",
        layout_data: layoutJson,
      },
    });

    return formatLayoutResponse(updated);
  }

  async deleteLayout(itemId: string, layoutId: string) {
    const layout = await prisma.layout.findFirst({
      where: { id: layoutId, item_id: itemId },
    });

    if (!layout) {
      throw new Error("Layout não encontrado");
    }

    const data = (layout.layout_data ?? {}) as Record<string, any>;

    if (layout.image_url) {
      this.safeDeleteFile(
        path.join(CUSTOMIZATION_IMAGES_DIR, layout.image_url.split("/").pop()!)
      );
    }

    if (data.modelUrl) {
      this.safeDeleteFile(
        path.join(MODELS_DIR, data.modelUrl.split("/").pop()!)
      );
    }

    await prisma.layout.delete({ where: { id: layoutId } });

    return { success: true };
  }

  private async prepareLayoutData(
    itemId: string,
    payload: LayoutPayload,
    currentLayout?: any
  ) {
    let sourcePrintAreas = payload.printAreas ?? [];

    if (!sourcePrintAreas.length && currentLayout) {
      const existingData = (currentLayout.layout_data ?? {}) as Record<
        string,
        any
      >;
      sourcePrintAreas =
        (cloneAsJson(existingData.printAreas) as PrintAreaInput[]) ?? [];
    }

    if (!sourcePrintAreas.length) {
      throw new Error("Defina ao menos uma área de impressão");
    }

    const printAreas = sourcePrintAreas.map(formatPrintArea);

    const existingModelUrl =
      currentLayout &&
      typeof (currentLayout.layout_data as any)?.modelUrl === "string"
        ? ((currentLayout.layout_data as any).modelUrl as string)
        : null;

    let modelUrl = existingModelUrl;
    if (payload.modelFile) {
      modelUrl = this.persistModelFile(payload.modelFile, itemId);
    }

    if (!modelUrl) {
      throw new Error("Arquivo do modelo 3D é obrigatório");
    }

    let previewUrl = currentLayout?.image_url ?? null;
    if (payload.previewImage) {
      previewUrl = this.persistPreviewImage(payload.previewImage, itemId);
    }

    return {
      printAreas,
      modelUrl,
      previewUrl,
    };
  }

  private persistModelFile(file: Express.Multer.File, itemId: string) {
    ensureDirExists(MODELS_DIR);

    const ext = path.extname(file.originalname).toLowerCase();
    if (![".glb", ".gltf"].includes(ext)) {
      throw new Error("Apenas arquivos .glb ou .gltf são suportados");
    }

    const filename = `${Date.now()}-${itemId}-${sanitizeFilename(
      file.originalname
    )}`;
    const filepath = path.join(MODELS_DIR, filename);
    fs.writeFileSync(filepath, file.buffer);

    return `/customizations/models/${filename}`;
  }

  private persistPreviewImage(file: Express.Multer.File, itemId: string) {
    ensureDirExists(CUSTOMIZATION_IMAGES_DIR);

    const filename = `${Date.now()}-${itemId}-${sanitizeFilename(
      file.originalname
    )}`;
    const filepath = path.join(CUSTOMIZATION_IMAGES_DIR, filename);
    fs.writeFileSync(filepath, file.buffer);

    return `/images/customizations/${filename}`;
  }

  private safeDeleteFile(filepath: string) {
    try {
      if (filepath && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (error) {
      console.warn("Não foi possível remover arquivo de layout:", error);
    }
  }
}

export default new LayoutService();
