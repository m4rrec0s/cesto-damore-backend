"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupabaseConfigured = void 0;
const postgres_1 = __importDefault(require("postgres"));
// Configuração do cliente Postgres para o Supabase (n8n-paulo-automacao)
const connectionString = process.env.SUPABASE_N8N_DATABASE_URL;
if (!connectionString) {
    console.warn("⚠️ SUPABASE_N8N_DATABASE_URL não está configurada. Serviço de clientes n8n não estará disponível.");
}
// Cliente Postgres para o banco do n8n
const supabaseClient = connectionString
    ? (0, postgres_1.default)(connectionString, {
        max: 10, // Máximo de conexões no pool
        idle_timeout: 20, // Timeout de conexões ociosas
        connect_timeout: 10, // Timeout de conexão
    })
    : null;
exports.default = supabaseClient;
// Helper para verificar se o cliente está configurado
const isSupabaseConfigured = () => {
    return supabaseClient !== null;
};
exports.isSupabaseConfigured = isSupabaseConfigured;
