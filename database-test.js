#!/usr/bin/env node

/**
 * Script de diagnóstico para testar conexão com banco de dados
 * Execute com: node database-test.js
 */

const { Client } = require('pg');

async function testDatabaseConnection() {
    console.log('🔍 Testando conexão com banco de dados...\n');

    // Configurações de conexão (mesmas do .env)
    const connectionString = "postgresql://postgres.cldevcilflpgfvhpmjjx:nft!LcxKPS8Q-c8@aws-1-us-east-1.pooler.supabase.com:5432/postgres";

    const client = new Client({
        connectionString,
        connectionTimeoutMillis: 5000, // 5 segundos timeout
    });

    try {
        console.log('⏳ Tentando conectar...');
        await client.connect();

        console.log('✅ Conexão estabelecida com sucesso!\n');

        // Testar uma query simples
        console.log('📊 Testando query...');
        const result = await client.query('SELECT version()');
        console.log('✅ Query executada com sucesso!');
        console.log('📋 Versão do PostgreSQL:', result.rows[0].version.split(' ')[1]);

        // Verificar se tabelas existem
        console.log('\n📋 Verificando tabelas...');
        const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

        if (tablesResult.rows.length > 0) {
            console.log('✅ Tabelas encontradas:');
            tablesResult.rows.forEach(row => {
                console.log(`  - ${row.table_name}`);
            });
        } else {
            console.log('⚠️  Nenhuma tabela encontrada no schema public');
        }

    } catch (error) {
        console.error('❌ Erro na conexão:');
        console.error('📋 Detalhes:', error.message);

        if (error.code === 'ENOTFOUND') {
            console.log('\n💡 Possível causa: Host não encontrado');
            console.log('🔧 Soluções:');
            console.log('  - Verificar conexão com internet');
            console.log('  - Verificar se o domínio está correto');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 Possível causa: Porta bloqueada ou serviço parado');
            console.log('🔧 Soluções:');
            console.log('  - Verificar se o Supabase está ativo');
            console.log('  - Verificar firewall/antivírus');
        } else if (error.code === '28P01') {
            console.log('\n💡 Possível causa: Credenciais inválidas');
            console.log('🔧 Soluções:');
            console.log('  - Verificar DATABASE_URL no .env');
            console.log('  - Resetar senha no Supabase');
        } else {
            console.log('\n💡 Causas possíveis:');
            console.log('  - Servidor temporariamente indisponível');
            console.log('  - Problemas de rede');
            console.log('  - Limite de conexões excedido');
        }

    } finally {
        await client.end();
    }

    console.log('\n🏁 Teste concluído');
}

// Executar teste
testDatabaseConnection().catch(console.error);