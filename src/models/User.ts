export interface User {
  id: string;
  name: string;
  email: string;
  firebaseUId?: string | null;
  image_url?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  created_at: Date;
  updated_at: Date;
}

export type CreateUserInput = {
  name: string;
  email: string;
  firebaseUId?: string | null;
  image_url?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
};
