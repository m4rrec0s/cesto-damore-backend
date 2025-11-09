#!/bin/bash

# Script de deploy para Cesto d'Amore API
# Uso: ./deploy.sh [ambiente]
# Ambientes: dev, prod

set -e

ENVIRONMENT=${1:-prod}

echo "🧺 Cesto d'Amore - Deploy Script"
echo "=================================="
echo ""

if [ "$ENVIRONMENT" == "dev" ]; then
    echo "📦 Ambiente: DESENVOLVIMENTO"
    COMPOSE_FILE="docker-compose.dev.yml"
else
    echo "🚀 Ambiente: PRODUÇÃO"
    COMPOSE_FILE="docker-compose.yml"
fi

echo ""

# Verificar se .env existe
if [ ! -f .env ]; then
    echo "❌ Arquivo .env não encontrado!"
    echo "📋 Copie o .env.example e configure:"
    echo "   cp .env.example .env"
    exit 1
fi

echo "✅ Arquivo .env encontrado"

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker não está instalado!"
    exit 1
fi

echo "✅ Docker instalado"

# Verificar Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose não está instalado!"
    exit 1
fi

echo "✅ Docker Compose instalado"
echo ""

# Perguntar se quer fazer build
read -p "🔨 Fazer build da imagem? (s/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Ss]$ ]]; then
    echo "🔨 Fazendo build..."
    docker-compose -f $COMPOSE_FILE build --no-cache
    echo "✅ Build concluído"
fi

echo ""

# Iniciar containers
echo "🚀 Iniciando containers..."
docker-compose -f $COMPOSE_FILE up -d

echo ""
echo "✅ Containers iniciados!"
echo ""

# Aguardar inicialização
echo "⏳ Aguardando inicialização (10s)..."
sleep 10

# Verificar status
echo ""
echo "📊 Status dos containers:"
docker-compose -f $COMPOSE_FILE ps

echo ""
echo "📝 Para ver logs em tempo real:"
echo "   docker-compose -f $COMPOSE_FILE logs -f"
echo ""
echo "🛑 Para parar:"
echo "   docker-compose -f $COMPOSE_FILE down"
echo ""

# Testar endpoint
if [ "$ENVIRONMENT" == "prod" ]; then
    PORT=${PORT:-3333}
    echo "🔍 Testando endpoint..."
    if curl -s http://localhost:$PORT/ > /dev/null; then
        echo "✅ API está respondendo em http://localhost:$PORT"
    else
        echo "⚠️  API não está respondendo. Verifique os logs."
    fi
fi

echo ""
echo "🎉 Deploy concluído!"
