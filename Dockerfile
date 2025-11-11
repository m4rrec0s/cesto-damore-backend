# Stage 1: Build
FROM node:20.10.0 AS builder

WORKDIR /code

# Copia package files
COPY package*.json ./
COPY tsconfig.json ./

# Instala TODAS as dependências (incluindo devDependencies para build)
# Com timeout maior e retry para Sharp
RUN npm install --fetch-timeout=300000 --fetch-retries=5

# Copia arquivos do projeto
COPY . .

# Gera Prisma Client
RUN npx prisma generate

# Compila TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20.10.0

WORKDIR /code

# Copia package files
COPY package*.json ./

# Instala APENAS dependências de produção
# Com timeout maior e retry para Sharp
RUN npm install --omit=dev --fetch-timeout=300000 --fetch-retries=5

# Copia arquivos compilados do stage anterior
COPY --from=builder /code/dist ./dist
COPY --from=builder /code/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /code/prisma ./prisma

# Copia outros arquivos necessários
COPY google-drive-token.json* ./
COPY images ./images
COPY customizations ./customizations

# Expõe a porta
EXPOSE 3333

# Inicia aplicação compilada
CMD ["node", "dist/server.js"]
