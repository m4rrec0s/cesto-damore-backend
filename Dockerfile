## syntax=docker/dockerfile:1.7

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /code

# Copia package files
COPY package*.json ./
COPY tsconfig.json ./

# Instala dependências de forma determinística e mais rápida
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry https://registry.npmjs.org/ && \
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

# Garante uso do libvips empacotado pelo sharp (evita dependências APT em runtime)
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

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
