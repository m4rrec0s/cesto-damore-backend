export interface Additional {
  id: string;
  name: string;
  description: string;
  price: number;
  // no banco está como string opcional; aqui aceitamos string (armazenada como CSV) ou array ao usar a camada de serviço
  compatible_with?: string | null;
  image_url?: string;
  created_at: Date;
  updated_at: Date;
}
