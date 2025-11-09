#!/bin/bash
set -e

echo "=== Deployment Script ==="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"

# Verificar se NODE_VERSION está >= 20
NODE_MAJOR_VERSION=$(node --version | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR_VERSION" -lt 20 ]; then
    echo "ERROR: Node.js version must be >= 20.0.0"
    echo "Current version: $(node --version)"
    echo "Please update Node.js in your deployment platform settings"
    exit 1
fi

echo ""
echo "=== Installing Dependencies ==="
npm ci --omit=dev --prefer-offline

echo ""
echo "=== Generating Prisma Client ==="
npx prisma generate

echo ""
echo "=== Building Application ==="
npm run build

echo ""
echo "=== Verifying Build Output ==="
if [ ! -f "dist/server.js" ]; then
    echo "ERROR: Build failed - dist/server.js not found"
    exit 1
fi
if [ ! -f "dist/index.html" ]; then
    echo "ERROR: Build failed - dist/index.html not found"
    exit 1
fi
echo "✅ Build verified successfully"

echo ""
echo "=== Running Migrations ==="
npx prisma migrate deploy

echo ""
echo "=== Deployment Complete ==="
echo "Application is ready to start with: npm start"
