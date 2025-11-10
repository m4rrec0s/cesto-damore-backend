# 🚀 Easypanel - Quick Start Guide

## ⚠️ IMPORTANTE: Configuração Correta

O Easypanel usa um fluxo diferente: clona o código para `/code` e executa scripts de build.

**Dockerfile simplificado** para funcionar com esse fluxo.

---

## ✅ Configuração Correta no Easypanel

### 1. General Settings

- **Service Name**: `cesto-damore-api`
- **Repository**: `m4rrec0s/cesto-damore-backend`
- **Branch**: `main`

### 2. Build Settings ⭐ CRÍTICO

**Configure os scripts de implantação:**

```bash
# Build Command (executa uma vez durante o build)
npm ci --prefer-offline && npx prisma generate && npm run build && npx prisma migrate deploy
```

**OU use o script otimizado:**

```bash
chmod +x easypanel-deploy.sh && ./easypanel-deploy.sh
```

**Start Command (executa sempre que o container inicia):**

```bash
npm start
```

**Configure também:**

- **Build Method**: `Dockerfile`
- **Dockerfile Path**: `Dockerfile`
- **Build Context**: `.`

### 3. Resources (Memória) ⚠️ IMPORTANTE

**Memória mínima para evitar erro 137:**

- **Memory**: `1024 MB` (1GB) ou mais
- **CPU**: `0.5` ou `1.0`

> 💡 O primeiro build consome mais memória. Após o deploy inicial, pode reduzir para 512MB se necessário.

### 4. Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres.[ref]:[pwd]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.[ref]:[pwd]@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# Server
BASE_URL=https://api.cestodamore.com.br
PORT=3333
NODE_ENV=production

# Mercado Pago
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...
MERCADO_PAGO_PUBLIC_KEY=APP_USR-...
MERCADO_PAGO_WEBHOOK_SECRET=seu_secret_aqui

# Firebase
GOOGLE_PROJECT_ID=...
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
GOOGLE_CLIENT_EMAIL=...
FIREBASE_API_KEY=...

# Google Drive
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.cestodamore.com.br/oauth/callback
GOOGLE_OAUTH_ACCESS_TOKEN=...
GOOGLE_OAUTH_REFRESH_TOKEN=...
GOOGLE_DRIVE_ROOT_FOLDER_ID=...

# Security
JWT_SECRET=seu_jwt_secret_super_seguro
```

### 5. Network Settings

**Port Mapping:**

- **Container Port**: `3333`
- **Protocol**: `HTTP`

**Health Check:**

- **Path**: `/health`
- **Port**: `3333`

### 6. Domain

Configure seu domínio:

- **Domain**: `api.cestodamore.com.br`
- **SSL**: ✅ Enabled (Easypanel gerencia automaticamente)

---

## 🔄 Como fazer Deploy

1. **Configure tudo conforme acima**
2. **Clique em "Deploy"**
3. **Aguarde o build** (primeira vez ~5-10 minutos)
4. **Verifique os logs**

### Logs Esperados (Sucesso):

```
🚀 Starting Cesto d'Amore API...
✅ DATABASE_URL is set
📦 Generating Prisma Client...
🔄 Running database migrations...
✅ Migrations completed
🎉 Starting application...
🚀 Server running on https://api.cestodamore.com.br
📡 PORT: 3333
🔗 BASE_URL: https://api.cestodamore.com.br
🌐 Environment: production
💳 Mercado Pago Webhook: https://api.cestodamore.com.br/webhook/mercadopago
```

---

## 🐛 Troubleshooting

### Erro: "Command failed with exit code 137"

**Causa**: Falta de memória (OOM) durante npm install

**Solução**:

1. ✅ Aumente memória para **1GB** ou **2GB**
2. ✅ Use o comando de build otimizado com `--prefer-offline`
3. ✅ Ou divida o build em etapas menores:

   ```bash
   # Opção 1: Build completo (recomendado)
   npm ci --prefer-offline && npx prisma generate && npm run build && npx prisma migrate deploy

   # Opção 2: Sem cache (se tiver problemas)
   npm install && npx prisma generate && npm run build && npx prisma migrate deploy
   ```

### Erro: "Webhook 403 Forbidden"

**Causa**: URL do webhook incorreta ou validação bloqueando

**Solução**:

1. ✅ Configure no Mercado Pago:
   - URL: `https://api.cestodamore.com.br/api/webhook/mercadopago`
   - ou: `https://api.cestodamore.com.br/webhook/mercadopago`
2. ✅ Verifique `MERCADO_PAGO_WEBHOOK_SECRET` nas variáveis de ambiente
3. ✅ Teste com webhook de teste primeiro

### Erro: "DATABASE_URL undefined"

**Solução**: Adicione TODAS as variáveis de ambiente antes do deploy

---

## ✅ Checklist Final

Antes de clicar em Deploy:

- [ ] Build Method: `Dockerfile`
- [ ] Build Command: `npm ci --prefer-offline && npx prisma generate && npm run build && npx prisma migrate deploy`
- [ ] Start Command: `npm start`
- [ ] Memória: **≥ 1GB**
- [ ] Todas variáveis de ambiente configuradas
- [ ] PORT: `3333`
- [ ] Health Check: `/health`
- [ ] Domínio configurado com SSL

---

## 🎯 URLs Importantes Após Deploy

- **API Base**: `https://api.cestodamore.com.br`
- **Health Check**: `https://api.cestodamore.com.br/health`
- **Webhook MP**: `https://api.cestodamore.com.br/api/webhook/mercadopago`
- **Payment Health**: `https://api.cestodamore.com.br/api/payment/health`

---

## 📊 Próximos Passos

Após deploy bem-sucedido:

1. ✅ Teste a API: `curl https://api.cestodamore.com.br`
2. ✅ Configure webhook no Mercado Pago
3. ✅ Teste webhook com ferramenta de teste do MP
4. ✅ Configure domínio no frontend
5. ✅ Monitor logs para erros

---

**Dúvidas?** Consulte `EASYPANEL.md` para documentação completa.
