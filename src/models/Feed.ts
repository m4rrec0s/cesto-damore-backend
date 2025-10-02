export interface CreateFeedConfigurationInput {
  name: string;
  is_active?: boolean;
}

export interface UpdateFeedConfigurationInput {
  name?: string;
  is_active?: boolean;
}

export interface CreateFeedBannerInput {
  feed_config_id: string;
  title: string;
  subtitle?: string;
  image_url: string;
  link_url?: string;
  text_color?: string;
  is_active?: boolean;
  display_order?: number;
}

export interface UpdateFeedBannerInput {
  title?: string;
  subtitle?: string;
  image_url?: string;
  link_url?: string;
  text_color?: string;
  is_active?: boolean;
  display_order?: number;
}

export interface CreateFeedSectionInput {
  feed_config_id: string;
  title: string;
  section_type: FeedSectionType;
  is_visible?: boolean;
  display_order?: number;
  max_items?: number;
}

export interface UpdateFeedSectionInput {
  title?: string;
  section_type?: FeedSectionType;
  is_visible?: boolean;
  display_order?: number;
  max_items?: number;
}

export interface CreateFeedSectionItemInput {
  feed_section_id: string;
  item_type: "product" | "category" | "additional";
  item_id: string;
  display_order?: number;
  is_featured?: boolean;
  custom_title?: string;
  custom_subtitle?: string;
}

export interface UpdateFeedSectionItemInput {
  item_type?: "product" | "category" | "additional";
  item_id?: string;
  display_order?: number;
  is_featured?: boolean;
  custom_title?: string;
  custom_subtitle?: string;
}

export enum FeedSectionType {
  RECOMMENDED_PRODUCTS = "RECOMMENDED_PRODUCTS",
  DISCOUNTED_PRODUCTS = "DISCOUNTED_PRODUCTS",
  FEATURED_CATEGORIES = "FEATURED_CATEGORIES",
  FEATURED_ADDITIONALS = "FEATURED_ADDITIONALS",
  CUSTOM_PRODUCTS = "CUSTOM_PRODUCTS",
  NEW_ARRIVALS = "NEW_ARRIVALS",
  BEST_SELLERS = "BEST_SELLERS",
}

export interface FeedResponse {
  id: string;
  name: string;
  is_active: boolean;
  banners: FeedBannerResponse[];
  sections: FeedSectionResponse[];
}

export interface FeedBannerResponse {
  id: string;
  title: string;
  subtitle?: string;
  image_url: string;
  link_url?: string;
  text_color?: string;
  is_active: boolean;
  display_order: number;
}

export interface FeedSectionResponse {
  id: string;
  title: string;
  section_type: FeedSectionType;
  is_visible: boolean;
  display_order: number;
  max_items: number;
  items: FeedItemResponse[];
}

export interface FeedItemResponse {
  id: string;
  item_type: string;
  item_id: string;
  display_order: number;
  is_featured: boolean;
  custom_title?: string;
  custom_subtitle?: string;
  item_data?: any; // Dados do produto/categoria/adicional
}
