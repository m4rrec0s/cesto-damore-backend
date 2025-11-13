# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /code

# Variáveis de ambiente para evitar bloqueios e erros no Sharp
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV npm_config_fetch_retries=10
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=600000

# Instalar dependências necessárias
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev \
    fftw-dev \
    build-base \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    bash \
    curl \
    git

# Copia package files
COPY package*.json ./
COPY tsconfig.json ./

# Instala dependências com retry estendido
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --verbose --fetch-timeout=600000 --fetch-retries=10

# Copia projeto
COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Compila TypeScript
RUN npm run build


# ========================
# Stage 2: Production
# ========================
FROM node:20-alpine

WORKDIR /code

# Dependências de runtime
RUN apk add --no-cache \
    vips-dev \
    fftw-dev \
    libc6-compat \
    bash \
    curl

# Criar diretórios para bind mounts
RUN mkdir -p /app/images /app/storage && \
    chmod 755 /app/images /app/storage

# Copia package files
COPY package*.json ./

# Copia node_modules completo do builder (inclui Sharp já compilado)
COPY --from=builder /code/node_modules ./node_modules

# Copia build
COPY --from=builder /code/dist ./dist
COPY --from=builder /code/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /code/prisma ./prisma
COPY google-drive-token.json* ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3333
ENTRYPOINT ["./docker-entrypoint.sh"]