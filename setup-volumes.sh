#!/bin/bash

# Script para configurar volumes do Docker na VPS
# Execute este script na VPS antes de fazer deploy

echo "🚀 Configurando volumes para persistência de dados..."

# Criar diretórios de dados
echo "📁 Criando diretórios..."
mkdir -p data/images
mkdir -p data/images/customizations
mkdir -p data/customizations/models
mkdir -p data/storage/temp

# Definir permissões
echo "🔐 Configurando permissões..."
chmod -R 755 data/

echo "✅ Diretórios criados com sucesso!"
echo ""
echo "📋 Estrutura criada:"
echo "   └── data/"
echo "       ├── images/"
echo "       │   └── customizations/"
echo "       ├── customizations/"
echo "       │   └── models/"
echo "       └── storage/"
echo "           └── temp/"
echo ""
echo "⚠️  IMPORTANTE: Se você tem imagens antigas, copie-as para data/images/"
echo ""
echo "Exemplo:"
echo "  cp -r images/* data/images/"
echo ""
