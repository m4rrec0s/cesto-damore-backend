import { extractPages, isMultiPageState } from "../types/dynamicLayout";

export interface DynamicLayoutSlot {
  id: string;
  label: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  };
  required: boolean;
  pageId?: string;
  pageIndex?: number;
}

function getObjects(fabricJsonState: unknown): any[] {
  const state =
    typeof fabricJsonState === "string"
      ? JSON.parse(fabricJsonState)
      : fabricJsonState;

  return Array.isArray((state as any)?.objects) ? (state as any).objects : [];
}

function isImageFrame(obj: any): boolean {
  const name = String(obj?.name || "").toLowerCase();
  return (
    obj?.isFrame === true ||
    obj?.customData?.isFrame === true ||
    name === "photo-frame" ||
    name === "image-frame" ||
    name.includes("frame")
  );
}

function objectsToSlots(objects: any[]): DynamicLayoutSlot[] {
  return objects
    .filter(isImageFrame)
    .map((obj, index) => {
      const id = String(obj.id || obj.name || `slot_${index + 1}`);
      const width = Number(obj.width || 0) * Number(obj.scaleX || 1);
      const height = Number(obj.height || 0) * Number(obj.scaleY || 1);

      return {
        id,
        label:
          typeof obj.label === "string" && obj.label.trim()
            ? obj.label.trim()
            : `Foto ${index + 1}`,
        position: {
          x: Number(obj.left || 0),
          y: Number(obj.top || 0),
          width,
          height,
          rotation: Number(obj.angle || 0),
        },
        required: obj.required !== false,
      };
    });
}

export function extractDynamicLayoutSlots(
  state: unknown,
): DynamicLayoutSlot[];
export function extractDynamicLayoutSlots(
  state: unknown,
  pageIndex: number,
): DynamicLayoutSlot[];
export function extractDynamicLayoutSlots(
  state: unknown,
  pageIndex?: number,
): DynamicLayoutSlot[] {
  if (!isMultiPageState(state)) {
    return objectsToSlots(getObjects(state));
  }

  const pages = extractPages(state);

  if (pageIndex !== undefined) {
    return objectsToSlots(getObjects(pages[pageIndex]?.canvasState));
  }

  return pages.flatMap((page, pIdx) =>
    objectsToSlots(getObjects(page.canvasState)).map((slot) => ({
      ...slot,
      pageId: page.id,
      pageIndex: pIdx,
      label: `P${pIdx + 1} - ${slot.label}`,
    })),
  );
}
