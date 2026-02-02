#!/bin/sh
set -e

echo "🚀 Iniciando aplicação..."

# Garantir que os diretórios de storage existem e têm permissões de escrita
# Isso é importante quando volumes são montados via Easypanel/Docker
mkdir -p /usr/src/app/storage/temp
mkdir -p /usr/src/app/storage/final
mkdir -p /usr/src/app/images/customizations

# Ajustar permissões (777 garante que qualquer usuário no container ou host possa escrever, 
# útil em ambientes de desenvolvimento/easypanel com volumes mapeados)
chmod -R 777 /usr/src/app/storage
chmod -R 777 /usr/src/app/images

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
