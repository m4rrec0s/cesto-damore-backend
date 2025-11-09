# 🧺 Cesto d'Amore - Backend API

API RESTful desenvolvida para gerenciar o sistema completo de e-commerce da Cesto d'Amore, incluindo produtos, pedidos, pagamentos e personalização de cestas.

## 🚀 Stack Tecnológica

- **Runtime**: Node.js
- **Framework**: Express.js
- **Linguagem**: TypeScript
- **ORM**: Prisma
- **Banco de Dados**: PostgreSQL (Supabase)
- **Autenticação**: Firebase Admin SDK
- **Pagamentos**: Mercado Pago (SDK v2)
- **Storage**: Google Drive API
- **Notificações**: Evolution API (WhatsApp)

## 📋 Funcionalidades Principais

### 💳 Sistema de Pagamentos (100% Funcional)

- ✅ Integração completa com Mercado Pago
- ✅ Checkout Transparente (PIX e Cartão)
- ✅ Preferences (Checkout Pro)
- ✅ Webhook com validação HMAC SHA256
- ✅ Proteção contra replay attacks
- ✅ Logs detalhados de transações
- ✅ Atualização automática de status de pedidos

### 🛍️ Gestão de Produtos

- CRUD completo de produtos
- Categorização e tipos
- Adicionais e compatibilidades
- Controle de estoque
- Imagens via Google Drive

### 🎨 Customização de Cestas

- Upload de modelos 3D (.glb, .gltf)
- Áreas de impressão configuráveis
- Preview de customizações
- Composição automática de imagens
- Armazenamento no Google Drive

### 📦 Gestão de Pedidos

- Criação e rastreamento de pedidos
- Integração com pagamentos
- Notificações via WhatsApp
- Gestão de endereços de entrega
- Relatórios financeiros

### 🔐 Segurança

- Autenticação JWT + Firebase
- Rate limiting em endpoints financeiros
- Validação de webhooks
- Whitelist de IPs (produção)
- Criptografia de dados sensíveis

## 🔧 Configuração

### Pré-requisitos

```bash
Node.js >= 18
PostgreSQL (ou Supabase)
npm ou yarn
```

### Instalação

```bash
# Clone o repositório
git clone https://github.com/m4rrec0s/cesto-damore-backend.git

# Entre no diretório
cd cesto-damore-backend

# Instale as dependências
npm install

# Configure o .env (veja .env.example)
cp .env.example .env

# Execute as migrações
npx prisma migrate dev

# Inicie o servidor
npm run dev
```

### Variáveis de Ambiente Críticas

```env
# Servidor
BASE_URL=https://api.cestodamore.com.br
PORT=3333
NODE_ENV=production

# Banco de Dados
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Mercado Pago (CRÍTICO)
MERCADO_PAGO_ACCESS_TOKEN=...
MERCADO_PAGO_PUBLIC_KEY=...
MERCADO_PAGO_WEBHOOK_SECRET=...

# Firebase
FIREBASE_API_KEY=...
GOOGLE_PROJECT_ID=...
GOOGLE_PRIVATE_KEY=...
GOOGLE_CLIENT_EMAIL=...

# Google Drive
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=...
GOOGLE_DRIVE_ROOT_FOLDER_ID=...

# WhatsApp
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=...
```

## 📚 Documentação da API

### Endpoints Principais

#### Autenticação

```
POST /api/auth/login
POST /api/auth/register
POST /api/auth/google
```

#### Produtos

```
GET    /api/products
GET    /api/products/:id
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id
```

#### Pagamentos

```
POST /api/payment/preference       # Checkout Pro
POST /api/payment/create           # Checkout Transparente
POST /api/webhook/mercadopago      # Webhook do MP
GET  /api/payment/health           # Health check
```

#### Pedidos

```
GET    /api/orders
GET    /api/orders/:id
POST   /api/orders
DELETE /api/orders/:id
```

Para documentação completa, consulte o arquivo [DEPLOY.md](./DEPLOY.md)

## 🚀 Deploy

Consulte o guia completo de deploy: [DEPLOY.md](./DEPLOY.md)

### Quick Deploy

```bash
# Build
npm run build

# Migrações
npx prisma migrate deploy
npx prisma generate

# Start
npm start
```

## 🔍 Monitoramento

### Health Checks

```bash
# API geral
curl https://api.cestodamore.com.br/

# Mercado Pago
curl https://api.cestodamore.com.br/api/payment/health
```

### Logs

```bash
# Ver logs (com PM2)
pm2 logs cesto-damore-api

# Apenas erros
pm2 logs cesto-damore-api --err
```

## 🧪 Testes

### Teste do Webhook

```bash
curl -X POST https://api.cestodamore.com.br/api/webhook/mercadopago \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","data":{"id":"123456"},"live_mode":false}'
```

## 📦 Scripts Disponíveis

```json
{
  "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```

## 🛡️ Segurança em Produção

- ✅ HTTPS obrigatório
- ✅ Validação de webhooks com assinatura HMAC
- ✅ Rate limiting em endpoints financeiros
- ✅ Autenticação JWT + Firebase
- ✅ Validação de inputs
- ✅ Proteção contra replay attacks
- ✅ Logs de operações sensíveis

## 🐛 Troubleshooting

### Webhook não funciona

1. Verifique `MERCADO_PAGO_WEBHOOK_SECRET`
2. Confirme a URL no painel do Mercado Pago
3. Verifique logs: `pm2 logs`
4. Teste manualmente com curl

### Imagens não carregam

1. Verifique `BASE_URL` (sem barra no final)
2. Confirme permissões das pastas
3. Teste acesso direto à URL

### Google Drive falha

1. Execute o OAuth: `GET /oauth/authorize`
2. Verifique tokens no `.env`
3. Confirme permissões da pasta root

## 📄 Licença

Propriedade da **Cesto d'Amore**

## 👨‍💻 Desenvolvedor

**Marcos Henrique**

- GitHub: [@m4rrec0s](https://github.com/m4rrec0s)

---

## 🎯 Roadmap

- [ ] Implementar cache com Redis
- [ ] Adicionar testes automatizados
- [ ] Implementar versionamento de API
- [ ] Adicionar Swagger/OpenAPI
- [ ] Implementar observabilidade completa
- [ ] Adicionar CI/CD

---

**Última atualização**: 09/11/2025
