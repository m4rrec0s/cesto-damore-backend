// @ts-nocheck

import postgres from "postgres";
import { PrismaClient } from "@prisma/client";

// Teste de conectividade com o banco Supabase via pgBouncer (porta 6543)
async function testSupabasePgBouncer() {
  console.log("🔍 Testando conexão com Supabase via pgBouncer (porta 6543)...");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL não configurada");
    return false;
  }

  try {
    const client = postgres(connectionString, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });

    const result = await client`SELECT version()`;
    console.log("✅ Conexão com Supabase (pgBouncer) bem-sucedida!");
    console.log("📊 Versão do PostgreSQL:", result[0].version);

    await client.end();
    return true;
  } catch (error: any) {
    console.error("❌ Erro na conexão via pgBouncer:", error.message);
    return false;
  }
}

// Teste de conectividade com o banco Supabase N8N via pgBouncer
async function testSupabaseN8NConnection() {
  console.log("🔍 Testando conexão com Supabase N8N via pgBouncer...");

  const connectionString = process.env.SUPABASE_N8N_DATABASE_URL;
  if (!connectionString) {
    console.error("❌ SUPABASE_N8N_DATABASE_URL não configurada");
    return false;
  }

  try {
    const client = postgres(connectionString, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });

    const result = await client`SELECT version()`;
    console.log("✅ Conexão com Supabase N8N bem-sucedida!");
    console.log("📊 Versão do PostgreSQL:", result[0].version);

    await client.end();
    return true;
  } catch (error: any) {
    console.error("❌ Erro na conexão com Supabase N8N:", error.message);
    return false;
  }
}

// Teste com Prisma Client
async function testPrismaConnection() {
  console.log("🔍 Testando conexão com Prisma Client...");

  try {
    const prisma = new PrismaClient();

    // Teste simples - contar usuários
    const userCount = await prisma.user.count();
    console.log("✅ Conexão com Prisma bem-sucedida!");
    console.log("👥 Total de usuários:", userCount);

    await prisma.$disconnect();
    return true;
  } catch (error: any) {
    console.error("❌ Erro na conexão com Prisma:", error.message);
    return false;
  }
}

// Função principal
async function main() {
  console.log("🚀 Iniciando testes de conectividade com bancos de dados...\n");

  const results = {
    pgBouncer: await testSupabasePgBouncer(),
    n8n: await testSupabaseN8NConnection(),
    prisma: await testPrismaConnection(),
  };

  console.log("\n📋 Resumo dos testes:");
  console.log(
    "Supabase pgBouncer (6543):",
    results.pgBouncer ? "✅ OK" : "❌ FALHA"
  );
  console.log("Supabase N8N (6543):", results.n8n ? "✅ OK" : "❌ FALHA");
  console.log("Prisma Client:", results.prisma ? "✅ OK" : "❌ FALHA");

  const allOk = Object.values(results).every((result) => result);
  if (allOk) {
    console.log("\n🎉 Todas as conexões estão funcionando!");
  } else {
    console.log("\n⚠️ Algumas conexões falharam. Verifique os logs acima.");
  }

  process.exit(allOk ? 0 : 1);
}

main().catch(console.error);
