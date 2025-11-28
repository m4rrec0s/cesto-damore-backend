"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aiProductService_1 = __importDefault(require("../services/aiProductService"));
/**
 * Controller para endpoints de consulta de produtos pela IA
 */
class AIProductController {
    /**
     * GET /ai/products/light
     * Retorna lista leve de todos os produtos para carregamento rápido
     * Aceita parâmetros de busca opcionais: q, keywords, occasion, price_max, tag, available
     */
    async getLightweightProducts(req, res) {
        try {
            const result = await aiProductService_1.default.getLightweightProducts(req.query);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao buscar produtos leves:", error);
            res.status(500).json({
                error: "Erro ao buscar produtos",
                message: error.message,
            });
        }
    }
    /**
     * GET /ai/products/detail/:id
     * Retorna detalhes completos de um produto
     */
    async getProductDetail(req, res) {
        try {
            const { id } = req.params;
            const result = await aiProductService_1.default.getProductDetail(id);
            res.json(result);
        }
        catch (error) {
            console.error("Erro ao buscar detalhe do produto:", error);
            res.status(500).json({
                error: "Erro ao buscar detalhe do produto",
                message: error.message,
            });
        }
    }
    /**
     * GET /ai/products/search
     * Endpoint especializado para consultas da IA (Tool Calling)
     */
    async searchProducts(req, res) {
        try {
            const result = await aiProductService_1.default.searchProducts(req.query);
            res.json(result);
        }
        catch (error) {
            console.error("Erro na consulta AI de produtos:", error);
            res.status(500).json({
                success: false,
                error: "Erro ao processar consulta de produtos",
                message: error.message,
            });
        }
    }
    /**
     * GET /ai/products/info
     * Retorna informações sobre o endpoint e exemplos de uso
     */
    async getEndpointInfo(req, res) {
        res.json({
            endpoints: {
                light: {
                    url: "/ai/products/light",
                    description: "Lista leve de todos os produtos (<1KB/item)",
                },
                detail: {
                    url: "/ai/products/detail/:id",
                    description: "Detalhes completos do produto com componentes e adicionais",
                },
                search: {
                    url: "/ai/products/search",
                    description: "Busca otimizada para tool-calling",
                    params: [
                        "keywords",
                        "occasion",
                        "price_max",
                        "tag",
                        "available",
                        "has_custom_photo",
                    ],
                },
            },
        });
    }
}
exports.default = new AIProductController();
