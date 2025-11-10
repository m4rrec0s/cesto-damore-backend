# Imagem base simples com Node 20
FROM node:20-alpine

# Instalar dependências do sistema necessárias
RUN apk add --no-cache openssl libc6-compat git

# Definir diretório de trabalho
WORKDIR /code

# Expor porta
EXPOSE 3333

# Comando padrão (será sobrescrito pelo Easypanel)
CMD ["npm", "start"]
