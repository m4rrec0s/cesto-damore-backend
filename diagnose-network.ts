// @ts-nocheck

import { execSync } from "child_process";
import postgres from "postgres";

// Testes de conectividade de rede
async function diagnosePgBouncerConnection() {
  console.log("🔍 Diagnosticando conexão com pgBouncer...\n");

  const hosts = [
    {
      name: "Supabase US-East-2 (pgBouncer)",
      host: "aws-1-us-east-2.pooler.supabase.com",
      port: 6543,
    },
    {
      name: "Supabase US-East-2 (Direto)",
      host: "aws-1-us-east-2.pooler.supabase.com",
      port: 5432,
    },
    {
      name: "Supabase SA-East-1 (pgBouncer)",
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: 6543,
    },
  ];

  for (const { name, host, port } of hosts) {
    console.log(`\n📡 Testando: ${name}`);
    console.log(`   Host: ${host}:${port}`);

    // Teste de resolução DNS
    try {
      console.log("   🔎 Resolvendo DNS...");
      const dnsResult = execSync(`nslookup ${host}`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      const ipMatch = dnsResult.match(/Address:\s+(\d+\.\d+\.\d+\.\d+)/g);
      if (ipMatch) {
        console.log(`   ✅ DNS: ${ipMatch[ipMatch.length - 1]}`);
      }
    } catch (error: any) {
      console.log(`   ❌ DNS falhou: ${error.message}`);
      continue;
    }

    // Teste de ping
    try {
      console.log("   🏓 Testando ping...");
      const pingResult = execSync(`ping -c 1 -W 2 ${host}`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      if (pingResult.includes("1 received")) {
        console.log("   ✅ Ping bem-sucedido");
      }
    } catch (error: any) {
      console.log("   ⚠️ Ping falhou (normal para alguns servidores)");
    }

    // Teste de conexão TCP
    try {
      console.log(`   🔌 Testando conexão TCP na porta ${port}...`);
      const ncResult = execSync(
        `timeout 5 bash -c "echo > /dev/tcp/${host}/${port}"`,
        {
          encoding: "utf-8",
          timeout: 6000,
        }
      );
      console.log("   ✅ Porta acessível");
    } catch (error: any) {
      console.log(`   ❌ Porta inacessível: ${error.message}`);
    }
  }
}

// Teste de conexão PostgreSQL com mais detalhes
async function testDetailedConnection() {
  console.log("\n\n🔍 Testando conexão PostgreSQL detalhada...\n");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL não configurada");
    return;
  }

  console.log(
    "📝 String de conexão:",
    connectionString.replace(/:[^:@]+@/, ":***@")
  );

  try {
    console.log("⏱️ Tentando conectar (timeout: 30s)...");
    const startTime = Date.now();

    const client = postgres(connectionString, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 30,
      debug: true,
    });

    const result = await client`SELECT 
      version() as version,
      current_database() as database,
      current_user as user,
      inet_server_addr() as server_ip,
      inet_server_port() as server_port
    `;

    const elapsed = Date.now() - startTime;

    console.log(`\n✅ Conexão bem-sucedida em ${elapsed}ms!`);
    console.log("📊 Informações do servidor:");
    console.log(`   Versão: ${result[0].version}`);
    console.log(`   Database: ${result[0].database}`);
    console.log(`   Usuário: ${result[0].user}`);
    console.log(`   IP do servidor: ${result[0].server_ip}`);
    console.log(`   Porta do servidor: ${result[0].server_port}`);

    await client.end();
  } catch (error: any) {
    console.error(`\n❌ Erro na conexão: ${error.message}`);
    console.error(`   Código: ${error.code || "N/A"}`);
    console.error(`   Stack: ${error.stack?.split("\n")[0]}`);
  }
}

// Verificar variáveis de ambiente
function checkEnvironment() {
  console.log("\n\n🔍 Verificando variáveis de ambiente...\n");

  const requiredVars = [
    "DATABASE_URL",
    "DIRECT_URL",
    "SUPABASE_N8N_DATABASE_URL",
  ];

  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (value) {
      const masked = value.replace(/:[^:@]+@/, ":***@");
      console.log(`✅ ${varName}:`);
      console.log(`   ${masked}`);
    } else {
      console.log(`❌ ${varName}: NÃO CONFIGURADA`);
    }
  }
}

// Função principal
async function main() {
  console.log("🚀 DIAGNÓSTICO COMPLETO DE CONECTIVIDADE\n");
  console.log("=".repeat(60));

  checkEnvironment();
  await diagnosePgBouncerConnection();
  await testDetailedConnection();

  console.log("\n" + "=".repeat(60));
  console.log("✅ Diagnóstico concluído!");
}

main().catch(console.error);
