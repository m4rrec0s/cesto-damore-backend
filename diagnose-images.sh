#!/bin/bash

echo "🔍 DIAGNÓSTICO DE IMAGENS - Cesto d'Amore API"
echo "=============================================="
echo ""

# Encontrar o container
CONTAINER_ID=$(docker ps --filter "name=cestodamore" --format "{{.ID}}" | head -n 1)

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ Container não encontrado!"
    echo "Procurando por qualquer container relacionado..."
    docker ps
    exit 1
fi

CONTAINER_NAME=$(docker ps --filter "id=$CONTAINER_ID" --format "{{.Names}}")
echo "✅ Container encontrado: $CONTAINER_NAME ($CONTAINER_ID)"
echo ""

# Executar diagnóstico dentro do container
echo "📁 Executando diagnóstico dentro do container..."
docker exec $CONTAINER_ID sh -c '
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "� WORKING DIRECTORY (process.cwd()):"
pwd
echo ""

echo "� ESTRUTURA DE PASTAS:"
ls -lah | grep -E "images|customizations|storage|dist|node_modules"
echo ""

echo "📸 IMAGENS ENCONTRADAS:"
if [ -d "/code/images" ]; then
    IMAGE_COUNT=$(find /code/images -maxdepth 1 -type f 2>/dev/null | wc -l)
    echo "   ✓ Pasta /code/images existe"
    echo "   ✓ Total de arquivos: $IMAGE_COUNT"
    echo ""
    
    echo "� Últimas 10 imagens:"
    ls -lht /code/images/*.webp 2>/dev/null | head -10
    echo ""
    
    echo "🔍 Verificando imagens específicas com erro:"
    for img in "1762900684479-3bb3c6c42c66-download_2.webp" "1761835388483-4911f4031f00-Cesta-Pelucia_dAmore.webp" "1761834303948-Cesta-Super_Cesta_Caneca.webp"; do
        if [ -f "/code/images/$img" ]; then
            echo "   ✓ $img EXISTE"
            ls -lh "/code/images/$img"
        else
            echo "   ✗ $img NÃO ENCONTRADO"
        fi
    done
else
    echo "   ✗ Pasta /code/images NÃO EXISTE!"
fi
echo ""

echo "📁 PERMISSÕES:"
ls -ld /code/images 2>/dev/null || echo "   ✗ /code/images não existe"
echo ""

echo "🔧 VARIÁVEIS DE AMBIENTE:"
echo "   NODE_ENV: $NODE_ENV"
echo "   BASE_URL: $BASE_URL"
echo ""

echo "� ESPAÇO EM DISCO:"
df -h /code
echo ""

echo "� PROCESSO NODE:"
ps aux | grep node | grep -v grep
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
'

echo ""
echo "� VERIFICANDO VOLUMES NO HOST:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verificar mounts do container
echo "🔗 Volumes montados no container:"
docker inspect $CONTAINER_ID | grep -A 20 "Mounts" | head -25

echo ""
echo "=============================================="
echo "✅ Diagnóstico concluído!"
echo ""
echo "� PRÓXIMOS PASSOS:"
echo "   1. Se a pasta /code/images não existe, o volume não está montado"
echo "   2. Se as imagens existem mas retorna 404, verificar a rota no código"
echo "   3. Se as imagens não existem, precisa configurar volume persistente"
echo ""
