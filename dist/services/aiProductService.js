"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
/**
 * Service especializado para consultas de produtos pela IA
 * Fornece respostas otimizadas e contextualizadas para agentes de IA
 */
class AIProductService {
    /**
     * Busca produtos com otimização para interpretação da IA
     * @param keywords - Palavras-chave para busca (ocasião, tipo, preço, etc)
     * @returns Lista de produtos formatada para IA
     */
    async searchProducts(keywords) {
        try {
            let products;
            if (keywords && keywords.trim()) {
                // Busca inteligente baseada em keywords
                products = await this.searchByKeywords(keywords);
            }
            else {
                // Ordem de prioridade padrão quando não há keywords
                products = await this.getDefaultPriority();
            }
            // Formatar resposta para IA
            return this.formatForAI(products);
        }
        catch (error) {
            throw new Error(`Erro ao buscar produtos para IA: ${error.message}`);
        }
    }
    /**
     * Busca produtos baseado em palavras-chave
     */
    async searchByKeywords(keywords) {
        const searchTerms = keywords.toLowerCase();
        // Mapeamento de ocasiões/contextos para categorias
        const occasionMap = {
            aniversario: ["aniversário", "festa", "celebração"],
            casamento: ["casamento", "noivos", "união"],
            namorados: ["namorados", "amor", "romântico"],
            maes: ["mães", "dia das mães", "maternal"],
            pais: ["pais", "dia dos pais", "paternal"],
            natal: ["natal", "natalino", "festas"],
            pascoa: ["páscoa", "chocolate"],
            formatura: ["formatura", "graduação"],
            "bebe nascimento": ["bebê", "nascimento", "maternidade"],
            agradecimento: ["obrigado", "gratidão", "agradecimento"],
            recuperacao: ["melhoras", "saúde", "recuperação"],
        };
        let categoryFilter = [];
        for (const [occasion, terms] of Object.entries(occasionMap)) {
            if (terms.some((term) => searchTerms.includes(term))) {
                categoryFilter = terms;
                break;
            }
        }
        let typeFilter = null;
        if (searchTerms.includes("quadro") ||
            searchTerms.includes("pelúcia") ||
            searchTerms.includes("pelucia")) {
            typeFilter = "premium";
        }
        else if (searchTerms.includes("caneca")) {
            typeFilter = "caneca";
        }
        let priceFilter = {};
        if (searchTerms.includes("barato") ||
            searchTerms.includes("economico") ||
            searchTerms.includes("em conta")) {
            priceFilter.max = 120;
        }
        else if (searchTerms.includes("caro") ||
            searchTerms.includes("premium") ||
            searchTerms.includes("luxo")) {
            priceFilter.min = 120;
        }
        const where = {
            is_active: true,
        };
        if (categoryFilter.length > 0) {
            where.OR = categoryFilter.map((term) => ({
                OR: [
                    { name: { contains: term, mode: "insensitive" } },
                    { description: { contains: term, mode: "insensitive" } },
                    {
                        categories: {
                            some: {
                                category: {
                                    name: { contains: term, mode: "insensitive" },
                                },
                            },
                        },
                    },
                ],
            }));
        }
        if (priceFilter.min || priceFilter.max) {
            where.price = {};
            if (priceFilter.min)
                where.price.gte = priceFilter.min;
            if (priceFilter.max)
                where.price.lte = priceFilter.max;
        }
        let products = await prisma_1.default.product.findMany({
            where,
            orderBy: [{ price: "desc" }],
            include: {
                categories: {
                    include: { category: true },
                },
                type: true,
                components: {
                    include: {
                        item: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                            },
                        },
                    },
                },
                additionals: {
                    include: {
                        additional: {
                            select: {
                                id: true,
                                name: true,
                                base_price: true,
                                type: true,
                            },
                        },
                    },
                },
            },
        });
        // Se não encontrou com filtros específicos, fazer busca genérica
        if (products.length === 0) {
            products = await prisma_1.default.product.findMany({
                where: {
                    is_active: true,
                    OR: [
                        { name: { contains: keywords, mode: "insensitive" } },
                        { description: { contains: keywords, mode: "insensitive" } },
                    ],
                },
                take: 10,
                orderBy: [{ price: "desc" }],
                include: {
                    categories: {
                        include: { category: true },
                    },
                    type: true,
                    components: {
                        include: {
                            item: {
                                select: {
                                    id: true,
                                    name: true,
                                    type: true,
                                },
                            },
                        },
                    },
                    additionals: {
                        include: {
                            additional: {
                                select: {
                                    id: true,
                                    name: true,
                                    base_price: true,
                                    type: true,
                                },
                            },
                        },
                    },
                },
            });
        }
        return products;
    }
    /**
     * Retorna produtos na ordem de prioridade padrão
     */
    async getDefaultPriority() {
        const priorities = [
            // 1. Mais cara com quadro/pelúcia
            {
                where: {
                    is_active: true,
                    components: {
                        some: {
                            item: {
                                OR: [
                                    { type: { contains: "quadro", mode: "insensitive" } },
                                    { type: { contains: "pelúcia", mode: "insensitive" } },
                                    { type: { contains: "pelucia", mode: "insensitive" } },
                                ],
                            },
                        },
                    },
                },
                orderBy: { price: "desc" },
                label: "premium_expensive",
            },
            // 2. Mais barata com quadro/pelúcia
            {
                where: {
                    is_active: true,
                    components: {
                        some: {
                            item: {
                                OR: [
                                    { type: { contains: "quadro", mode: "insensitive" } },
                                    { type: { contains: "pelúcia", mode: "insensitive" } },
                                    { type: { contains: "pelucia", mode: "insensitive" } },
                                ],
                            },
                        },
                    },
                },
                orderBy: { price: "asc" },
                label: "premium_affordable",
            },
            // 3. Mais cara com caneca
            {
                where: {
                    is_active: true,
                    components: {
                        some: {
                            item: {
                                type: { contains: "caneca", mode: "insensitive" },
                            },
                        },
                    },
                },
                orderBy: { price: "desc" },
                label: "mug_expensive",
            },
            // 4. Mais barata com outros itens
            {
                where: {
                    is_active: true,
                },
                orderBy: { price: "asc" },
                label: "affordable_general",
            },
        ];
        const allProducts = [];
        for (const priority of priorities) {
            const products = await prisma_1.default.product.findMany({
                where: priority.where,
                take: 3, // 3 de cada categoria
                orderBy: priority.orderBy,
                include: {
                    categories: {
                        include: { category: true },
                    },
                    type: true,
                    components: {
                        include: {
                            item: {
                                select: {
                                    id: true,
                                    name: true,
                                    type: true,
                                },
                            },
                        },
                    },
                    additionals: {
                        include: {
                            additional: {
                                select: {
                                    id: true,
                                    name: true,
                                    base_price: true,
                                    type: true,
                                },
                            },
                        },
                    },
                },
            });
            // Adicionar metadata de prioridade
            products.forEach((p) => {
                p._priority_category = priority.label;
            });
            allProducts.push(...products);
        }
        // Remover duplicatas
        const uniqueProducts = Array.from(new Map(allProducts.map((p) => [p.id, p])).values());
        return uniqueProducts;
    }
    /**
     * Formata resposta para fácil interpretação da IA
     */
    formatForAI(products) {
        const baseUrl = process.env.BASE_URL;
        return {
            total_products: products.length,
            products: products.map((product) => ({
                id: product.id,
                name: product.name,
                description: product.description || "Sem descrição disponível",
                // Preço final formatado
                price: this.formatPrice(this.calculateFinalPrice(product.price, product.discount || 0)),
                // Imagem (URL corrigida - sem duplicação)
                image_url: product.image_url
                    ? this.formatImageUrl(product.image_url, baseUrl)
                    : null,
                // Componentes formatados como lista
                components: this.formatComponentsList(product.components || []),
                // Disponibilidade simplificada
                available: product.is_active && product.stock_quantity !== 0,
                // Adicionais disponíveis (simplificado)
                additionals: product.additionals?.map((pa) => ({
                    name: pa.additional.name,
                    price: this.formatPrice(pa.custom_price || pa.additional.base_price),
                })) || [],
            })),
        };
    }
    /**
     * Formata lista de componentes como string
     */
    formatComponentsList(components) {
        if (!components || components.length === 0) {
            return "";
        }
        return components
            .map((c) => {
            const qty = c.quantity > 1 ? ` (${c.quantity}x)` : "";
            return `- ${c.item.name}${qty}`;
        })
            .join("\n");
    }
    /**
     * Calcula preço final com desconto
     */
    calculateFinalPrice(price, discount) {
        return price - price * (discount / 100);
    }
    /**
     * Formata preço para exibição
     */
    formatPrice(price) {
        return `R$ ${price.toFixed(2).replace(".", ",")}`;
    }
    /**
     * Formata URL da imagem, removendo duplicações
     */
    formatImageUrl(imageUrl, baseUrl) {
        if (imageUrl.startsWith("http")) {
            return imageUrl.replace(/\/images\/images\//g, "/images/");
        }
        return `${baseUrl}/images/${imageUrl}`;
    }
    /**
     * Identifica ocasiões ideais baseado em categorias e componentes
     */
    getIdealOccasions(product) {
        const occasions = [];
        const categories = product.categories?.map((pc) => pc.category.name.toLowerCase()) ||
            [];
        const description = (product.description || "").toLowerCase();
        const name = product.name.toLowerCase();
        const allText = [...categories, description, name].join(" ");
        // Mapeamento de ocasiões
        if (allText.includes("aniversário") ||
            allText.includes("aniversario") ||
            allText.includes("festa"))
            occasions.push("Aniversário");
        if (allText.includes("casamento") || allText.includes("noivos"))
            occasions.push("Casamento");
        if (allText.includes("namorados") || allText.includes("amor"))
            occasions.push("Dia dos Namorados");
        if (allText.includes("mães") || allText.includes("maes"))
            occasions.push("Dia das Mães");
        if (allText.includes("pais"))
            occasions.push("Dia dos Pais");
        if (allText.includes("natal"))
            occasions.push("Natal");
        if (allText.includes("páscoa") || allText.includes("pascoa"))
            occasions.push("Páscoa");
        if (allText.includes("formatura"))
            occasions.push("Formatura");
        if (allText.includes("bebê") || allText.includes("bebe"))
            occasions.push("Nascimento");
        // Ocasiões genéricas se não houver específicas
        if (occasions.length === 0) {
            occasions.push("Presente especial", "Demonstração de carinho");
        }
        return occasions;
    }
}
exports.default = new AIProductService();
