"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../database/prisma"));
const MODELS_DIR = path_1.default.join(process.cwd(), "customizations", "models");
const CUSTOMIZATION_IMAGES_DIR = path_1.default.join(process.cwd(), "images", "customizations");
const ensureDirExists = (dir) => {
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
};
const sanitizeFilename = (filename) => filename.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
const formatPrintArea = (area) => ({
    id: area.id ?? (0, crypto_1.randomUUID)(),
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
const cloneAsJson = (value) => {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
};
const formatLayoutResponse = (layout) => {
    const data = (layout.layout_data ?? {});
    const metadata = (data.metadata ?? {});
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
    async listLayouts(itemId) {
        const layouts = await prisma_1.default.layout.findMany({
            where: { item_id: itemId },
            orderBy: { created_at: "asc" },
        });
        return layouts.map(formatLayoutResponse);
    }
    async createLayout(itemId, payload) {
        if (!payload.name?.trim()) {
            throw new Error("Nome do layout é obrigatório");
        }
        const data = await this.prepareLayoutData(itemId, payload);
        const layoutName = payload.name.trim();
        const rawMetadataDescription = payload.metadata?.["description"];
        const metadataDescription = typeof rawMetadataDescription === "string"
            ? rawMetadataDescription
            : null;
        const metadata = {
            ...(payload.metadata ?? {}),
            description: payload.description?.trim() ?? metadataDescription,
        };
        const layoutJson = {
            modelUrl: data.modelUrl,
            printAreas: cloneAsJson(data.printAreas),
            metadata: cloneAsJson(metadata),
            createdAt: new Date().toISOString(),
        };
        const created = await prisma_1.default.layout.create({
            data: {
                item_id: itemId,
                name: layoutName,
                image_url: data.previewUrl ?? "",
                layout_data: layoutJson,
            },
        });
        return formatLayoutResponse(created);
    }
    async updateLayout(itemId, layoutId, payload) {
        const layout = await prisma_1.default.layout.findFirst({
            where: { id: layoutId, item_id: itemId },
        });
        if (!layout) {
            throw new Error("Layout não encontrado");
        }
        const data = await this.prepareLayoutData(itemId, payload, layout);
        const existingData = (layout.layout_data ?? {});
        const existingMetadata = (existingData.metadata ?? {});
        const rawMetadataDescription = payload.metadata?.["description"];
        const metadataDescription = typeof rawMetadataDescription === "string"
            ? rawMetadataDescription
            : null;
        const metadata = {
            ...existingMetadata,
            ...(payload.metadata ?? {}),
            description: payload.description?.trim() ??
                metadataDescription ??
                (typeof existingMetadata["description"] === "string"
                    ? existingMetadata["description"]
                    : null),
        };
        const layoutJson = {
            ...existingData,
            modelUrl: data.modelUrl ??
                (typeof existingData.modelUrl === "string"
                    ? existingData.modelUrl
                    : null),
            printAreas: cloneAsJson((data.printAreas?.length ? data.printAreas : existingData.printAreas) ??
                []),
            metadata: cloneAsJson(metadata),
            updatedAt: new Date().toISOString(),
        };
        const updated = await prisma_1.default.layout.update({
            where: { id: layoutId },
            data: {
                name: payload.name?.trim() ?? layout.name,
                image_url: data.previewUrl ?? layout.image_url ?? "",
                layout_data: layoutJson,
            },
        });
        return formatLayoutResponse(updated);
    }
    async deleteLayout(itemId, layoutId) {
        const layout = await prisma_1.default.layout.findFirst({
            where: { id: layoutId, item_id: itemId },
        });
        if (!layout) {
            throw new Error("Layout não encontrado");
        }
        const data = (layout.layout_data ?? {});
        if (layout.image_url) {
            this.safeDeleteFile(path_1.default.join(CUSTOMIZATION_IMAGES_DIR, layout.image_url.split("/").pop()));
        }
        if (data.modelUrl) {
            this.safeDeleteFile(path_1.default.join(MODELS_DIR, data.modelUrl.split("/").pop()));
        }
        await prisma_1.default.layout.delete({ where: { id: layoutId } });
        return { success: true };
    }
    async prepareLayoutData(itemId, payload, currentLayout) {
        let sourcePrintAreas = payload.printAreas ?? [];
        if (!sourcePrintAreas.length && currentLayout) {
            const existingData = (currentLayout.layout_data ?? {});
            sourcePrintAreas =
                cloneAsJson(existingData.printAreas) ?? [];
        }
        if (!sourcePrintAreas.length) {
            throw new Error("Defina ao menos uma área de impressão");
        }
        const printAreas = sourcePrintAreas.map(formatPrintArea);
        const existingModelUrl = currentLayout &&
            typeof currentLayout.layout_data?.modelUrl === "string"
            ? currentLayout.layout_data.modelUrl
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
    persistModelFile(file, itemId) {
        ensureDirExists(MODELS_DIR);
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (![".glb", ".gltf"].includes(ext)) {
            throw new Error("Apenas arquivos .glb ou .gltf são suportados");
        }
        const filename = `${Date.now()}-${itemId}-${sanitizeFilename(file.originalname)}`;
        const filepath = path_1.default.join(MODELS_DIR, filename);
        fs_1.default.writeFileSync(filepath, file.buffer);
        return `/customizations/models/${filename}`;
    }
    persistPreviewImage(file, itemId) {
        ensureDirExists(CUSTOMIZATION_IMAGES_DIR);
        const filename = `${Date.now()}-${itemId}-${sanitizeFilename(file.originalname)}`;
        const filepath = path_1.default.join(CUSTOMIZATION_IMAGES_DIR, filename);
        fs_1.default.writeFileSync(filepath, file.buffer);
        return `/images/customizations/${filename}`;
    }
    safeDeleteFile(filepath) {
        try {
            if (filepath && fs_1.default.existsSync(filepath)) {
                fs_1.default.unlinkSync(filepath);
            }
        }
        catch (error) {
            console.warn("Não foi possível remover arquivo de layout:", error);
        }
    }
}
exports.default = new LayoutService();
