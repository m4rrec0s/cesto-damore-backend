import prisma from "../database/prisma";

class AIProductService {
  async getLightweightProducts(query?: any) {
    try {
      // Extrair parâmetros de busca
      const {
        keywords,
        occasion,
        price_max,
        tag,
        available,
        q,
      } = query || {};

      // Construir filtro base
      const where: any = {
        is_active: true,
        type: { name: { equals: "Cestas", mode: "insensitive" } }
      };

      // Filtro de texto (keywords ou q)
      const searchTerm = keywords || q;
      if (searchTerm) {
        where.OR = [
          { name: { contains: searchTerm, mode: "insensitive" } },
          { description: { contains: searchTerm, mode: "insensitive" } },
          {
            categories: {
              some: {
                category: { name: { contains: searchTerm, mode: "insensitive" } },
              },
            },
          },
        ];
      }

      // Filtro de ocasião
      if (occasion) {
        const occasionTerm = occasion.replace(/-/g, " ");
        const occasionFilter = {
          OR: [
            {
              categories: {
                some: {
                  category: {
                    name: { contains: occasionTerm, mode: "insensitive" },
                  },
                },
              },
            },
            { name: { contains: occasionTerm, mode: "insensitive" } },
            { description: { contains: occasionTerm, mode: "insensitive" } },
          ],
        };

        if (where.OR) {
          where.AND = [occasionFilter];
        } else {
          Object.assign(where, occasionFilter);
        }
      }

      // Filtro de preço máximo
      if (price_max) {
        where.price = { lte: parseFloat(price_max) };
      }

      // Filtro de tag
      if (tag) {
        const tagTerm = tag.replace(/-/g, " ");
        const tagFilter = {
          OR: [
            {
              components: {
                some: {
                  item: {
                    OR: [
                      { name: { contains: tagTerm, mode: "insensitive" } },
                      { type: { contains: tagTerm, mode: "insensitive" } },
                    ],
                  },
                },
              },
            },
            { name: { contains: tagTerm, mode: "insensitive" } },
          ],
        };

        if (where.AND) {
          where.AND.push(tagFilter);
        } else if (where.OR) {
          where.AND = [tagFilter];
        } else {
          Object.assign(where, tagFilter);
        }
      }

      // Filtro de disponibilidade
      if (available === "true") {
        where.stock_quantity = { gt: 0 };
      }

      const products = await prisma.product.findMany({
        where,
        orderBy: { price: "asc" },
        include: {
          categories: { include: { category: true } },
          type: true,
          components: {
            include: {
              item: true,
            },
          },
          additionals: {
            include: {
              additional: true,
            },
          },
        },
      });

      const baseUrl = process.env.BASE_URL as string;

      const lightweightProducts = products.map((p) => {
        const occasions = this.getIdealOccasions(p);
        const tags = this.generateTags(p, occasions);
        const slug = this.toSlug(p.name);

        const componentsList = p.components.map((c) => {
          const qty = c.quantity > 1 ? `${c.quantity}x ` : "";
          return `${qty}${c.item.name}`;
        });

        const additionalsList = p.additionals.map((pa) => ({
          name: pa.additional.name,
          price: this.formatPrice(pa.custom_price || pa.additional.base_price),
        }));

        let customizationTitle = null;
        if (p.allows_customization) {
          customizationTitle = "Personalização disponível";
          if (p.type?.name.toLowerCase().includes("quadro")) {
            customizationTitle = "Envio de foto para o quadro";
          } else if (p.type?.name.toLowerCase().includes("caneca")) {
            customizationTitle = "Nome ou frase para a caneca";
          }
        }

        return {
          id: p.id,
          name: p.name,
          description: p.description || "Sem descrição disponível", // Descrição completa
          price: p.price,
          final_price: this.calculateFinalPrice(p.price, p.discount || 0),
          image: p.image_url ? this.formatImageUrl(p.image_url, baseUrl) : null,
          category: p.type?.name || "Outros", // Usando o Tipo como categoria principal visual
          real_categories: p.categories.map((c) => c.category.name), // Categorias reais
          occasion: occasions[0]?.toLowerCase() || "geral",
          tags: tags,
          allows_customization: p.allows_customization,
          customization_title: customizationTitle,
          components: componentsList,
          has_additionals: p.additionals.length > 0,
          additionals: additionalsList,
          detail_endpoint: `/ai/products/detail/${slug}`, // Usando slug
        };
      });

      // Ordenação personalizada em memória
      // 1. Produtos mais caros - Contendo Quadro/Pelúcias/Polaroides
      // 2. Produtos mais baratos - Contendo Quadro/Pelúcias/Polaroides
      // 3. Produtos mais caros - Contendo Caneca/Quebra-Cabeça
      // 4. Mais baratos de forma geral

      const premiumKeywords = ["quadro", "pelucia", "pelúcia", "polaroid"];
      const standardKeywords = ["caneca", "quebra-cabeça", "quebra-cabeca"];

      const hasKeyword = (p: any, keywords: string[]) => {
        const text = (
          p.name +
          " " +
          (p.description || "") +
          " " +
          p.components.map((c: any) => c.item.name).join(" ")
        ).toLowerCase();
        return keywords.some((k) => text.includes(k));
      };

      const premiumProducts: any[] = [];
      const standardProducts: any[] = [];
      const otherProducts: any[] = [];

      lightweightProducts.forEach((p: any) => {
        // Precisamos checar os dados originais para a busca de keywords, 
        // mas lightweightProducts já está formatado. 
        // Vamos usar o objeto formatado mesmo, pois ele tem name, description e components (nomes).

        // Reconstruindo verificação baseada no objeto formatado
        const text = (
          p.name + " " + p.description + " " + p.components.join(" ")
        ).toLowerCase();

        const isPremium = premiumKeywords.some(k => text.includes(k));
        const isStandard = standardKeywords.some(k => text.includes(k));

        if (isPremium) {
          premiumProducts.push(p);
        } else if (isStandard) {
          standardProducts.push(p);
        } else {
          otherProducts.push(p);
        }
      });

      // Ordenar grupos
      // Premium: DESC (Mais caro -> Mais barato)
      premiumProducts.sort((a, b) => b.price - a.price);

      // Standard: DESC (Mais caro -> Mais barato)
      standardProducts.sort((a, b) => b.price - a.price);

      // Outros: ASC (Mais barato -> Mais caro)
      otherProducts.sort((a, b) => a.price - b.price);

      const sortedProducts = [
        ...premiumProducts,
        ...standardProducts,
        ...otherProducts
      ];

      // Gerar filtros dinâmicos
      const filters = {
        occasions: [
          "aniversario",
          "namorados",
          "dia-das-maes",
          "natal",
          "formatura",
          "agradecimento",
          "nascimento",
        ],
        price_ranges: ["0-100", "100-150", "150-200", "200-300", "300+"],
        tags: [
          "caneca",
          "pelucia",
          "quebra-cabeca",
          "quadro",
          "polaroid",
          "balao",
          "flores",
          "chocolate",
        ],
      };

      return {
        products: sortedProducts,
        filters,
      };
    } catch (error: any) {
      throw new Error(`Erro ao buscar produtos leves: ${error.message}`);
    }
  }


