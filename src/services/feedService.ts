import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import {
  CreateFeedConfigurationInput,
  UpdateFeedConfigurationInput,
  CreateFeedBannerInput,
  UpdateFeedBannerInput,
  CreateFeedSectionInput,
  UpdateFeedSectionInput,
  CreateFeedSectionItemInput,
  UpdateFeedSectionItemInput,
  FeedSectionType,
  FeedResponse,
  FeedSectionResponse,
} from "../models/Feed";
import { deleteProductImage } from "../config/localStorage";

class FeedService {
  // ============== FEED CONFIGURATION METHODS ==============

  async getAllFeedConfigurations() {
    try {
      const configurations = await withRetry(() =>
        prisma.feedConfiguration.findMany({
          include: {
            banners: {
              where: { is_active: true },
              orderBy: { display_order: "asc" },
            },
            sections: {
              where: { is_visible: true },
              orderBy: { display_order: "asc" },
              include: {
                items: {
                  orderBy: { display_order: "asc" },
                },
              },
            },
          },
          orderBy: { created_at: "desc" },
        })
      );

      return configurations.map((config) =>
        this.formatFeedConfigurationResponse(config)
      );
    } catch (error: any) {
      throw new Error(`Erro ao buscar configurações de feed: ${error.message}`);
    }
  }

  async getFeedConfigurationById(id: string) {
    if (!id) {
      throw new Error("ID da configuração de feed é obrigatório");
    }

    try {
      const configuration = await withRetry(() =>
        prisma.feedConfiguration.findUnique({
          where: { id },
          include: {
            banners: {
              orderBy: { display_order: "asc" },
            },
            sections: {
              orderBy: { display_order: "asc" },
              include: {
                items: {
                  orderBy: { display_order: "asc" },
                },
              },
            },
          },
        })
      );

      if (!configuration) {
        throw new Error("Configuração de feed não encontrada");
      }

      return this.formatFeedConfigurationResponse(configuration);
    } catch (error: any) {
      if (error.message.includes("não encontrada")) {
        throw error;
      }
      throw new Error(`Erro ao buscar configuração de feed: ${error.message}`);
    }
  }

  async createFeedConfiguration(data: CreateFeedConfigurationInput) {
    if (!data.name || data.name.trim() === "") {
      throw new Error("Nome da configuração é obrigatório");
    }

    try {
      const configuration = await withRetry(() =>
        prisma.feedConfiguration.create({
          data: {
            name: data.name.trim(),
            is_active: data.is_active ?? true,
          },
        })
      );

      return this.getFeedConfigurationById(configuration.id);
    } catch (error: any) {
      throw new Error(`Erro ao criar configuração de feed: ${error.message}`);
    }
  }

  async updateFeedConfiguration(
    id: string,
    data: UpdateFeedConfigurationInput
  ) {
    if (!id) {
      throw new Error("ID da configuração é obrigatório");
    }

    // Verifica se existe
    await this.getFeedConfigurationById(id);

    try {
      const updateData: any = {};

      if (data.name !== undefined) updateData.name = data.name.trim();
      if (data.is_active !== undefined) updateData.is_active = data.is_active;

      await prisma.feedConfiguration.update({
        where: { id },
        data: updateData,
      });

      return this.getFeedConfigurationById(id);
    } catch (error: any) {
      throw new Error(
        `Erro ao atualizar configuração de feed: ${error.message}`
      );
    }
  }

  async deleteFeedConfiguration(id: string) {
    if (!id) {
      throw new Error("ID da configuração é obrigatório");
    }

    const configuration = await this.getFeedConfigurationById(id);

    try {
      // Deletar imagens dos banners
      for (const banner of configuration.banners) {
        if (banner.image_url) {
          await deleteProductImage(banner.image_url);
        }
      }

      await prisma.feedConfiguration.delete({
        where: { id },
      });

      return { message: "Configuração de feed deletada com sucesso" };
    } catch (error: any) {
      throw new Error(`Erro ao deletar configuração de feed: ${error.message}`);
    }
  }

  // ============== FEED BANNER METHODS ==============

