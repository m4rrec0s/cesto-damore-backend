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

  type_id: string;

  // Additionals linked to this product (array of Additional objects)
  additionals?: Additional[];
  // Categories linked to this product
  categories: { category: { id: string; name: string } }[];
}

export type CreateProductInput = {
  name: string;
  description?: string | null;
  price: number;
  stock_quantity?: number | null;
  is_active?: boolean;
  image?: Express.Multer.File;
  type_id: string;
  categories: string[];
  additionals?: string[]; // array of additional ids to link
};