  async getProductDetail(idOrSlug: string) {
    try {
      let productId = idOrSlug;

      // Se não for UUID, tentar encontrar pelo slug
      if (!this.isUUID(idOrSlug)) {
        const foundId = await this.findIdBySlug(idOrSlug);
        if (!foundId) {
          throw new Error(`Produto não encontrado para o slug: ${idOrSlug}`);
        }
        productId = foundId;
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          categories: { include: { category: true } },
          type: true,
          components: {
            include: {
              item: true,
            },
          },
          additionals: {
            include: {
              additional: {
                include: {
                  customizations: true,
                },
              },
            },
          },
        },
      });

      if (!product) {
        throw new Error("Produto não encontrado");
      }

      const baseUrl = process.env.BASE_URL as string;

      return {
        id: product.id,
        name: product.name,
        slug: this.toSlug(product.name),
        description: product.description,
        base_price: product.price,
        final_price: this.calculateFinalPrice(
          product.price,
          product.discount || 0
        ),
        image: product.image_url
          ? this.formatImageUrl(product.image_url, baseUrl)
          : null,
        stock: product.stock_quantity,
        included_components: product.components.map((c) => {
          const qty = c.quantity > 1 ? `${c.quantity}x ` : "";
          return `${qty}${c.item.name}`;
        }),
        optional_additionals: product.additionals.map((pa) => ({
          id: pa.additional.id,
          name: pa.additional.name,
          price: pa.custom_price || pa.additional.base_price,
          formatted_price: this.formatPrice(
            pa.custom_price || pa.additional.base_price
          ),
          image: pa.additional.image_url
            ? this.formatImageUrl(pa.additional.image_url, baseUrl)
            : null,
          requires_photo:
            pa.additional.type === "quadro" ||
            pa.additional.type === "polaroid" ||
            pa.additional.name.toLowerCase().includes("foto"),
          customization_type:
            pa.additional.customizations.length > 0
              ? "configurable"
              : "simple",
        })),
      };
    } catch (error: any) {
      throw new Error(`Erro ao buscar detalhe do produto: ${error.message}`);
    }
  }

  /**
   * Busca produtos com otimização para ferramentas de IA (tool calling)
   */
  async searchProducts(query: any) {
    try {
      const {
        keywords,
        occasion,
        price_max,
        tag,
        has_custom_photo,
        available,
        q,
      } = query;

      const where: any = { is_active: true, type: { name: { equals: "Cestas", mode: "insensitive" } } };

      // Filtro de texto (keywords ou q)
      const searchTerm = keywords || q;
      if (searchTerm) {
        where.OR = [
          { name: { contains: searchTerm, mode: "insensitive" } },
          { description: { contains: searchTerm, mode: "insensitive" } },
          {
            categories: {
              some: {
                category: { name: { contains: searchTerm, mode: "insensitive" } },
              },
            },
          },
        ];
      }

      // Filtro de ocasião
      if (occasion) {
        const occasionTerm = occasion.replace(/-/g, " ");
        const occasionFilter = {
          OR: [
            {
              is_active: true,
              type: { name: { equals: "Cestas", mode: "insensitive" } },
              categories: {
                some: {
                  category: {
                    name: { contains: occasionTerm, mode: "insensitive" },
                  },
                },
              },
            },
            { name: { contains: occasionTerm, mode: "insensitive" } },
            { description: { contains: occasionTerm, mode: "insensitive" } },
          ],
        };

        if (where.OR) {
          where.AND = [occasionFilter];
        } else {
          Object.assign(where, occasionFilter);
        }
      }

      // Filtro de preço máximo
      if (price_max) {
        where.price = { lte: parseFloat(price_max) };
      }

      // Filtro de tag
      if (tag) {
        const tagTerm = tag.replace(/-/g, " ");
        const tagFilter = {
          OR: [
            {
              components: {
                some: {
                  item: {
                    OR: [
                      { name: { contains: tagTerm, mode: "insensitive" } },
                      { type: { name: { equals: "Cestas", mode: "insensitive" } } },
                    ],
                  },
                },
              },
            },
            { name: { contains: tagTerm, mode: "insensitive" } },
          ],
        };

        if (where.AND) {
          where.AND.push(tagFilter);
        } else if (where.OR) {
          where.AND = [tagFilter];
        } else {
          Object.assign(where, tagFilter);
        }
      }

      if (available === "true") {
        where.stock_quantity = { gt: 0 };
      }

      const products = await prisma.product.findMany({
        where,
        orderBy: { price: "asc" },
        select: {
          id: true,
          name: true,
          price: true,
          image_url: true,
          description: true,
        },
      });

      const baseUrl = process.env.BASE_URL as string;

      return {
        results: products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          image: p.image_url ? this.formatImageUrl(p.image_url, baseUrl) : null,
          match_score: searchTerm ? 0.95 : 1.0,
        })),
      };
    } catch (error: any) {
      throw new Error(`Erro na busca de produtos IA: ${error.message}`);
    }
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================

  private toSlug(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .replace(/[^\w\s-]/g, "") // Remove caracteres especiais
      .replace(/\s+/g, "-") // Substitui espaços por hífens
      .replace(/^-+|-+$/g, ""); // Remove hífens do início/fim
  }

  private isUUID(str: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  private async findIdBySlug(slug: string): Promise<string | null> {
    // Como slugs não estão no banco, buscamos todos e filtramos
    // Para catálogos pequenos (<1000 itens) isso é performático o suficiente
    const products = await prisma.product.findMany({
      where: { is_active: true, type: { name: { equals: "Cestas", mode: "insensitive" } } },
      select: { id: true, name: true },
    });

    const match = products.find((p) => this.toSlug(p.name) === slug);
    return match ? match.id : null;
  }

  private generateTags(product: any, occasions: string[]): string[] {
    const tags = new Set<string>();

    // Adiciona ocasiões como tags
    occasions.forEach((o) =>
      tags.add(
        o
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, "-")
      )
    );

    // Adiciona tipo do produto
    if (product.type?.name) {
      tags.add(product.type.name.toLowerCase());
    }

    const nameKeywords = product.name.toLowerCase().split(" ");
    if (nameKeywords.includes("caneca")) tags.add("caneca");
    if (nameKeywords.includes("chocolate")) tags.add("chocolate");
    if (nameKeywords.includes("pelúcia") || nameKeywords.includes("pelucia"))
      tags.add("pelucia");
    if (nameKeywords.includes("quadro")) tags.add("quadro");

    return Array.from(tags);
  }

  private calculateFinalPrice(price: number, discount: number): number {
    return Number((price - price * (discount / 100)).toFixed(2));
  }

  private formatImageUrl(imageUrl: string, baseUrl: string): string {
    if (imageUrl.startsWith("http")) {
      return imageUrl.replace(/\/images\/images\//g, "/images/");
    }
    return `${baseUrl}/images/${imageUrl}`;
  }

  private formatPrice(price: number): string {
    return `R$ ${price.toFixed(2).replace(".", ",")}`;
  }

  private getIdealOccasions(product: any): string[] {
    const occasions: string[] = [];
    const categories =
      product.categories?.map((pc: any) => pc.category.name.toLowerCase()) ||
      [];
    const description = (product.description || "").toLowerCase();
    const name = product.name.toLowerCase();

    const allText = [...categories, description, name].join(" ");

    if (
      allText.includes("aniversário") ||
      allText.includes("aniversario") ||
      allText.includes("festa")
    )
      occasions.push("Aniversario");
    if (allText.includes("casamento") || allText.includes("noivos"))
      occasions.push("Casamento");
    if (allText.includes("namorados") || allText.includes("amor"))
      occasions.push("Namorados");
    if (allText.includes("mães") || allText.includes("maes"))
      occasions.push("Dia-das-Maes");
    if (allText.includes("pais")) occasions.push("Dia-dos-Pais");
    if (allText.includes("natal")) occasions.push("Natal");
    if (allText.includes("páscoa") || allText.includes("pascoa"))
      occasions.push("Pascoa");
    if (allText.includes("formatura")) occasions.push("Formatura");
    if (allText.includes("bebê") || allText.includes("bebe"))
      occasions.push("Nascimento");

    if (occasions.length === 0) {
      occasions.push("Geral");
    }

    return occasions;
  }
}

export default new AIProductService();
