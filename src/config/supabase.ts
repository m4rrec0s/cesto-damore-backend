import postgres from "postgres";
import logger from "../utils/logger";

const connectionString = process.env.SUPABASE_N8N_DATABASE_URL;

if (!connectionString) {
  logger.warn(
    "⚠️ SUPABASE_N8N_DATABASE_URL não está configurada. Serviço de clientes n8n não estará disponível."
  );
}

const supabaseClient = connectionString
  ? postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

export default supabaseClient;

export const isSupabaseConfigured = (): boolean => {
  return supabaseClient !== null;
};
