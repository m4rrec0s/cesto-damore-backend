#!/bin/bash
# Script para criar a estrutura de pastas na VPS (EasyPanel)
# Execute este script UMA VEZ antes do primeiro deploy

set -e

echo "📁 Configurando estrutura de pastas para Cesto d'Amore API..."

# Caminho base do projeto no EasyPanel
BASE_PATH="/etc/easypanel/projects/cesto_damore/cestodamore_api"

echo ""
echo "📍 Estrutura que será criada:"
echo "   $BASE_PATH/"
echo "   ├── code/          (gerenciado pelo Git)"
echo "   ├── images/        (persistente, bind mount)"
echo "   │   └── customizations/"
echo "   └── storage/       (persistente, bind mount)"
echo "       └── temp/"
echo ""

# Criar as pastas FORA do diretório code
mkdir -p "$BASE_PATH/images/customizations"
mkdir -p "$BASE_PATH/storage/temp"

# Definir permissões apropriadas
chmod -R 755 "$BASE_PATH/images"
chmod -R 755 "$BASE_PATH/storage"

echo "✅ Pastas criadas com sucesso!"
echo ""

# Verificar estrutura
echo "📋 Verificando estrutura criada:"
ls -la "$BASE_PATH"
echo ""
echo "📋 Conteúdo de images/:"
ls -la "$BASE_PATH/images"
echo ""
echo "📋 Conteúdo de storage/:"
ls -la "$BASE_PATH/storage"

echo ""
echo "🎯 Setup concluído!"
echo ""
echo "⚠️  IMPORTANTE:"
echo "   - A pasta 'code/' será gerenciada pelo Git (EasyPanel)"
echo "   - As pastas 'images/' e 'storage/' são PERSISTENTES"
echo "   - Elas NÃO serão afetadas por git pull/deploy"
echo "   - Faça backup regular dessas pastas!"
echo ""
echo "🚀 Agora você pode fazer deploy no EasyPanel!"
