import { Product } from "./Product";

export interface Category {
  id: string;
  name: string;
  // relation
  products?: Product[];
}

export type CreateCategoryInput = {
  name: string;
};
