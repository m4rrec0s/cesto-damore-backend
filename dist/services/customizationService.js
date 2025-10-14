"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class CustomizationService {
    async getCustomizationConfig(itemType, itemId) {
        if (itemType === "PRODUCT") {
            return this.getProductCustomizationConfig(itemId);
        }
        return this.getAdditionalCustomizationConfig(itemId);
    }
    async getCustomizationsByReference(referenceId) {
        const product = await prisma_1.default.product.findUnique({
            where: { id: referenceId },
        });
        if (product) {
            return {
                type: "PRODUCT",
                config: await this.getProductCustomizationConfig(referenceId),
            };
        }
        const additional = await prisma_1.default.additional.findUnique({
            where: { id: referenceId },
        });
        if (additional) {
            return {
                type: "ADDITIONAL",
                config: await this.getAdditionalCustomizationConfig(referenceId),
            };
        }
        return {
            type: null,
            config: null,
        };
    }
    async getProductCustomizationConfig(productId) {
        const product = await prisma_1.default.product.findUnique({
            where: { id: productId },
            include: { type: true },
        });
        if (!product) {
            throw new Error("Produto não encontrado");
        }
        const layouts = await this.getLayoutsForItem("PRODUCT", productId);
        const rules = await this.getProductRules(product.type_id);
        const legacyRules = await this.getLegacyProductCustomizations(productId);
        const constraints = await this.getConstraintsForItem("PRODUCT", productId);
        return {
            item: {
                id: product.id,
                name: product.name,
                type: "PRODUCT",
                allowsCustomization: product.allows_customization,
                has3dPreview: Boolean(product.type?.has_3d_preview),
            },
            layouts,
            rules,
            legacyRules,
            constraints,
        };
    }
    async getAdditionalCustomizationConfig(additionalId) {
        const additional = await prisma_1.default.additional.findUnique({
            where: { id: additionalId },
        });
        if (!additional) {
            throw new Error("Adicional não encontrado");
        }
        const layouts = await this.getLayoutsForItem("ADDITIONAL", additionalId);
        const legacyRules = await this.getLegacyAdditionalCustomizations(additionalId);
        const constraints = await this.getConstraintsForItem("ADDITIONAL", additionalId);
        return {
            item: {
                id: additional.id,
                name: additional.name,
                type: "ADDITIONAL",
                allowsCustomization: additional.allows_customization,
                has3dPreview: false,
            },
            layouts,
            rules: [],
            legacyRules,
            constraints,
        };
    }
    async validateCustomizations(options) {
        const { itemType, itemId, inputs } = options;
        const errors = [];
        const warnings = [];
        if (itemType === "PRODUCT") {
            const product = await prisma_1.default.product.findUnique({
                where: { id: itemId },
                include: { type: true },
            });
            if (!product) {
                return { valid: false, errors: ["Produto não encontrado"], warnings };
            }
            const rules = await this.getProductRules(product.type_id);
            const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
            // Verificar obrigatórios
            rules
                .filter((rule) => rule.required)
                .forEach((rule) => {
                const hasRule = inputs.some((input) => this.ruleMatchesInput(rule.id, input));
                if (!hasRule) {
                    errors.push(`Campo obrigatório não preenchido: ${rule.title}`);
                }
            });
            // Validar cada input
            for (const input of inputs) {
                const normalizedRuleId = this.getInputRuleId(input);
                if (!normalizedRuleId)
                    continue;
                const rule = ruleMap.get(normalizedRuleId);
                if (!rule) {
                    warnings.push(`Regra não encontrada: ${normalizedRuleId}`);
                    continue;
                }
                this.validateRuleConstraints(rule, input, errors);
            }
            // Checar conflitos e dependências
            const appliedRules = inputs
                .map((input) => this.getInputRuleId(input))
                .filter((id) => Boolean(id));
            for (const input of inputs) {
                const normalizedRuleId = this.getInputRuleId(input);
                if (!normalizedRuleId)
                    continue;
                const rule = ruleMap.get(normalizedRuleId);
                if (!rule)
                    continue;
                if (rule.conflictWith.length > 0) {
                    const conflicts = rule.conflictWith.filter((conflictId) => appliedRules.includes(conflictId));
                    if (conflicts.length > 0) {
                        errors.push(`${rule.title}: conflita com outra customização selecionada`);
                    }
                }
                if (rule.dependencies.length > 0) {
                    const missing = rule.dependencies.filter((dependencyId) => !appliedRules.includes(dependencyId));
                    if (missing.length > 0) {
                        errors.push(`${rule.title}: requer outra customização que não foi selecionada`);
                    }
                }
            }
        }
        else {
            // Legado para adicionais
            const legacyRules = await this.getLegacyAdditionalCustomizations(itemId);
            const legacyMap = new Map(legacyRules.map((rule) => [rule.id, rule]));
            for (const rule of legacyRules.filter((rule) => rule.isRequired)) {
                const hasRule = inputs.some((input) => this.ruleMatchesInput(rule.id, input));
                if (!hasRule) {
                    errors.push(`Campo obrigatório não preenchido: ${rule.title}`);
                }
            }
            for (const input of inputs) {
                const normalizedRuleId = this.getInputRuleId(input);
                if (!normalizedRuleId)
                    continue;
                const rule = legacyMap.get(normalizedRuleId);
                if (!rule) {
                    warnings.push(`Regra não encontrada: ${normalizedRuleId}`);
                    continue;
                }
                this.validateLegacyConstraints(rule, input, errors);
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }
    async buildPreviewPayload(params) {
        const layoutRecord = await prisma_1.default.layout.findUnique({
            where: { id: params.layoutId },
        });
        if (!layoutRecord || !layoutRecord.is_active) {
            throw new Error("Layout indisponível ou inativo");
        }
        const layout = this.mapLayout(layoutRecord);
        const photos = [];
        const texts = [];
        for (const customization of params.customizations) {
            if (customization.customizationType === "PHOTO_UPLOAD") {
                const photoEntries = customization.data?.photos ?? [];
                photoEntries.forEach((photo) => {
                    if (!photo?.source)
                        return;
                    photos.push({
                        source: photo.source,
                        positionKey: photo.positionKey,
                        placement: this.resolvePlacement(layout.placeholderPositions, photo.positionKey),
                    });
                });
            }
            if (customization.customizationType === "TEXT_INPUT") {
                const textEntries = customization.data?.texts ?? [];
                textEntries.forEach((text) => {
                    if (!text?.value)
                        return;
                    texts.push({
                        value: text.value,
                        positionKey: text.positionKey,
                        placement: this.resolvePlacement(layout.textPositions, text.positionKey),
                    });
                });
            }
        }
        return {
            layout,
            photos,
            texts,
            metadata: {
                preview3dUrl: layout.preview3dUrl,
                generatedAt: new Date().toISOString(),
            },
        };
    }
    async getProductRules(productTypeId) {
        const rules = await prisma_1.default.productRule.findMany({
            where: { product_type_id: productTypeId },
            orderBy: { display_order: "asc" },
        });
        return rules.map((rule) => ({
            id: rule.id,
            ruleType: rule.rule_type,
            title: rule.title,
            description: rule.description,
            required: rule.required,
            maxItems: rule.max_items,
            conflictWith: rule.conflict_with ? JSON.parse(rule.conflict_with) : [],
            dependencies: rule.dependencies ? JSON.parse(rule.dependencies) : [],
            availableOptions: rule.available_options
                ? JSON.parse(rule.available_options)
                : null,
            previewImageUrl: rule.preview_image_url,
            displayOrder: rule.display_order,
        }));
    }
    async getLayoutsForItem(itemType, itemId) {
        const layouts = await prisma_1.default.layout.findMany({
            where: {
                item_id: itemId,
                item_type: itemType,
                is_active: true,
            },
            orderBy: { display_order: "asc" },
        });
        return layouts.map((layout) => this.mapLayout(layout));
    }
    async getLegacyProductCustomizations(productId) {
        const customizations = await prisma_1.default.productCustomization.findMany({
            where: { product_id: productId },
            orderBy: { display_order: "asc" },
        });
        return customizations.map((customization) => ({
            id: customization.id,
            customizationType: customization.customization_type,
            title: customization.title,
            description: customization.description,
            isRequired: customization.is_required,
            maxItems: customization.max_items,
            availableOptions: customization.available_options
                ? JSON.parse(customization.available_options)
                : null,
            layoutId: customization.layout_id ?? null,
            previewImageUrl: customization.preview_image_url,
            displayOrder: customization.display_order,
        }));
    }
    async getLegacyAdditionalCustomizations(additionalId) {
        const customizations = await prisma_1.default.additionalCustomization.findMany({
            where: { additional_id: additionalId },
            orderBy: { display_order: "asc" },
        });
        return customizations.map((customization) => ({
            id: customization.id,
            customizationType: customization.customization_type,
            title: customization.title,
            description: customization.description,
            isRequired: customization.is_required,
            maxItems: customization.max_items,
            availableOptions: customization.available_options
                ? JSON.parse(customization.available_options)
                : null,
            layoutId: customization.layout_id ?? null,
            previewImageUrl: customization.preview_image_url,
            displayOrder: customization.display_order,
        }));
    }
    async getConstraintsForItem(itemType, itemId) {
        const constraints = await prisma_1.default.itemConstraint.findMany({
            where: {
                OR: [
                    { target_item_id: itemId, target_item_type: itemType },
                    { related_item_id: itemId, related_item_type: itemType },
                ],
            },
            orderBy: { created_at: "desc" },
        });
        return constraints.map((constraint) => ({
            id: constraint.id,
            targetItemId: constraint.target_item_id,
            targetItemType: constraint.target_item_type,
            constraintType: constraint.constraint_type,
            relatedItemId: constraint.related_item_id,
            relatedItemType: constraint.related_item_type,
            message: constraint.message,
        }));
    }
    mapLayout(layout) {
        return {
            id: layout.id,
            name: layout.name,
            description: layout.description,
            baseImageUrl: layout.base_image_url,
            placeholderPositions: layout.placeholder_positions
                ? Array.isArray(layout.placeholder_positions)
                    ? layout.placeholder_positions
                    : JSON.parse(layout.placeholder_positions)
                : [],
            allowsPhotoUpload: layout.allows_photo_upload,
            maxPhotos: layout.max_photos,
            allowsTextInput: layout.allows_text_input,
            textPositions: layout.text_positions
                ? Array.isArray(layout.text_positions)
                    ? layout.text_positions
                    : JSON.parse(layout.text_positions)
                : [],
            maxTextInputs: layout.max_text_inputs,
            preview3dUrl: layout.preview_3d_url,
            displayOrder: layout.display_order,
        };
    }
    ruleMatchesInput(ruleId, input) {
        return (input.ruleId === ruleId ||
            input.customizationRuleId === ruleId ||
            this.getInputRuleId(input) === ruleId);
    }
    getInputRuleId(input) {
        if (input.ruleId)
            return input.ruleId;
        if (input.customizationRuleId)
            return input.customizationRuleId;
        if (input.data?.ruleId)
            return input.data.ruleId;
        return null;
    }
    validateRuleConstraints(rule, input, errors) {
        if (!rule.maxItems) {
            return;
        }
        if (input.data?.photos && Array.isArray(input.data.photos)) {
            if (input.data.photos.length > rule.maxItems) {
                errors.push(`${rule.title}: máximo de ${rule.maxItems} itens permitidos`);
            }
        }
        if (input.data?.texts && Array.isArray(input.data.texts)) {
            if (input.data.texts.length > rule.maxItems) {
                errors.push(`${rule.title}: máximo de ${rule.maxItems} itens permitidos`);
            }
        }
    }
    validateLegacyConstraints(rule, input, errors) {
        if (!rule.maxItems) {
            return;
        }
        if (input.data?.photos && Array.isArray(input.data.photos)) {
            if (input.data.photos.length > rule.maxItems) {
                errors.push(`${rule.title}: máximo de ${rule.maxItems} itens permitidos`);
            }
        }
        if (input.data?.options && Array.isArray(input.data.options)) {
            if (input.data.options.length > rule.maxItems) {
                errors.push(`${rule.title}: máximo de ${rule.maxItems} itens permitidos`);
            }
        }
    }
    resolvePlacement(positions, key) {
        if (!key || !Array.isArray(positions)) {
            return null;
        }
        return positions.find((position) => position.key === key) ?? null;
    }
}
exports.default = new CustomizationService();
