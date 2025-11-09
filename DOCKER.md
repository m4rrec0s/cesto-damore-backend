# 🐳 Docker - Cesto d'Amore API

Guia completo para executar a aplicação usando Docker.

## 📋 Pré-requisitos

- Docker Engine 20.10+
- Docker Compose 2.0+
- Arquivo `.env` configurado

## 🚀 Quick Start

### 1. Configurar Variáveis de Ambiente

Copie o arquivo de exemplo e configure:

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais reais.

### 2. Build e Start (Produção)

```bash
# Build da imagem
docker-compose build

# Iniciar aplicação
docker-compose up -d

# Ver logs
docker-compose logs -f app
```

### 3. Ambiente de Desenvolvimento

```bash
# Iniciar em modo desenvolvimento (hot reload)
docker-compose -f docker-compose.dev.yml up

# Logs em tempo real
docker-compose -f docker-compose.dev.yml logs -f
```

## 📦 Comandos Docker Úteis

### Build e Deploy

```bash
# Build da imagem
docker-compose build

# Build sem cache
docker-compose build --no-cache

# Iniciar em background
docker-compose up -d

# Parar containers
docker-compose down

# Parar e remover volumes
docker-compose down -v
```

### Logs e Monitoramento

```bash
# Ver logs
docker-compose logs -f app

# Ver logs com timestamp
docker-compose logs -f --timestamps app

# Ver últimas 100 linhas
docker-compose logs --tail=100 app
```

### Executar Comandos no Container

```bash
# Entrar no container
docker-compose exec app sh

# Executar migrações
docker-compose exec app npx prisma migrate deploy

# Gerar Prisma Client
docker-compose exec app npx prisma generate

# Ver status do Prisma
docker-compose exec app npx prisma migrate status
```

### Health Check

```bash
# Verificar status do container
docker-compose ps

# Ver health check
docker inspect cesto-damore-api | grep -A 10 Health

# Testar endpoint
curl http://localhost:3333/
curl http://localhost:3333/api/payment/health
```

## 🔧 Configuração Avançada

### Variáveis de Ambiente

O Docker Compose usa as variáveis do arquivo `.env`. As principais são:

```env
# Servidor
BASE_URL=https://api.cestodamore.com.br
PORT=3333
NODE_ENV=production

# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Mercado Pago
MERCADO_PAGO_ACCESS_TOKEN=...
MERCADO_PAGO_WEBHOOK_SECRET=...
```

### Volumes

A aplicação monta os seguintes volumes:

```yaml
volumes:
  - ./images:/app/images # Imagens de customização
  - ./customizations:/app/customizations # Modelos 3D
  - ./google-drive-token.json:/app/google-drive-token.json # Token Google
```

### Portas

Por padrão, a aplicação expõe a porta `3333`. Para mudar:

```bash
# No .env
PORT=8080

# Ou direto no docker-compose
ports:
  - "8080:3333"
```

## 🏗️ Multi-stage Build

O Dockerfile usa multi-stage build para otimizar o tamanho da imagem:

1. **Builder Stage**: Compila TypeScript e gera Prisma Client
2. **Production Stage**: Copia apenas arquivos necessários

### Tamanhos de Imagem

- **Builder**: ~500MB
- **Production**: ~250MB

## 🔍 Troubleshooting

### Container não inicia

```bash
# Ver logs detalhados
docker-compose logs app

# Verificar variáveis de ambiente
docker-compose exec app env

# Testar configuração
docker-compose config
```

### Erro de conexão com banco

```bash
# Verificar DATABASE_URL
docker-compose exec app echo $DATABASE_URL

# Testar conexão Prisma
docker-compose exec app npx prisma db pull --schema=./prisma/schema.prisma
```

### Permissões de arquivo

```bash
# Corrigir permissões das pastas
chmod -R 755 images
chmod -R 755 customizations

# No container
docker-compose exec app ls -la /app/images
```

