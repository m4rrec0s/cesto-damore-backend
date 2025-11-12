#!/bin/bash

# Script para migrar imagens do Git para a pasta de dados do Docker
# Use este script se você tem imagens versionadas no Git que precisa migrar

echo "🔄 Migrando imagens para estrutura de volumes Docker..."
echo ""

# Verificar se a pasta data existe
if [ ! -d "data" ]; then
    echo "❌ Pasta 'data' não encontrada!"
    echo "Execute primeiro: ./setup-volumes.sh"
    exit 1
fi

# Contar imagens a migrar
if [ -d "images" ]; then
    IMAGE_COUNT=$(find images -type f | wc -l)
    echo "📊 Encontradas $IMAGE_COUNT imagens para migrar"
    echo ""
    
    # Copiar imagens
    echo "📦 Copiando imagens..."
    cp -rv images/* data/images/ 2>/dev/null || echo "⚠️  Nenhuma imagem na raiz encontrada"
    
    # Copiar customizações se existirem
    if [ -d "images/customizations" ]; then
        echo "📦 Copiando imagens de customização..."
        mkdir -p data/images/customizations
        cp -rv images/customizations/* data/images/customizations/ 2>/dev/null
    fi
else
    echo "⚠️  Pasta 'images' não encontrada no diretório atual"
fi

# Migrar modelos 3D se existirem
if [ -d "customizations/models" ]; then
    MODEL_COUNT=$(find customizations/models -type f | wc -l)
    echo "🎨 Encontrados $MODEL_COUNT modelos 3D para migrar"
    echo "📦 Copiando modelos 3D..."
    cp -rv customizations/models/* data/customizations/models/ 2>/dev/null || echo "⚠️  Nenhum modelo encontrado"
fi

echo ""
echo "✅ Migração concluída!"
echo ""
echo "📋 Resumo:"
echo "   - Imagens gerais: data/images/"
echo "   - Customizações: data/images/customizations/"
echo "   - Modelos 3D: data/customizations/models/"
echo ""
echo "🔍 Verificando arquivos migrados..."
echo "   Imagens gerais: $(find data/images -maxdepth 1 -type f 2>/dev/null | wc -l) arquivos"
echo "   Customizações: $(find data/images/customizations -type f 2>/dev/null | wc -l) arquivos"
echo "   Modelos 3D: $(find data/customizations/models -type f 2>/dev/null | wc -l) arquivos"
echo ""
echo "✨ Agora você pode fazer:"
echo "   1. docker-compose down"
echo "   2. docker-compose up -d"
echo ""
