import postgres from "postgres";

// Configuração do cliente Postgres para o Supabase (n8n-paulo-automacao)
const connectionString = process.env.SUPABASE_N8N_DATABASE_URL;

if (!connectionString) {
  console.warn(
    "⚠️ SUPABASE_N8N_DATABASE_URL não está configurada. Serviço de clientes n8n não estará disponível."
  );
}

// Cliente Postgres para o banco do n8n
const supabaseClient = connectionString
  ? postgres(connectionString, {
      max: 10, // Máximo de conexões no pool
      idle_timeout: 20, // Timeout de conexões ociosas
      connect_timeout: 10, // Timeout de conexão
    })
  : null;

export default supabaseClient;

// Helper para verificar se o cliente está configurado
export const isSupabaseConfigured = (): boolean => {
  return supabaseClient !== null;
};
