#!/bin/bash
# Script de diagnóstico para verificar bind mounts e armazenamento

echo "🔍 DIAGNÓSTICO - Cesto d'Amore API"
echo "=================================="
echo ""

# 1. Verificar variáveis de ambiente
echo "📋 1. Variáveis de Ambiente:"
echo "   NODE_ENV: $NODE_ENV"
echo "   BASE_URL: $BASE_URL"
echo ""

# 2. Verificar se as pastas existem no container
echo "📁 2. Estrutura de pastas no container:"
echo "   /app/images:"
if [ -d "/app/images" ]; then
    echo "      ✅ Existe"
    ls -la /app/images | head -10
else
    echo "      ❌ NÃO EXISTE!"
fi
echo ""

echo "   /app/storage:"
if [ -d "/app/storage" ]; then
    echo "      ✅ Existe"
    ls -la /app/storage | head -10
else
    echo "      ❌ NÃO EXISTE!"
fi
echo ""

# 3. Verificar permissões
echo "🔐 3. Permissões:"
if [ -d "/app/images" ]; then
    echo "   /app/images:"
    stat -c "      Permissões: %a (%A)" /app/images
    stat -c "      Dono: %U:%G" /app/images
fi
echo ""

# 4. Verificar bind mounts
echo "🔗 4. Bind Mounts (df):"
df -h | grep -E "/app|Filesystem"
echo ""

# 5. Verificar conteúdo da pasta images
echo "📸 5. Arquivos em /app/images:"
if [ -d "/app/images" ]; then
    COUNT=$(find /app/images -type f | wc -l)
    echo "   Total de arquivos: $COUNT"
    if [ $COUNT -gt 0 ]; then
        echo "   Últimos 5 arquivos:"
        find /app/images -type f -printf "      %f (%s bytes)\n" | tail -5
    fi
else
    echo "   ❌ Diretório não existe"
fi
echo ""

# 6. Testar escrita
echo "✍️ 6. Teste de escrita:"
TEST_FILE="/app/images/test-$(date +%s).txt"
echo "teste" > "$TEST_FILE" 2>&1
if [ -f "$TEST_FILE" ]; then
    echo "   ✅ Escrita bem-sucedida: $TEST_FILE"
    rm "$TEST_FILE"
else
    echo "   ❌ Falha ao escrever em /app/images"
fi
echo ""

# 7. Verificar processos Node
echo "🔄 7. Processos Node:"
ps aux | grep node | grep -v grep
echo ""

# 8. Verificar working directory
echo "📂 8. Working Directory:"
pwd
echo ""

echo "=================================="
echo "✅ Diagnóstico concluído!"
