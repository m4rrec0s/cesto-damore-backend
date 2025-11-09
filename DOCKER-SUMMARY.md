# 🎯 Resumo da Dockerização

## ✅ Arquivos Criados

### Arquivos Docker Principais

- ✅ `Dockerfile` - Multi-stage build otimizado
- ✅ `docker-compose.yml` - Configuração para produção
- ✅ `docker-compose.dev.yml` - Configuração para desenvolvimento
- ✅ `.dockerignore` - Otimização de build
- ✅ `.env.example` - Template de variáveis de ambiente

### Scripts de Deploy

- ✅ `deploy.sh` - Script automático para Linux/Mac
- ✅ `deploy.bat` - Script automático para Windows

### Documentação

- ✅ `DOCKER.md` - Guia completo de uso do Docker
- ✅ `README.md` - Atualizado com instruções Docker
- ✅ `DEPLOY.md` - Atualizado com método Docker

### Estrutura de Pastas

- ✅ `images/customizations/.gitkeep`
- ✅ `customizations/models/.gitkeep`

---

## 🚀 Como Usar

### Quick Start (Produção)

```bash
# 1. Configurar
cp .env.example .env
nano .env

# 2. Deploy
docker-compose up -d

# 3. Ver logs
docker-compose logs -f
```

### Quick Start (Desenvolvimento)

```bash
# 1. Iniciar
docker-compose -f docker-compose.dev.yml up

# 2. Código hot reload ativo
# 3. Edite arquivos em src/ e veja mudanças automaticamente
```

### Scripts Automáticos

```bash
# Linux/Mac
chmod +x deploy.sh
./deploy.sh prod    # Produção
./deploy.sh dev     # Desenvolvimento

# Windows
deploy.bat prod
deploy.bat dev
```

---

## 📦 Características da Dockerização

### Multi-Stage Build

- **Stage 1 (Builder)**: Compila TypeScript e gera Prisma Client (~500MB)
- **Stage 2 (Production)**: Apenas runtime e código compilado (~250MB)
- **Otimização**: Imagem final 50% menor

### Recursos Implementados

✅ Build otimizado com cache de layers
✅ Apenas dependências de produção na imagem final
✅ Health check automático
✅ Volumes para persistência de dados
✅ Migrações automáticas no startup
✅ Prisma Client gerado automaticamente
✅ Logs estruturados
✅ Restart automático em caso de falha

### Segurança

✅ Usuário não-root (node user)
✅ .dockerignore configurado
✅ Secrets via variáveis de ambiente
✅ Imagem baseada em Alpine (menor superfície de ataque)

---

## 🔧 Comandos Úteis

### Gerenciamento Básico

```bash
# Iniciar
docker-compose up -d

# Parar
docker-compose down

# Ver logs
docker-compose logs -f app

# Status
docker-compose ps

# Rebuild
docker-compose build --no-cache
```

### Executar Comandos

```bash
# Shell no container
docker-compose exec app sh

# Migrações
docker-compose exec app npx prisma migrate deploy

# Gerar Prisma Client
docker-compose exec app npx prisma generate

# Ver variáveis
docker-compose exec app env
```

### Troubleshooting

```bash
# Ver logs detalhados
docker-compose logs --tail=100 app

# Inspecionar container
docker inspect cesto-damore-api

# Verificar health
docker ps
docker-compose ps

# Restart
docker-compose restart app
```

---

## 📊 Volumes

A aplicação monta os seguintes volumes:

```yaml
volumes:
  - ./images:/app/images # Imagens locais
  - ./customizations:/app/customizations # Modelos 3D
  - ./google-drive-token.json:/app/google-drive-token.json # Token Google
```

**Importante**: Esses volumes garantem que os dados persistam mesmo quando o container é recriado.

---

## 🌐 Portas

- **Porta Container**: 3333
- **Porta Host**: Configurável via .env (padrão: 3333)

Para mudar a porta:

```env
# No .env
PORT=8080
```

```yaml
# No docker-compose.yml
ports:
  - "8080:3333" # host:container
```

---

## 🔍 Health Check

O container possui health check automático:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3
```

Verifica a cada 30s se a API está respondendo em `http://localhost:3333/`

---

## 🚀 Deploy em Produção

### Opção 1: Docker Compose

```bash
# No servidor
git clone <repo>
cd cesto-damore-backend
cp .env.example .env
nano .env  # Configure
docker-compose up -d
```

### Opção 2: Docker Swarm

```bash
docker swarm init
docker stack deploy -c docker-compose.yml cesto-damore
docker stack services cesto-damore
```

### Opção 3: Kubernetes

```bash
# Criar deployment e service
kubectl apply -f k8s/
kubectl get pods
kubectl logs -f <pod-name>
```

---

## 📝 Checklist Pré-Deploy

- [ ] Arquivo `.env` configurado com credenciais de produção
- [ ] `BASE_URL` aponta para domínio de produção
- [ ] `NODE_ENV=production`
- [ ] Credenciais do Mercado Pago de PRODUÇÃO
- [ ] Webhook configurado no painel do Mercado Pago
- [ ] Banco de dados PostgreSQL acessível
- [ ] Portas liberadas no firewall
- [ ] SSL/TLS configurado
- [ ] Google Drive OAuth configurado
- [ ] Docker e Docker Compose instalados

---

## 🎉 Benefícios da Dockerização

✅ **Portabilidade**: Funciona em qualquer lugar (dev, staging, prod)
✅ **Consistência**: Mesmo ambiente em todos os servidores
✅ **Isolamento**: Não interfere com outras aplicações
✅ **Versionamento**: Imagens podem ser versionadas e rollback
✅ **Escalabilidade**: Fácil de escalar horizontalmente
✅ **CI/CD**: Integração simples com pipelines
✅ **Reprodutibilidade**: Build determinístico
✅ **Menor overhead**: Mais leve que VMs

---

## 📚 Documentação

- [DOCKER.md](./DOCKER.md) - Guia completo do Docker
- [DEPLOY.md](./DEPLOY.md) - Guia de deploy
- [README.md](./README.md) - Documentação geral

---

**Desenvolvido por**: Marcos Henrique ([@m4rrec0s](https://github.com/m4rrec0s))

**Propriedade**: Cesto d'Amore
