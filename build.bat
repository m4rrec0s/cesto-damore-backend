@echo off
echo === Deployment Build Script ===
echo Node version: 
node --version
echo NPM version: 
npm --version
echo Working directory: %CD%

echo.
echo === Installing Dependencies ===
call npm ci --omit=dev --prefer-offline

echo.
echo === Generating Prisma Client ===
call npx prisma generate

echo.
echo === Building Application ===
call npm run build

echo.
echo === Verifying Build Output ===
if not exist "dist\server.js" (
    echo ERROR: Build failed - dist\server.js not found
    exit /b 1
)
echo Build verified successfully

echo.
echo === Running Migrations ===
call npx prisma migrate deploy

echo.
echo === Deployment Complete ===
echo Application is ready to start with: npm start
