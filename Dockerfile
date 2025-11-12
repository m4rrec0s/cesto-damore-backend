# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /code

# Evita bloqueios de DNS e falhas de rede
RUN npm config set registry https://registry.npmjs.org/ \
    && npm config set sharp_binary_host "https://npm.taobao.org/mirrors/sharp-libvips" \
    && npm config set sharp_libvips_binary_host "https://npm.taobao.org/mirrors/sharp-libvips" \
    && npm config set fetch-retry-maxtimeout 600000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 10

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

# Copia arquivos essenciais
COPY package*.json ./
COPY tsconfig.json ./

# Instala dependências com fallback
RUN npm install --verbose || npm install --ignore-scripts

# Copia o restante do projeto
COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Compila TypeScript
RUN npm run build


# ----------------------
# Stage 2: Production
# ----------------------
FROM node:20-alpine

WORKDIR /code

RUN apk add --no-cache \
    vips-dev \
    fftw-dev \
    libc6-compat \
    bash \
    curl

# Copia apenas dependências e build final
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /code/dist ./dist
COPY --from=builder /code/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /code/prisma ./prisma
COPY google-drive-token.json* ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /code/images /code/images/customizations /code/customizations/models /code/storage/temp \
    && chmod -R 755 /code/images /code/customizations /code/storage

EXPOSE 3333
ENTRYPOINT ["./docker-entrypoint.sh"]