  async createFeedBanner(data: CreateFeedBannerInput) {
    if (!data.feed_config_id) {
      throw new Error("ID da configuração de feed é obrigatório");
    }
    if (!data.title || data.title.trim() === "") {
      throw new Error("Título do banner é obrigatório");
    }
    if (!data.image_url) {
      throw new Error("Imagem do banner é obrigatória");
    }

    try {
      // Verifica se a configuração existe
      await this.getFeedConfigurationById(data.feed_config_id);

      const banner = await prisma.feedBanner.create({
        data: {
          feed_config_id: data.feed_config_id,
          title: data.title.trim(),
          subtitle: data.subtitle?.trim(),
          image_url: data.image_url,
          link_url: data.link_url?.trim(),
          text_color: data.text_color ?? "#FFFFFF",
          is_active: data.is_active ?? true,
          display_order: data.display_order ?? 0,
        },
      });

      return banner;
    } catch (error: any) {
      throw new Error(`Erro ao criar banner: ${error.message}`);
    }
  }

  async updateFeedBanner(id: string, data: UpdateFeedBannerInput) {
    if (!id) {
      throw new Error("ID do banner é obrigatório");
    }

    try {
      const currentBanner = await prisma.feedBanner.findUnique({
        where: { id },
      });

      if (!currentBanner) {
        throw new Error("Banner não encontrado");
      }

      const updateData: any = {};

      if (data.title !== undefined) updateData.title = data.title.trim();
      if (data.subtitle !== undefined)
        updateData.subtitle = data.subtitle?.trim();
      if (data.image_url !== undefined) {
        // Deletar imagem anterior se for diferente
        if (
          currentBanner.image_url &&
          data.image_url !== currentBanner.image_url
        ) {
          await deleteProductImage(currentBanner.image_url);
        }
        updateData.image_url = data.image_url;
      }
      if (data.link_url !== undefined)
        updateData.link_url = data.link_url?.trim();
      if (data.text_color !== undefined)
        updateData.text_color = data.text_color;
      if (data.is_active !== undefined) updateData.is_active = data.is_active;
      if (data.display_order !== undefined)
        updateData.display_order = data.display_order;

      const updatedBanner = await prisma.feedBanner.update({
        where: { id },
        data: updateData,
      });

      return updatedBanner;
    } catch (error: any) {
      throw new Error(`Erro ao atualizar banner: ${error.message}`);
    }
  }

  async deleteFeedBanner(id: string) {
    if (!id) {
      throw new Error("ID do banner é obrigatório");
    }

    try {
      const banner = await prisma.feedBanner.findUnique({
        where: { id },
      });

      if (!banner) {
        throw new Error("Banner não encontrado");
      }

      // Deletar imagem
      if (banner.image_url) {
        await deleteProductImage(banner.image_url);
      }

      await prisma.feedBanner.delete({
        where: { id },
      });

      return { message: "Banner deletado com sucesso" };
    } catch (error: any) {
      throw new Error(`Erro ao deletar banner: ${error.message}`);
    }
  }

  // ============== FEED SECTION METHODS ==============

  async createFeedSection(data: CreateFeedSectionInput) {
    if (!data.feed_config_id) {
      throw new Error("ID da configuração de feed é obrigatório");
    }
    if (!data.title || data.title.trim() === "") {
      throw new Error("Título da seção é obrigatório");
    }
    if (!data.section_type) {
      throw new Error("Tipo da seção é obrigatório");
    }

    try {
      // Verifica se a configuração existe
      await this.getFeedConfigurationById(data.feed_config_id);

      const section = await prisma.feedSection.create({
        data: {
          feed_config_id: data.feed_config_id,
          title: data.title.trim(),
          section_type: data.section_type,
          is_visible: data.is_visible ?? true,
          display_order: data.display_order ?? 0,
        },
      });

      return section;
    } catch (error: any) {
      throw new Error(`Erro ao criar seção: ${error.message}`);
    }
  }

