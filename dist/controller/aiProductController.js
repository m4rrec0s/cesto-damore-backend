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
     * GET /ai/products
     * Endpoint especializado para consultas da IA
     *
     * Query params:
     * - keywords (opcional): palavras-chave para busca contextual
     *
     * Exemplos:
     * - /ai/products (retorna catálogo por ordem de prioridade)
     * - /ai/products?keywords=aniversário romântico (busca contextual)
     * - /ai/products?keywords=presente barato com caneca (busca específica)
     */
    async searchProducts(req, res) {
        try {
            const keywords = req.query.keywords;
            const result = await aiProductService_1.default.searchProducts(keywords);
            res.json({
                result,
                metadata: {
                    query: keywords || "default_priority",
                    timestamp: new Date().toISOString(),
                    endpoint: "ai/products",
                },
            });
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
            endpoint: "GET /ai/products",
            description: "Endpoint otimizado para consultas de produtos por agentes de IA",
            usage: {
                without_keywords: {
                    url: "/ai/products",
                    description: "Retorna produtos na ordem de prioridade: premium caro > premium barato > caneca caro > outros barato",
                },
                with_keywords: {
                    url: "/ai/products?keywords=aniversário romântico",
                    description: "Busca contextual baseada em ocasiões, tipos de produto e faixas de preço",
                },
            },
            supported_keywords: {
                occasions: [
                    "aniversário",
                    "casamento",
                    "namorados",
                    "mães",
                    "pais",
                    "natal",
                    "páscoa",
                    "formatura",
                    "bebê/nascimento",
                    "agradecimento",
                    "recuperação",
                ],
                product_types: ["quadro", "pelúcia", "caneca"],
                price_hints: ["barato", "econômico", "caro", "premium", "luxo"],
            },
            response_structure: {
                _instructions: "Instruções gerais sobre prazos, adicionais e processo de compra",
                total_products: "Número de produtos retornados",
                products: [
                    {
                        id: "ID único do produto",
                        name: "Nome do produto",
                        description: "Descrição detalhada",
                        original_price: "Preço original (número)",
                        discount_percentage: "Percentual de desconto",
                        final_price: "Preço final após desconto (número)",
                        price_display: "Preço formatado (string) - R$ XX,XX",
                        image_url: "URL completa da imagem do produto (SEMPRE presente)",
                        available: "Booleano indicando disponibilidade",
                        stock_quantity: "Quantidade em estoque",
                        stock_status: "in_stock | low_stock | out_of_stock | unlimited",
                        categories: ["Array de categorias"],
                        type: "Tipo do produto",
                        includes: [
                            {
                                item: "Nome do item",
                                quantity: "Quantidade",
                                type: "Tipo do item",
                            },
                        ],
                        allows_customization: "Se permite personalização",
                        customization_note: "Nota sobre personalização (se aplicável)",
                        available_additionals: [
                            {
                                id: "ID do adicional",
                                name: "Nome",
                                price: "Preço (número)",
                                price_display: "Preço formatado",
                                type: "Tipo",
                            },
                        ],
                        _ai_hints: {
                            priority_category: "Categoria de prioridade do produto no catálogo",
                            ideal_for: ["Ocasiões ideais para este produto"],
                            key_features: ["Características principais"],
                            price_range: "budget | standard | premium | luxury",
                        },
                    },
                ],
                _catalog_summary: {
                    price_range: {
                        min: "Preço mínimo do catálogo",
                        max: "Preço máximo do catálogo",
                        average: "Preço médio",
                    },
                    total_in_stock: "Produtos disponíveis em estoque",
                    total_with_customization: "Produtos personalizáveis",
                    categories_available: ["Categorias disponíveis no catálogo"],
                },
            },
            examples: [
                {
                    query: "Cliente procurando presente de aniversário romântico",
                    url: "/ai/products?keywords=aniversário romântico",
                },
                {
                    query: "Cliente quer algo barato com caneca",
                    url: "/ai/products?keywords=barato caneca",
                },
                {
                    query: "Cliente quer presente premium com quadro",
                    url: "/ai/products?keywords=premium quadro",
                },
                {
                    query: "Catálogo geral (sem preferências)",
                    url: "/ai/products",
                },
            ],
            notes: [
                "O campo 'image_url' SEMPRE está presente em cada produto",
                "Use '_instructions' para contextualizar informações ao cliente",
                "Verifique 'available' e 'stock_status' antes de recomendar",
                "Use '_ai_hints.ideal_for' para sugestões contextuais",
                "Combine múltiplas keywords para buscas mais precisas",
            ],
        });
    }
}
exports.default = new AIProductController();
