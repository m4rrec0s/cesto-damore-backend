export interface FabricCanvasState {
  objects: unknown[];
  backgroundColor?: string;
  backgroundImage?: unknown;
  version?: string;
}

export interface DynamicLayoutPage {
  id: string;
  name: string;
  order: number;
  canvasState: FabricCanvasState;
  thumbnailDataUrl?: string;
}

export interface DynamicLayoutPagesState {
  pages: DynamicLayoutPage[];
  activePageIndex: number;
}

export function extractPages(fabricJsonState: any): DynamicLayoutPage[] {
  if (!fabricJsonState) return [];

  if (Array.isArray(fabricJsonState.pages)) {
    return fabricJsonState.pages;
  }

  return [
    {
      id: "page_1",
      name: "Página 1",
      order: 0,
      canvasState: fabricJsonState,
    },
  ];
}

export function isMultiPageState(fabricJsonState: any): boolean {
  return Array.isArray(fabricJsonState?.pages);
}