  async updateFeedSection(id: string, data: UpdateFeedSectionInput) {
    if (!id) {
      throw new Error("ID da seção é obrigatório");
    }

    try {
      const section = await prisma.feedSection.findUnique({
        where: { id },
      });

      if (!section) {
        throw new Error("Seção não encontrada");
      }

      const updateData: any = {};

      if (data.title !== undefined) updateData.title = data.title.trim();
      if (data.section_type !== undefined)
        updateData.section_type = data.section_type;
      if (data.is_visible !== undefined)
        updateData.is_visible = data.is_visible;
      if (data.display_order !== undefined)
        updateData.display_order = data.display_order;
      if (data.max_items !== undefined) updateData.max_items = data.max_items;

      const updatedSection = await prisma.feedSection.update({
        where: { id },
        data: updateData,
      });

      return updatedSection;
    } catch (error: any) {
      throw new Error(`Erro ao atualizar seção: ${error.message}`);
    }
  }

  async deleteFeedSection(id: string) {
    if (!id) {
      throw new Error("ID da seção é obrigatório");
    }

    try {
      const section = await prisma.feedSection.findUnique({
        where: { id },
      });

      if (!section) {
        throw new Error("Seção não encontrada");
      }

      await prisma.feedSection.delete({
        where: { id },
      });

      return { message: "Seção deletada com sucesso" };
    } catch (error: any) {
      throw new Error(`Erro ao deletar seção: ${error.message}`);
    }
  }

  // ============== FEED SECTION ITEM METHODS ==============

  async createFeedSectionItem(data: CreateFeedSectionItemInput) {
    if (!data.feed_section_id) {
      throw new Error("ID da seção é obrigatório");
    }
    if (!data.item_type) {
      throw new Error("Tipo do item é obrigatório");
    }
    if (!data.item_id) {
      throw new Error("ID do item é obrigatório");
    }

    try {
      // Verifica se a seção existe
      const section = await prisma.feedSection.findUnique({
        where: { id: data.feed_section_id },
      });

      if (!section) {
        throw new Error("Seção não encontrada");
      }

      // Verifica se o item existe
      await this.validateItemExists(data.item_type, data.item_id);

      const item = await prisma.feedSectionItem.create({
        data: {
          feed_section_id: data.feed_section_id,
          item_type: data.item_type,
          item_id: data.item_id,
          display_order: data.display_order ?? 0,
          is_featured: data.is_featured ?? false,
          custom_title: data.custom_title?.trim(),
          custom_subtitle: data.custom_subtitle?.trim(),
        },
      });

      return item;
    } catch (error: any) {
      throw new Error(`Erro ao criar item da seção: ${error.message}`);
    }
  }

  async updateFeedSectionItem(id: string, data: UpdateFeedSectionItemInput) {
    if (!id) {
      throw new Error("ID do item é obrigatório");
    }

    try {
      const item = await prisma.feedSectionItem.findUnique({
        where: { id },
      });

      if (!item) {
        throw new Error("Item não encontrado");
      }

      const updateData: any = {};

      if (data.item_type !== undefined && data.item_id !== undefined) {
        await this.validateItemExists(data.item_type, data.item_id);
        updateData.item_type = data.item_type;
        updateData.item_id = data.item_id;
      } else if (data.item_type !== undefined || data.item_id !== undefined) {
        throw new Error("item_type e item_id devem ser fornecidos juntos");
      }

      if (data.display_order !== undefined)
        updateData.display_order = data.display_order;
      if (data.is_featured !== undefined)
        updateData.is_featured = data.is_featured;
      if (data.custom_title !== undefined)
        updateData.custom_title = data.custom_title?.trim();
      if (data.custom_subtitle !== undefined)
        updateData.custom_subtitle = data.custom_subtitle?.trim();

      const updatedItem = await prisma.feedSectionItem.update({
        where: { id },
        data: updateData,
      });

      return updatedItem;
    } catch (error: any) {
      throw new Error(`Erro ao atualizar item da seção: ${error.message}`);
    }
  }

