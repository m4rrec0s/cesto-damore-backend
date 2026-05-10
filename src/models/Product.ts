import { Additional } from "./Addtional";

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  stock_quantity?: number | null;
  is_active: boolean;
  image_url?: string | null;
  created_at: Date;
  updated_at: Date;
  discount?: number | null;
  type_id: string;
  production_time?: number | null;
  stock_mode?: "PRODUCT_ONLY" | "COMPONENTS_ONLY";
  categories: { category: { id: string; name: string } }[];
}

export type CreateProductInput = {
  name: string;
  description?: string | null;
  price: number;
  discount?: number | null;
  stock_quantity?: number | null;
  is_active?: boolean;
  image?: Express.Multer.File;
  type_id: string;
  production_time?: number | null;
  stock_mode?: "PRODUCT_ONLY" | "COMPONENTS_ONLY";
  categories: string[];
  additionals?: string[];
};
