import { CustomizationType } from "@prisma/client";
import prisma from "../database/prisma";
import logger from "./logger";

/**
 * 🔥 NOVO: Validador de customizações com regras de negócio robustas
 * Garante que customizações obrigatórias estejam preenchidas corretamente
 */

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

/**
 * Valida se dados de customização TEXT estão corretos
 */
function validateTextCustomization(
  data: Record<string, any>,
  rule: CustomizationRule,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const text = data.text || "";
  const cleanText = String(text).trim();

  // 🔥 NOVO: Validação de comprimento
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

  // 🔥 NOVO: Validação de caracteres especiais excessivos
  const specialCharsRatio =
    (cleanText.match(/[^a-zA-Z0-9\s]/g) || []).length / cleanText.length;
  if (specialCharsRatio > 0.5) {
    warnings.push(
      `Campo "${rule.name}" contém muitos caracteres especiais. Verifique se o texto está correto.`,
    );
  }

  // 🔥 NOVO: Detectar apenas emojis ou símbolos
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

/**
 * Valida se dados de customização MULTIPLE_CHOICE estão corretos
 */
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

  // 🔥 NOVO: Validar se a opção existe nas opções disponíveis
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

/**
 * Valida se dados de customização IMAGES estão corretos
 */
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

  // 🔥 NOVO: Validar mínimo e máximo de fotos
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

  // 🔥 NOVO: Validar se todas as fotos têm preview_url válido
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

  // 🔥 NOVO: Warning se faltar informação de mime_type
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

/**
 * Valida se dados de customização DYNAMIC_LAYOUT estão corretos
 */
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

  // 🔥 NOVO: Verificar se o design foi finalizado (tem preview_url)
  // ✅ CORREÇÃO: Aceitar também previewUrl (campo direto) além de final_artwork.preview_url
  const hasPreview =
    data.final_artwork?.preview_url ||
    data.image?.preview_url ||
    data.previewUrl || // ✅ NOVO: Campo direto usado pelo frontend
    (Array.isArray(data.final_artworks) &&
      data.final_artworks.some((a: any) => a.preview_url));

  if (!hasPreview) {
    errors.push(
      `Layout "${rule.name}" foi selecionado mas não foi finalizado. Complete a personalização.`,
    );
  }

  // 🔥 NOVO: Verificar se há fabricJsonState (prova de edição no canvas)
  const hasFabricState = Boolean(
    data.fabricJsonState || data.fabricState || data.fabric_json_state,
  );

  if (!hasFabricState) {
    warnings.push(
      `Layout "${rule.name}" pode não ter sido personalizado. Verifique se salvou as alterações.`,
    );
  }

  // 🔥 NOVO: Validar preview_url não é blob ou base64
  if (hasPreview) {
    // ✅ CORREÇÃO: Verificar todos os campos possíveis
    const previewUrl =
      data.final_artwork?.preview_url ||
      data.image?.preview_url ||
      data.previewUrl || // ✅ NOVO: Campo direto
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

/**
 * Valida uma única customização
 */
export function validateCustomization(
  customization: CustomizationData,
  rule: CustomizationRule,
): ValidationResult {
  // Parsear value se for string
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

  // Aplicar validação específica por tipo
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

/**
 * Valida todas as customizações de um item de pedido
 */
export async function validateItemCustomizations(
  productId: string,
  customizations: CustomizationData[],
): Promise<ValidationResult> {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  try {
    // Buscar regras de customização do produto
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
      // Produto sem customizações - OK
      return { isValid: true, errors: [], warnings: [] };
    }

    // Verificar customizações obrigatórias
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

      // Validar conteúdo da customização
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

/**
 * Valida todas as customizações de todos os itens de um pedido
 */
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

    // Adicionar prefixo com número do item para facilitar identificação
    validation.errors.forEach((err) => {
      allErrors.push(`Item ${i + 1}: ${err}`);
    });

    validation.warnings.forEach((warn) => {
      allWarnings.push(`Item ${i + 1}: ${warn}`);
    });
  }

  // Log warnings (não bloqueiam pedido, mas ajudam a identificar problemas)
  if (allWarnings.length > 0) {
    logger.warn("⚠️ Avisos de validação de customizações:", allWarnings);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
