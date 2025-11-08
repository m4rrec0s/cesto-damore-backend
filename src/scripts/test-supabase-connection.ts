/**
 * Script para testar a conexão com o Supabase (banco n8n)
 *
 * Execute: npx ts-node src/scripts/test-supabase-connection.ts
 */

import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

async function testConnection() {
  console.log("🔍 Testando conexão com Supabase (n8n)...\n");

  const connectionString = process.env.SUPABASE_N8N_DATABASE_URL;

  if (!connectionString) {
    console.error("❌ SUPABASE_N8N_DATABASE_URL não está configurada no .env");
    process.exit(1);
  }

  console.log("📋 URL de conexão:");
  // Mostrar URL sem senha
  const urlWithoutPassword = connectionString.replace(
    /postgresql:\/\/([^:]+):([^@]+)@/,
    "postgresql://$1:***@"
  );
  console.log(urlWithoutPassword);
  console.log();

  let sql: any = null;

  try {
    console.log("🔌 Tentando conectar...");
    sql = postgres(connectionString, {
      max: 1,
      connect_timeout: 10,
    });

    // Testar conexão simples
    console.log("✅ Conexão estabelecida!");
    console.log();

    // Listar tabelas disponíveis
    console.log("📊 Listando tabelas disponíveis:");
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    if (tables.length === 0) {
      console.log("⚠️  Nenhuma tabela encontrada no schema public");
    } else {
      tables.forEach((table: any) => {
        console.log(`  - ${table.table_name}`);
      });
    }
    console.log();

    // Verificar se a tabela clientes existe
    const clientesTable = tables.find((t: any) => t.table_name === "clientes");

    if (clientesTable) {
      console.log("✅ Tabela 'clientes' encontrada!");
      console.log();

      // Mostrar estrutura da tabela
      console.log("📋 Estrutura da tabela 'clientes':");
      const columns = await sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'clientes'
        ORDER BY ordinal_position
      `;

      columns.forEach((col: any) => {
        console.log(
          `  - ${col.column_name} (${col.data_type}) ${
            col.is_nullable === "NO" ? "NOT NULL" : "NULL"
          }`
        );
      });
      console.log();

      // Contar registros
      const count = await sql`SELECT COUNT(*) as total FROM clientes`;
      console.log(`📊 Total de clientes: ${count[0].total}`);
      console.log();

      // Mostrar alguns exemplos (se houver)
      if (parseInt(count[0].total) > 0) {
        console.log("📝 Exemplos de registros (primeiros 3):");
        const examples = await sql`
          SELECT * FROM clientes 
          ORDER BY last_message_sent DESC NULLS LAST
          LIMIT 3
        `;

        examples.forEach((cliente: any, index: number) => {
          console.log(`\n  Registro ${index + 1}:`);
          console.log(`    Number: ${cliente.number}`);
          console.log(`    Name: ${cliente.name || "(vazio)"}`);
          console.log(`    Follow-up: ${cliente.follow_up ? "✓" : "✗"}`);
          console.log(
            `    Already Customer: ${cliente.already_a_customer ? "✓" : "✗"}`
          );
          console.log(`    Status: ${cliente.service_status || "(vazio)"}`);
        });
      }
    } else {
      console.log("❌ Tabela 'clientes' NÃO encontrada!");
      console.log();
      console.log("💡 Dica: Verifique se:");
      console.log("   1. A URL está apontando para o banco correto");
      console.log(
        "   2. A tabela existe no projeto Supabase 'n8n-paulo-automacao'"
      );
    }

    console.log("\n✅ Teste concluído com sucesso!");
  } catch (error: any) {
    console.error("\n❌ Erro ao conectar com o banco:");
    console.error(error.message);
    console.log();
    console.log("💡 Possíveis causas:");
    console.log("   1. Host incorreto na URL de conexão");
    console.log("   2. Senha incorreta");
    console.log("   3. Firewall bloqueando a conexão");
    console.log("   4. Projeto Supabase não existe ou está pausado");
    console.log();
    console.log("🔧 Ações recomendadas:");
    console.log("   1. Acesse https://supabase.com/dashboard");
    console.log("   2. Abra o projeto 'n8n-paulo-automacao'");
    console.log("   3. Vá em Settings > Database > Connection string");
    console.log("   4. Copie a URI correta e atualize o .env");
    process.exit(1);
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}

testConnection();
