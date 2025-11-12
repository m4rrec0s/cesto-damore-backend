#!/bin/bash

echo "🔍 DIAGNÓSTICO DE IMAGENS - Cesto d'Amore API"
echo "=============================================="
echo ""

# Encontrar o container
CONTAINER_ID=$(docker ps | grep cestodamore_api | awk '{print $1}')

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ Container não encontrado!"
    echo "Containers rodando:"
    docker ps
    exit 1
fi

echo "✅ Container encontrado: $CONTAINER_ID"
echo ""

# Executar diagnóstico dentro do container
docker exec $CONTAINER_ID sh -c '
echo "📁 WORKING DIRECTORY (process.cwd()):"
pwd
echo ""

echo "📂 ESTRUTURA DE PASTAS:"
ls -la | grep -E "images|customizations|storage"
echo ""

echo "📸 CONTAGEM DE IMAGENS:"
echo "   - Em /code/images: $(find /code/images -maxdepth 1 -type f 2>/dev/null | wc -l) arquivos"
echo "   - Em ./images: $(find ./images -maxdepth 1 -type f 2>/dev/null | wc -l) arquivos"
echo ""

echo "📍 ÚLTIMAS 3 IMAGENS MODIFICADAS EM /code/images:"
find /code/images -maxdepth 1 -type f -printf "%T@ %p\n" 2>/dev/null | sort -rn | head -3 | while read timestamp file; do
    date -d @${timestamp%.*} "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Data não disponível"
    echo "   $file"
done
echo ""

echo "🔧 VARIÁVEIS DE AMBIENTE:"
echo "   NODE_ENV: $NODE_ENV"
echo "   BASE_URL: $BASE_URL"
echo ""

echo "📦 VERIFICANDO PERMISSÕES:"
ls -ld /code/images 2>/dev/null
ls -ld ./images 2>/dev/null
echo ""

echo "💾 ESPAÇO EM DISCO:"
df -h | grep -E "Filesystem|code"
echo ""

echo "🔍 VERIFICANDO PROCESSO NODE:"
ps aux | grep node | grep -v grep
'

echo ""
echo "=============================================="
echo "✅ Diagnóstico concluído!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Verifique se process.cwd() está apontando para /code"
echo "   2. Verifique as permissões da pasta images"
echo "   3. Veja se as imagens novas aparecem nas últimas modificadas"
