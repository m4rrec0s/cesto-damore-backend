## syntax=docker/dockerfile:1.7

# Stage 1: Build
FROM node:20-slim AS builder

# Instala openssl para o Prisma Generate
RUN apt-get update -y && apt-get install -y openssl

WORKDIR /code
COPY package*.json ./
COPY tsconfig.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm config set registry https://registry.npmjs.org/ && \
    npm ci --no-audit --no-fund --fetch-timeout=600000 --fetch-retries=5

COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ========================
# Stage 2: Production
# ========================
FROM node:20-slim

# Instala openssl no estágio final (Runtime)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV TZ=America/Sao_Paulo
WORKDIR /usr/src/app

RUN mkdir -p images/customizations \
    storage/temp \
    storage/final && \
    chmod -R 755 images storage && \
    chown -R node:node /usr/src/app && \
    chmod -R u+w storage

COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /code/node_modules ./node_modules
COPY --chown=node:node --from=builder /code/dist ./dist
COPY --chown=node:node --from=builder /code/public ./public
COPY --chown=node:node --from=builder /code/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node --from=builder /code/prisma ./prisma
COPY --chown=node:node google-drive-token.json* ./
COPY --chown=node:node docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3333
ENTRYPOINT ["./docker-entrypoint.sh"]
