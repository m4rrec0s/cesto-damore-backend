import { CustomizationType } from "@prisma/client";
import prisma from "../database/prisma";
import layoutBaseService from "./layoutBaseService";

interface CustomizationDTO {
  id: string;
  item_id: string;
  type: CustomizationType;
  name: string;
  description?: string | null;
  isRequired: boolean;
  customization_data: any;
  price: number;
}

export interface CustomizationInput {
  customization_id: string;
  customization_type: CustomizationType;
  data: Record<string, any>;
}

export interface PreviewPayload {
  layout?: any;
  photos: Array<{
    source: string;
    position?: any;
  }>;
  texts: Array<{
    value: string;
    position?: any;
  }>;
  metadata: Record<string, any>;
}

interface ItemCustomizationResponse {
  item: {
    id: string;
    name: string;
    allows_customization: boolean;
    layout_base_id?: string | null;
  };
  customizations: CustomizationDTO[];
}

class CustomizationService {
  /**
   * Busca customizações de um item
   */
  async getItemCustomizations(
    itemId: string
  ): Promise<ItemCustomizationResponse> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        customizations: {
          orderBy: { created_at: "asc" },
        },
      },
    });

    if (!item) {
      throw new Error("Item não encontrado");
    }

    return {
      item: {
        id: item.id,
        name: item.name,
        allows_customization: item.allows_customization,
        layout_base_id: item.layout_base_id,
      },
      customizations: item.customizations.map((c) => ({
        id: c.id,
        item_id: c.item_id,
        type: c.type,
        name: c.name,
        description: c.description,
        isRequired: c.isRequired,
        customization_data: c.customization_data,
        price: c.price,
      })),
    };
  }

  /**
   * Valida customizações de um item
   */
  async validateCustomizations(options: {
    itemId: string;
    inputs: CustomizationInput[];
  }): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const { itemId, inputs } = options;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Buscar item e suas customizações
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        customizations: true,
      },
    });

    if (!item) {
      return { valid: false, errors: ["Item não encontrado"], warnings };
    }

    if (!item.allows_customization) {
      return {
        valid: false,
        errors: ["Item não permite customização"],
        warnings,
      };
    }

    const customizationMap = new Map(
      item.customizations.map((c: any) => [c.id, c])
    );

    // Verificar customizações obrigatórias
    item.customizations
      .filter((c: any) => c.isRequired)
      .forEach((customization: any) => {
        const hasCustomization = inputs.some(
          (input) => input.customization_id === customization.id
        );

        if (!hasCustomization) {
          errors.push(
            `Customização obrigatória não preenchida: ${customization.name}`
          );
        }
      });

    // Validar cada input
    for (const input of inputs) {
      const customization = customizationMap.get(input.customization_id);

      if (!customization) {
        warnings.push(`Customização não encontrada: ${input.customization_id}`);
        continue;
      }

      // Validar por tipo
      this.validateByType(customization, input, errors);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Valida customização por tipo
   */
  private validateByType(
    customization: any,
    input: CustomizationInput,
    errors: string[]
  ) {
    const data = customization.customization_data;

    switch (customization.type) {
      case "DYNAMIC_LAYOUT":
        this.validateBaseLayout(customization, input, data, errors);
        break;

      case "TEXT":
        this.validateText(customization, input, data, errors);
        break;

      case "IMAGES":
        this.validateImages(customization, input, data, errors);
        break;

      case "MULTIPLE_CHOICE":
        this.validateMultipleChoice(customization, input, data, errors);
        break;

      default:
        errors.push(
          `Tipo de customização não suportado: ${customization.type}`
        );
    }
  }

  /**
   * Valida DYNAMIC_LAYOUT
   */
  private validateBaseLayout(
    customization: any,
    input: CustomizationInput,
    data: any,
    errors: string[]
  ) {
    if (!input.data.layout_id) {
      errors.push(`${customization.name}: Layout não selecionado`);
      return;
    }

    // Verificar se o layout existe nos layouts disponíveis
    const layouts = data?.layouts || [];
    const layoutExists = layouts.some(
      (l: any) => l.id === input.data.layout_id
    );

    if (!layoutExists) {
      errors.push(`${customization.name}: Layout inválido`);
    }
  }

  /**
   * Valida TEXT
   */
  private validateText(
    customization: any,
    input: CustomizationInput,
    data: any,
    errors: string[]
  ) {
    const fields = data?.fields || [];
    const providedFields = input.data.fields || [];

    // Verificar campos obrigatórios
    fields
      .filter((f: any) => f.required)
      .forEach((field: any) => {
        const providedField = providedFields.find(
          (pf: any) => pf.field_id === field.id
        );

        if (!providedField || !providedField.value) {
          errors.push(
            `${customization.name}: Campo "${field.label}" é obrigatório`
          );
        }
      });

    // Validar limites de caracteres
    providedFields.forEach((providedField: any) => {
      const field = fields.find((f: any) => f.id === providedField.field_id);

      if (field && field.max_length) {
        if (
          providedField.value &&
          providedField.value.length > field.max_length
        ) {
          errors.push(
            `${customization.name}: Campo "${field.label}" excede limite de ${field.max_length} caracteres`
          );
        }
      }
    });
  }

  /**
   * Valida IMAGES
   */
  private validateImages(
    customization: any,
    input: CustomizationInput,
    data: any,
    errors: string[]
  ) {
    if (!input.data.DYNAMIC_LAYOUT_id) {
      errors.push(`${customization.name}: Layout base não selecionado`);
      return;
    }

    const baseLayout = data?.DYNAMIC_LAYOUT;
    if (!baseLayout) {
      errors.push(`${customization.name}: Layout base não configurado`);
      return;
    }

    const images = input.data.images || [];
    const maxImages = baseLayout.max_images || 10;

    if (images.length > maxImages) {
      errors.push(
        `${customization.name}: Máximo de ${maxImages} imagens permitidas`
      );
    }

    // Validar posições das imagens
    images.forEach((image: any, index: number) => {
      if (!image.source) {
        errors.push(`${customization.name}: Imagem ${index + 1} sem fonte`);
      }

      if (image.slot === undefined) {
        errors.push(
          `${customization.name}: Imagem ${index + 1} sem slot definido`
        );
      }
    });
  }

  /**
   * Valida MULTIPLE_CHOICE
   */
  private validateMultipleChoice(
    customization: any,
    input: CustomizationInput,
    data: any,
    errors: string[]
  ) {
    const options = data?.options || [];
    const selectedOptions = input.data.selected_options || [];

    if (selectedOptions.length === 0) {
      errors.push(`${customization.name}: Nenhuma opção selecionada`);
      return;
    }

    const minSelection = data?.min_selection || 1;
    const maxSelection = data?.max_selection || options.length;

    if (selectedOptions.length < minSelection) {
      errors.push(
        `${customization.name}: Selecione ao menos ${minSelection} opção(ões)`
      );
    }

    if (selectedOptions.length > maxSelection) {
      errors.push(
        `${customization.name}: Selecione no máximo ${maxSelection} opção(ões)`
      );
    }

    // Validar se as opções existem
    selectedOptions.forEach((selectedOption: string) => {
      const optionExists = options.some((o: any) => o.id === selectedOption);

      if (!optionExists) {
        errors.push(`${customization.name}: Opção inválida selecionada`);
      }
    });
  }

  /**
   * Constrói payload de preview
   */
  async buildPreviewPayload(params: {
    itemId: string;
    customizations: CustomizationInput[];
  }): Promise<PreviewPayload> {
    const { itemId, customizations } = params;

    const photos: PreviewPayload["photos"] = [];
    const texts: PreviewPayload["texts"] = [];
    let layout: any = null;

    // Processar cada customização
    for (const customization of customizations) {
      const customizationRecord = await prisma.customization.findUnique({
        where: { id: customization.customization_id },
      });

      if (!customizationRecord) continue;

      // DYNAMIC_LAYOUT ou IMAGES
      if (
        customization.customization_type === "DYNAMIC_LAYOUT" ||
        customization.customization_type === "IMAGES"
      ) {
        const layoutId =
          customization.data.layout_id || customization.data.DYNAMIC_LAYOUT_id;

        if (layoutId) {
          try {
            layout = await layoutBaseService.getById(layoutId);
          } catch (error) {
            console.warn(`Preview: Layout ${layoutId} não encontrado`);
          }
        }
      }

      // IMAGES
      if (customization.customization_type === "IMAGES") {
        const images = customization.data.images || [];
        images.forEach((image: any) => {
          if (image.source) {
            photos.push({
              source: image.source,
              position: {
                slot: image.slot,
                x: image.x,
                y: image.y,
                width: image.width,
                height: image.height,
                z_index: image.z_index,
                rotation: image.rotation,
              },
            });
          }
        });
      }

      // TEXT
      if (customization.customization_type === "TEXT") {
        const fields = customization.data.fields || [];
        fields.forEach((field: any) => {
          if (field.value) {
            texts.push({
              value: field.value,
              position: field.position,
            });
          }
        });
      }

      // MULTIPLE_CHOICE — permitir que opções tenham imagem opcional e incluí-las no preview
      if (customization.customization_type === "MULTIPLE_CHOICE") {
        const selectedOptions = customization.data.selected_options || [];

        if (selectedOptions.length > 0) {
          // A customização registrada contém os dados das opções (labels, imagens, etc.)
          const options =
            (customizationRecord.customization_data as any)?.options || [];

          selectedOptions.forEach((selectedId: string) => {
            const option = options.find((o: any) => o.id === selectedId);
            if (option) {
              const imageSource =
                option.image_url || option.image || option.src;
              if (imageSource) {
                // Inserir imagem no preview. Se a opção fornecer posição, respeita-a.
                photos.push({
                  source: imageSource,
                  position: option.position || undefined,
                });
              }
            }
          });
        }
      }
    }

    return {
      layout: layout ? this.mapLayoutResponse(layout) : null,
      photos,
      texts,
      metadata: {
        itemId,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Mapeia layout para resposta
   */
  private mapLayoutResponse(layout: any) {
    return {
      id: layout.id,
      name: layout.name,
      description: layout.description || "",
      // Suporte para ambos os formatos (Layout legado vs Mapeado do DynamicLayout)
      base_image_url: layout.base_image_url || layout.image_url,
      layout_data: layout.layout_data || {
        fabric_json_state: layout.fabric_json_state,
        width: layout.width,
        height: layout.height,
        is_dynamic: layout.is_dynamic,
      },
    };
  }

  /**
   * Lista todas as customizações
   */
  async listAll(itemId?: string): Promise<CustomizationDTO[]> {
    const customizations = await prisma.customization.findMany({
      where: itemId ? { item_id: itemId } : undefined,
      include: {
        item: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    return customizations.map((c) => ({
      id: c.id,
      item_id: c.item_id,
      type: c.type,
      name: c.name,
      description: c.description,
      isRequired: c.isRequired,
      customization_data: c.customization_data,
      price: c.price,
    }));
  }

  /**
   * Busca uma customização por ID
   */
  async getById(id: string): Promise<CustomizationDTO> {
    const customization = await prisma.customization.findUnique({
      where: { id },
      include: {
        item: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!customization) {
      throw new Error("Customização não encontrada");
    }

    return {
      id: customization.id,
      item_id: customization.item_id,
      type: customization.type,
      name: customization.name,
      description: customization.description,
      isRequired: customization.isRequired,
      customization_data: customization.customization_data,
      price: customization.price,
    };
  }

  /**
   * Cria uma nova customização
   */
  async create(data: {
    item_id: string;
    type: CustomizationType;
    name: string;
    description?: string;
    isRequired: boolean;
    customization_data: any;
    price: number;
  }): Promise<CustomizationDTO> {
    // Verificar se o item existe
    const item = await prisma.item.findUnique({
      where: { id: data.item_id },
    });

    if (!item) {
      throw new Error("Item não encontrado");
    }

    // Validar customization_data baseado no tipo
    this.validateCustomizationData(data.type, data.customization_data);

    const customization = await prisma.customization.create({
      data: {
        item_id: data.item_id,
        type: data.type,
        name: data.name,
        description: data.description,
        isRequired: data.isRequired,
        customization_data: data.customization_data,
        price: data.price,
      },
    });

    return {
      id: customization.id,
      item_id: customization.item_id,
      type: customization.type,
      name: customization.name,
      description: customization.description,
      isRequired: customization.isRequired,
      customization_data: customization.customization_data,
      price: customization.price,
    };
  }

  /**
   * Atualiza uma customização existente
   */
  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      isRequired?: boolean;
      customization_data?: any;
      price?: number;
    }
  ): Promise<CustomizationDTO> {
    const existing = await prisma.customization.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error("Customização não encontrada");
    }

    // Validar customization_data se fornecido
    if (data.customization_data) {
      this.validateCustomizationData(existing.type, data.customization_data);
    }

    const customization = await prisma.customization.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        isRequired: data.isRequired,
        customization_data: data.customization_data,
        price: data.price,
      },
    });

    return {
      id: customization.id,
      item_id: customization.item_id,
      type: customization.type,
      name: customization.name,
      description: customization.description,
      isRequired: customization.isRequired,
      customization_data: customization.customization_data,
      price: customization.price,
    };
  }

  /**
   * Remove uma customização
   */
  async delete(id: string): Promise<void> {
    const customization = await prisma.customization.findUnique({
      where: { id },
    });

    if (!customization) {
      throw new Error("Customização não encontrada");
    }

    await prisma.customization.delete({
      where: { id },
    });
  }

  /**
   * Valida customization_data baseado no tipo
   */
  private validateCustomizationData(type: CustomizationType, data: any): void {
    switch (type) {
      case "DYNAMIC_LAYOUT":
        if (!data.layouts || !Array.isArray(data.layouts)) {
          throw new Error("DYNAMIC_LAYOUT requer array de layouts");
        }
        break;

      case "TEXT":
        if (!data.fields || !Array.isArray(data.fields)) {
          throw new Error("TEXT requer array de fields");
        }
        break;

      case "IMAGES":
        if (!data.DYNAMIC_LAYOUT) {
          throw new Error("IMAGES requer DYNAMIC_LAYOUT");
        }
        break;

      case "MULTIPLE_CHOICE":
        if (!data.options || !Array.isArray(data.options)) {
          throw new Error("MULTIPLE_CHOICE requer array de options");
        }
        if (
          data.min_selection !== undefined &&
          data.max_selection !== undefined
        ) {
          if (data.min_selection > data.max_selection) {
            throw new Error(
              "min_selection não pode ser maior que max_selection"
            );
          }
        }
        break;

      default:
        throw new Error(`Tipo de customização não suportado: ${type}`);
    }
  }
}

export default new CustomizationService();
