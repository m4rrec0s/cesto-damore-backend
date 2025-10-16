"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class CustomizationService {
    /**
     * Busca customizações de um item
     */
    async getItemCustomizations(itemId) {
        const item = await prisma_1.default.item.findUnique({
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
    async validateCustomizations(options) {
        const { itemId, inputs } = options;
        const errors = [];
        const warnings = [];
        // Buscar item e suas customizações
        const item = await prisma_1.default.item.findUnique({
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
        const customizationMap = new Map(item.customizations.map((c) => [c.id, c]));
        // Verificar customizações obrigatórias
        item.customizations
            .filter((c) => c.isRequired)
            .forEach((customization) => {
            const hasCustomization = inputs.some((input) => input.customization_id === customization.id);
            if (!hasCustomization) {
                errors.push(`Customização obrigatória não preenchida: ${customization.name}`);
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
    validateByType(customization, input, errors) {
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
                errors.push(`Tipo de customização não suportado: ${customization.type}`);
        }
    }
    /**
     * Valida BASE_LAYOUT
     */
    validateBaseLayout(customization, input, data, errors) {
        if (!input.data.layout_id) {
            errors.push(`${customization.name}: Layout não selecionado`);
            return;
        }
        // Verificar se o layout existe nos layouts disponíveis
        const layouts = data?.layouts || [];
        const layoutExists = layouts.some((l) => l.id === input.data.layout_id);
        if (!layoutExists) {
            errors.push(`${customization.name}: Layout inválido`);
        }
    }
    /**
     * Valida TEXT
     */
    validateText(customization, input, data, errors) {
        const fields = data?.fields || [];
        const providedFields = input.data.fields || [];
        // Verificar campos obrigatórios
        fields
            .filter((f) => f.required)
            .forEach((field) => {
            const providedField = providedFields.find((pf) => pf.field_id === field.id);
            if (!providedField || !providedField.value) {
                errors.push(`${customization.name}: Campo "${field.label}" é obrigatório`);
            }
        });
        // Validar limites de caracteres
        providedFields.forEach((providedField) => {
            const field = fields.find((f) => f.id === providedField.field_id);
            if (field && field.max_length) {
                if (providedField.value &&
                    providedField.value.length > field.max_length) {
                    errors.push(`${customization.name}: Campo "${field.label}" excede limite de ${field.max_length} caracteres`);
                }
            }
        });
    }
    /**
     * Valida IMAGES
     */
    validateImages(customization, input, data, errors) {
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
            errors.push(`${customization.name}: Máximo de ${maxImages} imagens permitidas`);
        }
        // Validar posições das imagens
        images.forEach((image, index) => {
            if (!image.source) {
                errors.push(`${customization.name}: Imagem ${index + 1} sem fonte`);
            }
            if (image.slot === undefined) {
                errors.push(`${customization.name}: Imagem ${index + 1} sem slot definido`);
            }
        });
    }
    /**
     * Valida MULTIPLE_CHOICE
     */
    validateMultipleChoice(customization, input, data, errors) {
        const options = data?.options || [];
        const selectedOptions = input.data.selected_options || [];
        if (selectedOptions.length === 0) {
            errors.push(`${customization.name}: Nenhuma opção selecionada`);
            return;
        }
        const minSelection = data?.min_selection || 1;
        const maxSelection = data?.max_selection || options.length;
        if (selectedOptions.length < minSelection) {
            errors.push(`${customization.name}: Selecione ao menos ${minSelection} opção(ões)`);
        }
        if (selectedOptions.length > maxSelection) {
            errors.push(`${customization.name}: Selecione no máximo ${maxSelection} opção(ões)`);
        }
        // Validar se as opções existem
        selectedOptions.forEach((selectedOption) => {
            const optionExists = options.some((o) => o.id === selectedOption);
            if (!optionExists) {
                errors.push(`${customization.name}: Opção inválida selecionada`);
            }
        });
    }
    /**
     * Constrói payload de preview
     */
    async buildPreviewPayload(params) {
        const { itemId, customizations } = params;
        const photos = [];
        const texts = [];
        let layout = null;
        // Processar cada customização
        for (const customization of customizations) {
            const customizationRecord = await prisma_1.default.customization.findUnique({
                where: { id: customization.customization_id },
            });
            if (!customizationRecord)
                continue;
            // BASE_LAYOUT ou IMAGES
            if (customization.customization_type === "BASE_LAYOUT" ||
                customization.customization_type === "IMAGES") {
                const layoutId = customization.data.layout_id || customization.data.base_layout_id;
                if (layoutId) {
                    layout = await prisma_1.default.layout.findUnique({
                        where: { id: layoutId },
                    });
                }
            }
            // IMAGES
            if (customization.customization_type === "IMAGES") {
                const images = customization.data.images || [];
                images.forEach((image) => {
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
                fields.forEach((field) => {
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
    mapLayoutResponse(layout) {
        return {
            id: layout.id,
            name: layout.name,
            description: layout.description,
            base_image_url: layout.base_image_url,
            layout_data: layout.layout_data,
        };
    }
}
exports.default = new CustomizationService();
