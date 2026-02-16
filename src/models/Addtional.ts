export interface Additional {
  id: string;
  name: string;
  description: string;
  price: number;

  compatible_with?: string | null;
  image_url?: string;
  created_at: Date;
  updated_at: Date;
}
