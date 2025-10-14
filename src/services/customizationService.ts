import { CustomizationType } from "@prisma/client";
import prisma from "../database/prisma";

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
      case "BASE_LAYOUT":
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
   * Valida BASE_LAYOUT
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
    if (!input.data.base_layout_id) {
      errors.push(`${customization.name}: Layout base não selecionado`);
      return;
    }

    const baseLayout = data?.base_layout;
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

      // BASE_LAYOUT ou IMAGES
      if (
        customization.customization_type === "BASE_LAYOUT" ||
        customization.customization_type === "IMAGES"
      ) {
        const layoutId =
          customization.data.layout_id || customization.data.base_layout_id;

        if (layoutId) {
          layout = await prisma.layout.findUnique({
            where: { id: layoutId },
          });
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
      description: layout.description,
      base_image_url: layout.base_image_url,
      layout_data: layout.layout_data,
    };
  }
}

export default new CustomizationService();