  async deleteFeedSectionItem(id: string) {
    if (!id) {
      throw new Error("ID do item é obrigatório");
    }

    try {
      const item = await prisma.feedSectionItem.findUnique({
        where: { id },
      });

      if (!item) {
        throw new Error("Item não encontrado");
      }

      await prisma.feedSectionItem.delete({
        where: { id },
      });

      return { message: "Item deletado com sucesso" };
    } catch (error: any) {
      throw new Error(`Erro ao deletar item: ${error.message}`);
    }
  }

  // ============== PUBLIC FEED METHOD ==============

  async getPublicFeed(configId?: string, page?: number, perPage?: number) {
    try {
      let feedConfig;

      if (configId) {
        feedConfig = await withRetry(() =>
          prisma.feedConfiguration.findUnique({
            where: { id: configId, is_active: true },
            include: {
              banners: {
                where: {
                  is_active: true,
                },
                orderBy: { display_order: "asc" },
              },
              sections: {
                where: { is_visible: true },
                orderBy: { display_order: "asc" },
                include: {
                  items: {
                    orderBy: { display_order: "asc" },
                  },
                },
              },
            },
          })
        );
      } else {
        // Pegar a primeira configuração ativa
        feedConfig = await withRetry(() =>
          prisma.feedConfiguration.findFirst({
            where: { is_active: true },
            include: {
              banners: {
                where: {
                  is_active: true,
                },
                orderBy: { display_order: "asc" },
              },
              sections: {
                where: { is_visible: true },
                orderBy: { display_order: "asc" },
                include: {
                  items: {
                    orderBy: { display_order: "asc" },
                  },
                },
              },
            },
            orderBy: { created_at: "desc" },
          })
        );
      }

      if (!feedConfig) {
        throw new Error("Nenhuma configuração de feed ativa encontrada");
      }

      const sections = feedConfig.sections || [];

      if (page === undefined || perPage === undefined) {
        const enrichedSections = await Promise.all(
          feedConfig.sections.map(async (section) => {
            const enrichedItems = await this.enrichSectionItems(section);
            return {
              ...section,
              section_type: section.section_type as FeedSectionType,
              max_items: (section as any).max_items ?? 6,
              items: enrichedItems,
            };
          })
        );

        return {
          id: feedConfig.id,
          name: feedConfig.name,
          is_active: feedConfig.is_active,
          banners: feedConfig.banners,
          sections: enrichedSections,
        };
      }

      const pageNum = Math.max(1, Math.floor(Number(page) || 1));
      const perPageNum = Math.max(1, Math.floor(Number(perPage) || 3));
      const startIndex = (pageNum - 1) * perPageNum;
      const endIndex = startIndex + perPageNum;

      const paginatedSections = sections.slice(startIndex, endIndex);
      const enrichedSectionsPaginated: FeedSectionResponse[] =
        await Promise.all(
          paginatedSections.map(async (section) => {
            const enrichedItems = await this.enrichSectionItems(section);
            return {
              ...section,
              section_type: section.section_type as FeedSectionType,
              max_items: (section as any).max_items ?? 6,
              items: enrichedItems,
            };
          })
        );

      const response = this.formatFeedConfigurationResponse(feedConfig);
      response.banners = pageNum === 1 ? response.banners : [];
      response.sections = enrichedSectionsPaginated;
      (response as any).pagination = {
        totalSections: sections.length,
        page: pageNum,
        perPage: perPageNum,
      };

      return response;
    } catch (error: any) {
      throw new Error(`Erro ao buscar feed público: ${error.message}`);
    }
  }

  // ============== PRIVATE HELPER METHODS ==============

  private formatFeedConfigurationResponse(config: any): FeedResponse {
    return {
      id: config.id,
      name: config.name,
      is_active: config.is_active,
      banners: config.banners || [],
      sections: config.sections || [],
    };
  }

  private async validateItemExists(
    itemType: string,
    itemId: string
  ): Promise<void> {
    try {
      switch (itemType) {
        case "product":
          const product = await prisma.product.findUnique({
            where: { id: itemId },
          });
          if (!product) {
            throw new Error(`Produto com ID ${itemId} não encontrado`);
          }
          break;
        case "category":
          const category = await prisma.category.findUnique({
            where: { id: itemId },
          });
          if (!category) {
            throw new Error(`Categoria com ID ${itemId} não encontrada`);
          }
          break;
        case "additional":
          const additional = await prisma.item.findUnique({
            where: { id: itemId },
          });
          if (!additional) {
            throw new Error(`Adicional com ID ${itemId} não encontrado`);
          }
          break;
        default:
          throw new Error(`Tipo de item inválido: ${itemType}`);
      }
    } catch (error: any) {
      throw error;
    }
  }

