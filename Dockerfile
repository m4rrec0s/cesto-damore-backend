FROM node:18-bullseye-slim

WORKDIR /usr/src/app

ENV NODE_ENV=development

# copy package manifest first to leverage docker cache
COPY package.json package-lock.json* ./

RUN npm install --silent

# copy rest of the sources
COPY . .

EXPOSE 8080

# At container start: ensure prisma client generated, push schema to DB and start dev server
CMD ["sh", "-c", "npx prisma generate && npx prisma db push && npm run dev"]
