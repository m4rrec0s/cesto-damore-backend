@echo off
REM Script de deploy para Cesto d'Amore API (Windows)
REM Uso: deploy.bat [ambiente]
REM Ambientes: dev, prod

setlocal enabledelayedexpansion

set ENVIRONMENT=%1
if "%ENVIRONMENT%"=="" set ENVIRONMENT=prod

echo 🧺 Cesto d'Amore - Deploy Script
echo ==================================
echo.

if "%ENVIRONMENT%"=="dev" (
    echo 📦 Ambiente: DESENVOLVIMENTO
    set COMPOSE_FILE=docker-compose.dev.yml
) else (
    echo 🚀 Ambiente: PRODUCAO
    set COMPOSE_FILE=docker-compose.yml
)

echo.

REM Verificar se .env existe
if not exist .env (
    echo ❌ Arquivo .env nao encontrado!
    echo 📋 Copie o .env.example e configure:
    echo    copy .env.example .env
    exit /b 1
)

echo ✅ Arquivo .env encontrado

REM Verificar Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker nao esta instalado!
    exit /b 1
)

echo ✅ Docker instalado

REM Verificar Docker Compose
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker Compose nao esta instalado!
    exit /b 1
)

echo ✅ Docker Compose instalado
echo.

REM Perguntar se quer fazer build
set /p BUILD="🔨 Fazer build da imagem? (s/N) "
if /i "%BUILD%"=="s" (
    echo 🔨 Fazendo build...
    docker-compose -f %COMPOSE_FILE% build --no-cache
    echo ✅ Build concluido
)

echo.

REM Iniciar containers
echo 🚀 Iniciando containers...
docker-compose -f %COMPOSE_FILE% up -d

echo.
echo ✅ Containers iniciados!
echo.

REM Aguardar inicializacao
echo ⏳ Aguardando inicializacao (10s)...
timeout /t 10 /nobreak >nul

REM Verificar status
echo.
echo 📊 Status dos containers:
docker-compose -f %COMPOSE_FILE% ps

echo.
echo 📝 Para ver logs em tempo real:
echo    docker-compose -f %COMPOSE_FILE% logs -f
echo.
echo 🛑 Para parar:
echo    docker-compose -f %COMPOSE_FILE% down
echo.

REM Testar endpoint
if "%ENVIRONMENT%"=="prod" (
    echo 🔍 Testando endpoint...
    curl -s http://localhost:3333/ >nul 2>&1
    if errorlevel 1 (
        echo ⚠️  API nao esta respondendo. Verifique os logs.
    ) else (
        echo ✅ API esta respondendo em http://localhost:3333
    )
)

echo.
echo 🎉 Deploy concluido!

endlocal