  private async enrichSectionItems(section: any) {
    // Se tem itens manuais, usar eles
    if (section.items && section.items.length > 0) {
      return await Promise.all(
        section.items.map(async (item: any) => {
          const itemData = await this.getItemData(item.item_type, item.item_id);
          return {
            ...item,
            item_data: itemData,
          };
        })
      );
    }

    // Senão, preencher automaticamente baseado no tipo da seção
    return await this.getAutomaticSectionItems(section);
  }

  private async getItemData(itemType: string, itemId: string) {
    switch (itemType) {
      case "product":
        return await withRetry(() =>
          prisma.product.findUnique({
            where: { id: itemId },
            include: {
              type: true,
              categories: { include: { category: true } },
            },
          })
        );
      case "category":
        return await withRetry(() =>
          prisma.category.findUnique({
            where: { id: itemId },
          })
        );
      case "additional":
        return await withRetry(() =>
          prisma.item.findUnique({
            where: { id: itemId },
          })
        );
      default:
        return null;
    }
  }

  private async getAutomaticSectionItems(section: any) {
    const maxItems = section.max_items || 6;

    switch (section.section_type) {
      case FeedSectionType.RECOMMENDED_PRODUCTS:
        const recommendedProducts = await withRetry(() =>
          prisma.product.findMany({
            where: { is_active: true },
            include: {
              type: true,
              categories: { include: { category: true } },
            },
            orderBy: { created_at: "desc" },
            take: maxItems,
          })
        );
        return recommendedProducts.map((product, index) => ({
          id: `auto_${product.id}`,
          item_type: "product",
          item_id: product.id,
          display_order: index,
          is_featured: false,
          item_data: product,
        }));

      case FeedSectionType.DISCOUNTED_PRODUCTS:
        const discountedProducts = await withRetry(() =>
          prisma.product.findMany({
            where: {
              is_active: true,
              discount: { gt: 0 },
            },
            include: {
              type: true,
              categories: { include: { category: true } },
            },
            orderBy: { discount: "desc" },
            take: maxItems,
          })
        );
        return discountedProducts.map((product, index) => ({
          id: `auto_${product.id}`,
          item_type: "product",
          item_id: product.id,
          display_order: index,
          is_featured: false,
          item_data: product,
        }));

      case FeedSectionType.FEATURED_CATEGORIES:
        const categories = await withRetry(() =>
          prisma.category.findMany({
            take: maxItems,
            orderBy: { name: "asc" },
          })
        );
        return categories.map((category, index) => ({
          id: `auto_${category.id}`,
          item_type: "category",
          item_id: category.id,
          display_order: index,
          is_featured: false,
          item_data: category,
        }));

      case FeedSectionType.FEATURED_ADDITIONALS:
        const additionals = await withRetry(() =>
          prisma.item.findMany({
            where: { type: "additional" },
            take: maxItems,
            orderBy: { created_at: "desc" },
          })
        );
        return additionals.map((additional, index) => ({
          id: `auto_${additional.id}`,
          item_type: "additional",
          item_id: additional.id,
          display_order: index,
          is_featured: false,
          item_data: additional,
        }));

      case FeedSectionType.NEW_ARRIVALS:
        const newProducts = await withRetry(() =>
          prisma.product.findMany({
            where: { is_active: true },
            include: {
              type: true,
              categories: { include: { category: true } },
            },
            orderBy: { created_at: "desc" },
            take: maxItems,
          })
        );
        return newProducts.map((product, index) => ({
          id: `auto_${product.id}`,
          item_type: "product",
          item_id: product.id,
          display_order: index,
          is_featured: false,
          item_data: product,
        }));

      default:
        return [];
    }
  }
}

export default new FeedService();
