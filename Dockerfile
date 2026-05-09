# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /code

# Dependências mínimas para build de módulos nativos (quando necessário)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copia package files
COPY package*.json ./
COPY tsconfig.json ./

# Instala dependências de forma determinística e mais rápida
RUN npm config set registry https://registry.npmjs.org/ && \
    npm ci --no-audit --no-fund --fetch-timeout=600000 --fetch-retries=5

# Copia projeto
COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Compila TypeScript
RUN npm run build

# Remove dependências de desenvolvimento para copiar apenas runtime
RUN npm prune --omit=dev


# ========================
# Stage 2: Production
# ========================
FROM node:20-slim

# Instalar dependências de runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    libfftw3-double3 \
    libc6 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Criar diretórios de armazenamento com permissões corretas
# IMPORTANTE: criar com permissão 755 ANTES de trocar de usuário
RUN mkdir -p images/customizations \
    storage/temp \
    storage/final && \
    chmod -R 755 images storage && \
    chown -R node:node /usr/src/app && \
    chmod -R u+w storage

# Copia package files
COPY --chown=node:node package*.json ./

# Copia node_modules completo do builder
COPY --chown=node:node --from=builder /code/node_modules ./node_modules

# Copia build e arquivos necessários
COPY --chown=node:node --from=builder /code/dist ./dist
COPY --chown=node:node --from=builder /code/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node --from=builder /code/prisma ./prisma
COPY --chown=node:node google-drive-token.json* ./
COPY --chown=node:node docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

# Muda para usuário não-root (Desativado para evitar problemas de permissão em volumes montados no Easypanel)
# USER node

EXPOSE 3333
ENTRYPOINT ["./docker-entrypoint.sh"]
