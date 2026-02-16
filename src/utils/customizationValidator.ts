import { CustomizationType } from "@prisma/client";
import prisma from "../database/prisma";
import logger from "./logger";

interface CustomizationData {
  customization_id: string;
  customization_type: CustomizationType;
  value: string | Record<string, any>;
  is_required?: boolean;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface CustomizationRule {
  id: string;
  name: string;
  type: CustomizationType;
  isRequired: boolean;
  customization_data: any;
}

function validateTextCustomization(
  data: Record<string, any>,
  rule: CustomizationRule,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const text = data.text || "";
  const cleanText = String(text).trim();

  const minLength = rule.customization_data?.min_length || 1;
  const maxLength = rule.customization_data?.max_length || 500;

  if (cleanText.length === 0) {
    errors.push(`Campo de texto "${rule.name}" está vazio`);
    return { isValid: false, errors, warnings };
  }

  if (cleanText.length < minLength) {
    errors.push(
      `Campo "${rule.name}" deve ter no mínimo ${minLength} caracteres (atual: ${cleanText.length})`,
    );
  }

  if (cleanText.length > maxLength) {
    errors.push(
      `Campo "${rule.name}" excede o limite de ${maxLength} caracteres (atual: ${cleanText.length})`,
    );
  }

  const specialCharsRatio =
    (cleanText.match(/[^a-zA-Z0-9\s]/g) || []).length / cleanText.length;
  if (specialCharsRatio > 0.5) {
    warnings.push(
      `Campo "${rule.name}" contém muitos caracteres especiais. Verifique se o texto está correto.`,
    );
  }

  const onlySymbols = /^[\p{Emoji}\p{Symbol}\s]+$/u.test(cleanText);
  if (onlySymbols && cleanText.length < 10) {
    warnings.push(
      `Campo "${rule.name}" parece conter apenas símbolos. Adicione texto descritivo.`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateMultipleChoiceCustomization(
  data: Record<string, any>,
  rule: CustomizationRule,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const selectedOption = data.selected_option || data.label_selected;

  if (!selectedOption) {
    errors.push(`Nenhuma opção selecionada para "${rule.name}"`);
    return { isValid: false, errors, warnings };
  }

  const availableOptions = rule.customization_data?.options || [];
  if (Array.isArray(availableOptions) && availableOptions.length > 0) {
    const optionExists = availableOptions.some(
      (opt: any) =>
        opt.id === selectedOption ||
        opt.label === selectedOption ||
        opt.value === selectedOption,
    );

    if (!optionExists) {
      errors.push(`Opção "${selectedOption}" não é válida para "${rule.name}"`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateImagesCustomization(
  data: Record<string, any>,
  rule: CustomizationRule,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const photos = data.photos || [];

  if (!Array.isArray(photos) || photos.length === 0) {
    errors.push(`Nenhuma foto enviada para "${rule.name}"`);
    return { isValid: false, errors, warnings };
  }

  const minPhotos = rule.customization_data?.min_photos || 1;
  const maxPhotos = rule.customization_data?.max_photos || 10;

  if (photos.length < minPhotos) {
    errors.push(
      `Envie no mínimo ${minPhotos} foto(s) para "${rule.name}" (atual: ${photos.length})`,
    );
  }

  if (photos.length > maxPhotos) {
    errors.push(
      `Limite de ${maxPhotos} foto(s) excedido para "${rule.name}" (atual: ${photos.length})`,
    );
  }

  const invalidPhotos = photos.filter(
    (photo: any) =>
      !photo.preview_url ||
      photo.preview_url.startsWith("blob:") ||
      photo.preview_url.startsWith("data:"),
  );

  if (invalidPhotos.length > 0) {
    errors.push(
      `${invalidPhotos.length} foto(s) não foram enviadas corretamente para "${rule.name}". Faça upload novamente.`,
    );
  }

  const photosWithoutMime = photos.filter((p: any) => !p.mime_type);
  if (photosWithoutMime.length > 0) {
    warnings.push(
      `${photosWithoutMime.length} foto(s) sem informação de tipo de arquivo`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateDynamicLayoutCustomization(
  data: Record<string, any>,
  rule: CustomizationRule,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const selectedItem =
    data.selected_item_label || data.label_selected || data.selected_item;

  if (!selectedItem) {
    errors.push(`Nenhum layout selecionado para "${rule.name}"`);
    return { isValid: false, errors, warnings };
  }

  const hasPreview =
    data.final_artwork?.preview_url ||
    data.image?.preview_url ||
    data.previewUrl ||
    (Array.isArray(data.final_artworks) &&
      data.final_artworks.some((a: any) => a.preview_url));

  if (!hasPreview) {
    errors.push(
      `Layout "${rule.name}" foi selecionado mas não foi finalizado. Complete a personalização.`,
    );
  }

  const hasFabricState = Boolean(
    data.fabricJsonState || data.fabricState || data.fabric_json_state,
  );

  if (!hasFabricState) {
    warnings.push(
      `Layout "${rule.name}" pode não ter sido personalizado. Verifique se salvou as alterações.`,
    );
  }

  if (hasPreview) {

    const previewUrl =
      data.final_artwork?.preview_url ||
      data.image?.preview_url ||
      data.previewUrl ||
      data.final_artworks?.[0]?.preview_url;

    if (
      previewUrl &&
      (previewUrl.startsWith("blob:") || previewUrl.startsWith("data:"))
    ) {
      errors.push(
        `Preview do layout "${rule.name}" não foi enviado ao servidor. Salve novamente.`,
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateCustomization(
  customization: CustomizationData,
  rule: CustomizationRule,
): ValidationResult {

  let data: Record<string, any>;
  try {
    data =
      typeof customization.value === "string"
        ? JSON.parse(customization.value)
        : customization.value;
  } catch (err) {
    return {
      isValid: false,
      errors: [`Dados de customização "${rule.name}" estão corrompidos`],
      warnings: [],
    };
  }

  switch (rule.type) {
    case "TEXT":
      return validateTextCustomization(data, rule);
    case "MULTIPLE_CHOICE":
      return validateMultipleChoiceCustomization(data, rule);
    case "IMAGES":
      return validateImagesCustomization(data, rule);
    case "DYNAMIC_LAYOUT":
      return validateDynamicLayoutCustomization(data, rule);
    default:
      return {
        isValid: true,
        errors: [],
        warnings: [`Tipo de customização "${rule.type}" não validado`],
      };
  }
}

export async function validateItemCustomizations(
  productId: string,
  customizations: CustomizationData[],
): Promise<ValidationResult> {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  try {

    const rules = await prisma.customization.findMany({
      where: { item_id: productId },
      select: {
        id: true,
        name: true,
        type: true,
        isRequired: true,
        customization_data: true,
      },
    });

    if (rules.length === 0) {

      return { isValid: true, errors: [], warnings: [] };
    }

    for (const rule of rules) {
      if (!rule.isRequired) continue;

      const customization = customizations.find(
        (c) => c.customization_id === rule.id,
      );

      if (!customization) {
        allErrors.push(
          `Customização obrigatória "${rule.name}" não foi preenchida`,
        );
        continue;
      }

      const validation = validateCustomization(customization, rule);
      allErrors.push(...validation.errors);
      allWarnings.push(...validation.warnings);
    }

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  } catch (error) {
    logger.error("❌ Erro ao validar customizações do item:", error);
    return {
      isValid: false,
      errors: ["Erro ao validar customizações. Tente novamente."],
      warnings: [],
    };
  }
}

export async function validateOrderCustomizations(
  items: Array<{
    product_id: string;
    customizations?: CustomizationData[];
  }>,
): Promise<ValidationResult> {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const customizations = item.customizations || [];

    const validation = await validateItemCustomizations(
      item.product_id,
      customizations,
    );

    validation.errors.forEach((err) => {
      allErrors.push(`Item ${i + 1}: ${err}`);
    });

    validation.warnings.forEach((warn) => {
      allWarnings.push(`Item ${i + 1}: ${warn}`);
    });
  }

  if (allWarnings.length > 0) {
    logger.warn("⚠️ Avisos de validação de customizações:", allWarnings);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
