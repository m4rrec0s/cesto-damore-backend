#!/bin/sh
set -e

echo "🚀 Iniciando aplicação..."

# Criar diretórios necessários
echo "📁 Criando diretórios de armazenamento..."
mkdir -p /code/images
mkdir -p /code/images/customizations
mkdir -p /code/customizations/models
mkdir -p /code/storage/temp

# Definir permissões
chmod -R 755 /code/images
chmod -R 755 /code/customizations
chmod -R 755 /code/storage

echo "✅ Diretórios criados com sucesso"

# Executar migrações do Prisma (se necessário)
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "🔄 Executando migrações do banco de dados..."
  npx prisma migrate deploy
  echo "✅ Migrações concluídas"
fi

# Gerar Prisma Client
echo "🔧 Gerando Prisma Client..."
npx prisma generate
echo "✅ Prisma Client gerado"

# Iniciar aplicação
echo "🎯 Iniciando servidor..."
exec node dist/server.js
