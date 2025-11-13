#!/bin/sh
set -e

echo "🚀 Iniciando aplicação..."

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
