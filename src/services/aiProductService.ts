import prisma from "../database/prisma";

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
  async searchProducts(keywords?: string) {
    try {
      let products;

      if (keywords && keywords.trim()) {
        // Busca inteligente baseada em keywords
        products = await this.searchByKeywords(keywords);
      } else {
        // Ordem de prioridade padrão quando não há keywords
        products = await this.getDefaultPriority();
      }

      // Formatar resposta para IA
      return this.formatForAI(products);
    } catch (error: any) {
      throw new Error(`Erro ao buscar produtos para IA: ${error.message}`);
    }
  }

  /**
   * Busca produtos baseado em palavras-chave
   */
  private async searchByKeywords(keywords: string) {
    const searchTerms = keywords.toLowerCase();

    // Mapeamento de ocasiões/contextos para categorias
    const occasionMap: { [key: string]: string[] } = {
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

    // Identificar ocasião
    let categoryFilter: string[] = [];
    for (const [occasion, terms] of Object.entries(occasionMap)) {
      if (terms.some((term) => searchTerms.includes(term))) {
        categoryFilter = terms;
        break;
      }
    }

    // Identificar tipo de produto preferencial
    let typeFilter: string | null = null;
    if (
      searchTerms.includes("quadro") ||
      searchTerms.includes("pelúcia") ||
      searchTerms.includes("pelucia")
    ) {
      typeFilter = "premium";
    } else if (searchTerms.includes("caneca")) {
      typeFilter = "caneca";
    }

    // Identificar faixa de preço
    let priceFilter: { min?: number; max?: number } = {};
    if (
      searchTerms.includes("barato") ||
      searchTerms.includes("economico") ||
      searchTerms.includes("em conta")
    ) {
      priceFilter.max = 120;
    } else if (
      searchTerms.includes("caro") ||
      searchTerms.includes("premium") ||
      searchTerms.includes("luxo")
    ) {
      priceFilter.min = 120;
    }

    // Construir query
    const where: any = {
      is_active: true,
    };

    // Filtro por categoria/ocasião
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

    // Filtro por preço
    if (priceFilter.min || priceFilter.max) {
      where.price = {};
      if (priceFilter.min) where.price.gte = priceFilter.min;
      if (priceFilter.max) where.price.lte = priceFilter.max;
    }

    // Buscar produtos
    let products = await prisma.product.findMany({
      where,
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

    // Se não encontrou com filtros específicos, fazer busca genérica
    if (products.length === 0) {
      products = await prisma.product.findMany({
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
  private async getDefaultPriority() {
    const priorities = [
      // 1. Mais cara com quadro/pelúcia
      {
        where: {
          is_active: true,
          components: {
            some: {
              item: {
                OR: [
                  { type: { contains: "quadro", mode: "insensitive" as any } },
                  { type: { contains: "pelúcia", mode: "insensitive" as any } },
                  { type: { contains: "pelucia", mode: "insensitive" as any } },
                ],
              },
            },
          },
        },
        orderBy: { price: "desc" as const },
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
                  { type: { contains: "quadro", mode: "insensitive" as any } },
                  { type: { contains: "pelúcia", mode: "insensitive" as any } },
                  { type: { contains: "pelucia", mode: "insensitive" as any } },
                ],
              },
            },
          },
        },
        orderBy: { price: "asc" as const },
        label: "premium_affordable",
      },
      // 3. Mais cara com caneca
      {
        where: {
          is_active: true,
          components: {
            some: {
              item: {
                type: { contains: "caneca", mode: "insensitive" as any },
              },
            },
          },
        },
        orderBy: { price: "desc" as const },
        label: "mug_expensive",
      },
      // 4. Mais barata com outros itens
      {
        where: {
          is_active: true,
        },
        orderBy: { price: "asc" as const },
        label: "affordable_general",
      },
    ];

    const allProducts = [];

    for (const priority of priorities) {
      const products = await prisma.product.findMany({
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
      products.forEach((p: any) => {
        p._priority_category = priority.label;
      });

      allProducts.push(...products);
    }

    // Remover duplicatas
    const uniqueProducts = Array.from(
      new Map(allProducts.map((p) => [p.id, p])).values()
    );

    return uniqueProducts;
  }

  /**
   * Formata resposta para fácil interpretação da IA
   */
  private formatForAI(products: any[]) {
    const baseUrl = process.env.BASE_URL;

    return {
      total_products: products.length,
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description || "Sem descrição disponível",

        // Preço final formatado
        price: this.formatPrice(
          this.calculateFinalPrice(product.price, product.discount || 0)
        ),

        // Imagem (URL corrigida - sem duplicação)
        image_url: product.image_url
          ? this.formatImageUrl(product.image_url, baseUrl)
          : null,

        // Componentes formatados como lista
        components: this.formatComponentsList(product.components || []),

        // Disponibilidade simplificada
        available: product.is_active && product.stock_quantity !== 0,

        // Adicionais disponíveis (simplificado)
        additionals:
          product.additionals?.map((pa: any) => ({
            name: pa.additional.name,
            price: this.formatPrice(
              pa.custom_price || pa.additional.base_price
            ),
          })) || [],
      })),
    };
  }

  /**
   * Formata lista de componentes como string
   */
  private formatComponentsList(components: any[]): string {
    if (!components || components.length === 0) {
      return "";
    }

    return components
      .map((c: any) => {
        const qty = c.quantity > 1 ? ` (${c.quantity}x)` : "";
        return `- ${c.item.name}${qty}`;
      })
      .join("\n");
  }

  /**
   * Calcula preço final com desconto
   */
  private calculateFinalPrice(price: number, discount: number): number {
    return price - price * (discount / 100);
  }

  /**
   * Formata preço para exibição
   */
  private formatPrice(price: number): string {
    return `R$ ${price.toFixed(2).replace(".", ",")}`;
  }

  /**
   * Formata URL da imagem, removendo duplicações
   */
  private formatImageUrl(
    imageUrl: string,
    baseUrl: string | undefined
  ): string {
    // Se já é uma URL completa
    if (imageUrl.startsWith("http")) {
      // Remover duplicações de /api/ ou /images/
      return imageUrl
        .replace(/\/api\/api\//g, "/api/")
        .replace(/\/images\/images\//g, "/images/");
    }

    // Construir URL completa
    return `${baseUrl}/images/${imageUrl}`;
  }

  /**
   * Identifica ocasiões ideais baseado em categorias e componentes
   */
  private getIdealOccasions(product: any): string[] {
    const occasions: string[] = [];
    const categories =
      product.categories?.map((pc: any) => pc.category.name.toLowerCase()) ||
      [];
    const description = (product.description || "").toLowerCase();
    const name = product.name.toLowerCase();

    const allText = [...categories, description, name].join(" ");

    // Mapeamento de ocasiões
    if (
      allText.includes("aniversário") ||
      allText.includes("aniversario") ||
      allText.includes("festa")
    )
      occasions.push("Aniversário");
    if (allText.includes("casamento") || allText.includes("noivos"))
      occasions.push("Casamento");
    if (allText.includes("namorados") || allText.includes("amor"))
      occasions.push("Dia dos Namorados");
    if (allText.includes("mães") || allText.includes("maes"))
      occasions.push("Dia das Mães");
    if (allText.includes("pais")) occasions.push("Dia dos Pais");
    if (allText.includes("natal")) occasions.push("Natal");
    if (allText.includes("páscoa") || allText.includes("pascoa"))
      occasions.push("Páscoa");
    if (allText.includes("formatura")) occasions.push("Formatura");
    if (allText.includes("bebê") || allText.includes("bebe"))
      occasions.push("Nascimento");

    // Ocasiões genéricas se não houver específicas
    if (occasions.length === 0) {
      occasions.push("Presente especial", "Demonstração de carinho");
    }

    return occasions;
  }
}

export default new AIProductService();
