# Estágio 1: Build
FROM node:20-alpine AS builder

# Instalar dependências necessárias para Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências com retry e timeout maior
RUN npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm ci --prefer-offline --no-audit

# Copiar Prisma schema
COPY prisma ./prisma/

# Copiar código fonte
COPY . .

# Gerar Prisma Client
RUN npx prisma generate

# Build da aplicação
RUN npm run build

# Estágio 2: Produção
FROM node:20-alpine AS production

# Instalar dependências necessárias
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências de produção com retry e timeout maior
RUN npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm ci --omit=dev --prefer-offline --no-audit && \
    npm cache clean --force

# Copiar Prisma schema
COPY --from=builder /app/prisma ./prisma

# Gerar Prisma Client em produção
RUN npx prisma generate

# Copiar código compilado do estágio de build
COPY --from=builder /app/dist ./dist

# Copiar arquivo HTML
COPY --from=builder /app/src/index.html ./dist/index.html

# Criar diretórios necessários
RUN mkdir -p /app/images/customizations /app/customizations/models

# Expor porta
EXPOSE 3333

# Variáveis de ambiente padrão (serão sobrescritas pelo docker-compose)
ENV NODE_ENV=production
ENV PORT=3333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3333/', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Script de inicialização
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