### Rebuild completo

```bash
# Parar tudo
docker-compose down

# Remover imagens
docker rmi cesto_damore_backend-app

# Build limpo
docker-compose build --no-cache

# Reiniciar
docker-compose up -d
```

## 🚀 Deploy em Produção

### 1. Usando Docker Compose

```bash
# No servidor de produção
git clone <repo>
cd cesto-damore-backend

# Configurar .env
nano .env

# Build e start
docker-compose up -d

# Verificar logs
docker-compose logs -f
```

### 2. Usando Docker Swarm

```bash
# Inicializar swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml cesto-damore

# Ver serviços
docker stack services cesto-damore

# Ver logs
docker service logs -f cesto-damore_app
```

### 3. Usando Kubernetes

```bash
# Criar deployment
kubectl create -f k8s/deployment.yml

# Criar service
kubectl create -f k8s/service.yml

# Ver status
kubectl get pods
kubectl logs -f <pod-name>
```

## 📊 Monitoramento

### Logs com Docker

```bash
# Logs em tempo real
docker-compose logs -f app

# Filtrar por nível
docker-compose logs app | grep ERROR
docker-compose logs app | grep "Webhook"
```

### Métricas

```bash
# Stats do container
docker stats cesto-damore-api

# Uso de recursos
docker-compose exec app ps aux
docker-compose exec app free -m
```

## 🔒 Segurança

### Boas Práticas

1. **Não commitar .env**: Já está no `.gitignore`
2. **Usar secrets**: Para produção, use Docker secrets
3. **Usuário não-root**: O container roda como node user
4. **Scan de vulnerabilidades**:

```bash
# Scan da imagem
docker scan cesto_damore_backend-app

# Scan com Trivy
trivy image cesto_damore_backend-app
```

### Docker Secrets (Swarm/Kubernetes)

```bash
# Criar secret
echo "my-secret" | docker secret create db_password -

# Usar no compose
secrets:
  db_password:
    external: true
```

## 🔄 CI/CD

### GitHub Actions Example

```yaml
name: Build Docker Image

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build image
        run: docker-compose build

      - name: Run tests
        run: docker-compose run app npm test

      - name: Push to registry
        run: |
          docker tag app:latest registry.com/app:latest
          docker push registry.com/app:latest
```

## 📝 Exemplos de Uso

### Backup do Banco

```bash
# Backup
docker-compose exec app npx prisma db pull --schema=./prisma/backup.prisma

# Restore (cuidado!)
docker-compose exec app npx prisma db push --schema=./prisma/backup.prisma
```

### Executar Seeds

```bash
docker-compose exec app npx prisma db seed
```

### Debug de Produção

```bash
# Entrar no container
docker-compose exec app sh

# Ver processos
ps aux

# Ver arquivos
ls -la dist/

# Testar internamente
wget -qO- http://localhost:3333/
```

## 🎯 Performance

### Otimizações

1. **Use .dockerignore**: Já configurado
2. **Multi-stage build**: Já implementado
3. **Cache de layers**: Build incremental
4. **Minimize dependencies**: `npm ci --only=production`

### Tamanho da Imagem

```bash
# Ver tamanho
docker images | grep cesto-damore

# Analisar layers
docker history cesto_damore_backend-app
```

## 📚 Recursos Adicionais

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Best Practices](https://docs.docker.com/develop/dev-best-practices/)

---

## 🆘 Suporte

Para problemas relacionados ao Docker:

1. Verifique os logs: `docker-compose logs -f`
2. Verifique configuração: `docker-compose config`
3. Rebuilde se necessário: `docker-compose build --no-cache`
4. Consulte a documentação: [DEPLOY.md](./DEPLOY.md)

---

**Desenvolvido por**: Marcos Henrique ([@m4rrec0s](https://github.com/m4rrec0s))

**Propriedade**: Cesto d'Amore

**Última atualização**: 09/11/2025
