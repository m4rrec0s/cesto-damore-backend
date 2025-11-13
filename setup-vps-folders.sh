#!/bin/bash
# Script para criar as pastas necessárias na VPS (EasyPanel)
# Execute este script ANTES de fazer deploy

set -e

echo "📁 Criando estrutura de pastas para bind mounts..."

# Caminho base do projeto no EasyPanel
PROJECT_PATH="/etc/easypanel/projects/cesto_damore/cestodamore_api/code"

# Criar as pastas necessárias
mkdir -p "$PROJECT_PATH/images/customizations"
mkdir -p "$PROJECT_PATH/storage/temp"

# Definir permissões apropriadas
chmod -R 755 "$PROJECT_PATH/images"
chmod -R 755 "$PROJECT_PATH/storage"

echo "✅ Pastas criadas com sucesso:"
echo "   - $PROJECT_PATH/images/customizations"
echo "   - $PROJECT_PATH/storage/temp"

# Verificar se as pastas foram criadas
ls -la "$PROJECT_PATH/images"
ls -la "$PROJECT_PATH/storage"

echo ""
echo "🎯 Agora você pode fazer deploy do container!"
