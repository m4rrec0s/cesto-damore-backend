# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /code

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libvips-dev \
    libfftw3-dev \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    libpixman-1-dev \
    libfreetype6-dev \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

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
FROM node:20-slim

WORKDIR /code

# Instalar dependências de runtime
RUN apt-get update && apt-get install -y \
    libvips-dev \
    libfftw3-dev \
    libc6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Criar diretórios para bind mounts
RUN mkdir -p /app/images /app/images/customizations /app/storage /app/storage/temp && \
    chmod 755 /app/images /app/images/customizations /app/storage /app/storage/temp

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