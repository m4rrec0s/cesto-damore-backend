"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class PreviewService {
    /**
     * Gera preview dinâmico da customização
     */
    async generatePreview(data) {
        try {
            // Buscar produto e seu tipo
            const product = await prisma_1.default.product.findUnique({
                where: { id: data.productId },
                include: {
                    type: true,
                },
            });
            if (!product) {
                return {
                    message: "Produto não encontrado",
                };
            }
            // Verificar se o tipo de produto suporta preview 3D
            const productType = await prisma_1.default.productType.findUnique({
                where: { id: product.type_id },
            });
            const response = {};
            // Se tem suporte a 3D, retornar URL do modelo
            if (productType?.has_3d_preview) {
                // Por enquanto, retornar URL estática baseada no tipo
                // Futuramente pode ser gerado dinamicamente
                response.model3d = this.get3DModelUrl(product.type_id);
            }
            // Gerar preview estático (pode ser expandido futuramente)
            // Por enquanto retorna a imagem do produto
            if (product.image_url) {
                response.previewUrl = product.image_url;
            }
            // Se houver fotos personalizadas, usar a primeira como preview
            if (data.customizationData.photos &&
                data.customizationData.photos.length > 0) {
                const firstPhoto = data.customizationData.photos[0];
                if (firstPhoto.preview_url) {
                    response.previewUrl = firstPhoto.preview_url;
                }
            }
            return response;
        }
        catch (error) {
            console.error("Erro ao gerar preview:", error);
            return {
                message: "Erro ao gerar preview",
            };
        }
    }
    /**
     * Retorna URL do modelo 3D baseado no tipo de produto
     */
    get3DModelUrl(productTypeId) {
        // Mapeamento estático - pode ser migrado para banco futuramente
        const modelsMap = {
        // Exemplos de mapeamento
        // 'caneca-id': '/models/caneca.glb',
        // 'quadro-id': '/models/quadro.glb',
        };
        return (modelsMap[productTypeId] || `/models/default.glb?type=${productTypeId}`);
    }
    /**
     * Valida se os dados de customização estão completos para preview
     */
    validatePreviewData(data) {
        const errors = [];
        if (!data.productId) {
            errors.push("ID do produto é obrigatório");
        }
        if (!data.customizationData) {
            errors.push("Dados de customização são obrigatórios");
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
}
exports.default = new PreviewService();
