#!/bin/sh
set -e

echo "🚀 Starting Cesto d'Amore API..."

# Verificar se DATABASE_URL está definido
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL is not set!"
    echo "Please check your environment variables in docker-compose.yml"
    exit 1
fi

echo "✅ DATABASE_URL is set"

# Gerar Prisma Client (caso não tenha sido gerado)
echo "📦 Generating Prisma Client..."
npx prisma generate

# Executar migrações
echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "✅ Migrations completed"

# Iniciar aplicação
echo "🎉 Starting application..."
exec "$@"
