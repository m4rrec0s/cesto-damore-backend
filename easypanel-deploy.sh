#!/bin/sh
set -e

echo "🚀 Easypanel Deployment Script"
echo "Working directory: $(pwd)"
echo "Node version: $(node --version)"

# Instalar dependências
echo "📦 Installing dependencies..."
npm ci --prefer-offline

# Gerar Prisma Client
echo "🔧 Generating Prisma Client..."
npx prisma generate

# Build da aplicação
echo "🏗️ Building application..."
npm run build

# Executar migrações
echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "✅ Deployment completed successfully!"
