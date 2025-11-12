# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /code

# Instalar dependências necessárias para Sharp e Prisma
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
    freetype-dev

# Copia package files
COPY package*.json ./
COPY tsconfig.json ./

# Instala TODAS as dependências (incluindo devDependencies para build)
# Usa apenas registro npm padrão para evitar timeouts
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --fetch-timeout=600000 --fetch-retries=10 --verbose

# Copia arquivos do projeto
COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Compila TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /code

# Instalar dependências runtime necessárias para Sharp
RUN apk add --no-cache \
    vips-dev \
    fftw-dev \
    libc6-compat \
    build-base \
    python3 \
    make \
    g++

# Copia package files
COPY package*.json ./

# Instala APENAS dependências de produção
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --omit=dev --fetch-timeout=600000 --fetch-retries=10

# Copia arquivos compilados do stage anterior
COPY --from=builder /code/dist ./dist
COPY --from=builder /code/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /code/prisma ./prisma

# Copia outros arquivos necessários
COPY google-drive-token.json* ./

# Cria diretórios para volumes
RUN mkdir -p /code/images /code/images/customizations /code/customizations/models /code/storage/temp && \
    chmod -R 755 /code/images /code/customizations /code/storage

# Copia o script de inicialização
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expõe a porta
EXPOSE 3333

# Usar o entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]
