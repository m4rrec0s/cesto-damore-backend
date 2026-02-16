import { Product } from "./Product";

export interface Category {
  id: string;
  name: string;

  products?: Product[];
}

export type CreateCategoryInput = {
  name: string;
};
