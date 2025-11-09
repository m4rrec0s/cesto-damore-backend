# 🚀 Guia de Deploy - Cesto d'Amore API

## ✅ Checklist de Deploy

### 1. Variáveis de Ambiente Obrigatórias

Certifique-se de que todas as variáveis de ambiente estão configuradas corretamente:

#### **Banco de Dados**

```env
DATABASE_URL="postgresql://..." # URL com pooler (porta 6543)
DIRECT_URL="postgresql://..."    # URL direta (porta 5432)
```

#### **Mercado Pago (CRÍTICO para pagamentos)**

```env
MERCADO_PAGO_PUBLIC_KEY="..."
MERCADO_PAGO_ACCESS_TOKEN="..."
MERCADO_PAGO_WEBHOOK_SECRET="..." # CRÍTICO para validação de webhooks
```

#### **Firebase Admin**

```env
GOOGLE_PROJECT_ID="..."
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_CLIENT_EMAIL="..."
FIREBASE_API_KEY="..."
```

#### **Google Drive OAuth**

```env
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="https://api.cestodamore.com.br/oauth/callback"
GOOGLE_OAUTH_ACCESS_TOKEN="..."
GOOGLE_OAUTH_REFRESH_TOKEN="..."
GOOGLE_DRIVE_ROOT_FOLDER_ID="..."
```

#### **Servidor (IMPORTANTE)**

```env
BASE_URL="https://api.cestodamore.com.br"  # SEM barra no final
PORT=3333
NODE_ENV="production"
```

#### **JWT e Segurança**

```env
JWT_SECRET="..." # Use um hash seguro em produção
```

#### **WhatsApp / Evolution API**

```env
EVOLUTION_API_URL="https://evolutionapi.cestodamore.com.br"
EVOLUTION_API_KEY="..."
EVOLUTION_INSTANCE="CestoDamore"
WHATSAPP_GROUP_ID="..."
```

---

## 🔧 Configurações Críticas Implementadas

### ✅ Webhook do Mercado Pago (100% Funcional)

#### **URL do Webhook**

```
https://api.cestodamore.com.br/api/webhook/mercadopago
```

#### **Validação de Segurança**

- ✅ Validação de assinatura HMAC SHA256 usando `x-signature`
- ✅ Validação de timestamp (previne replay attacks - 5 minutos)
- ✅ Validação de estrutura do payload
- ✅ Whitelist de IPs do Mercado Pago (produção)
- ✅ Logs detalhados de webhooks recebidos

#### **Como Configurar no Mercado Pago**

1. Acesse: https://www.mercadopago.com.br/developers/panel/app
2. Selecione sua aplicação
3. Vá em "Webhooks"
4. Configure a URL: `https://api.cestodamore.com.br/api/webhook/mercadopago`
5. Selecione os eventos:
   - ✅ Pagamentos (payment)
   - ✅ Merchant Orders (merchant_order)

#### **Teste do Webhook**

```bash
# Teste de conectividade
curl -X POST https://api.cestodamore.com.br/api/webhook/mercadopago \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","data":{"id":"123456"},"live_mode":false}'
```

---

### ✅ URLs de Imagens (Google Drive + Local)

Todas as URLs de imagens agora usam `BASE_URL` do .env:

#### **Customizações**

```
https://api.cestodamore.com.br/images/customizations/arquivo.jpg
```

#### **Modelos 3D**

```
https://api.cestodamore.com.br/customizations/models/modelo.glb
```

#### **Google Drive**

As imagens de customização finalizadas são enviadas ao Google Drive e retornam URLs públicas.

---

## 📋 Processo de Deploy

### 1. **Build da Aplicação**

```bash
npm run build
```

### 2. **Migrações do Prisma**

```bash
npx prisma migrate deploy
npx prisma generate
```

### 3. **Variáveis de Ambiente**

- ✅ Copie o `.env` para o servidor
- ✅ Atualize `BASE_URL` com a URL de produção
- ✅ Atualize `NODE_ENV=production`
- ✅ Verifique todas as chaves do Mercado Pago

### 4. **Iniciar Servidor**

```bash
npm start
# ou com PM2
pm2 start dist/server.js --name "cesto-damore-api"
pm2 save
```

### 5. **Verificações Pós-Deploy**

#### **Health Check Geral**

```bash
curl https://api.cestodamore.com.br/
```

#### **Health Check Mercado Pago**

```bash
curl https://api.cestodamore.com.br/api/payment/health
```

#### **Teste de Webhook**

No painel do Mercado Pago, use o botão "Testar Webhook"

---

## 🔒 Segurança em Produção

### ✅ Implementado

- CORS configurado
- Rate limiting em endpoints de pagamento
- Validação de JWT/Firebase tokens
- Validação de webhooks com assinatura HMAC
- Whitelist de IPs do Mercado Pago
- Logs de operações financeiras
- Validação de dados em todos os endpoints

### ⚠️ Recomendações Adicionais

- [ ] Configure SSL/TLS (HTTPS obrigatório)
- [ ] Configure firewall para permitir apenas IPs necessários
- [ ] Ative monitoramento de logs (ex: Datadog, New Relic)
- [ ] Configure backups automáticos do banco de dados
- [ ] Implemente rotação de segredos (JWT_SECRET, API keys)

---

## 🔍 Troubleshooting

### Webhook não está sendo recebido

1. Verifique se a URL está acessível externamente
2. Verifique os logs do servidor: `pm2 logs cesto-damore-api`
3. Confirme que `MERCADO_PAGO_WEBHOOK_SECRET` está configurado
4. Teste manualmente com curl
5. Verifique whitelist de IPs (desabilite temporariamente em dev)

### Imagens não estão carregando

1. Verifique se `BASE_URL` está correto (sem barra no final)
2. Verifique permissões das pastas `images/` e `customizations/`
3. Confirme que o servidor está servindo arquivos estáticos

### Pagamentos não estão sendo aprovados

1. Verifique se está usando credenciais de PRODUÇÃO do Mercado Pago
2. Confirme que o webhook está configurado corretamente
3. Verifique logs de pagamento no banco: tabela `webhook_log`
4. Teste o fluxo completo em ambiente de teste primeiro

### Google Drive não está funcionando

1. Execute o fluxo OAuth: `GET /oauth/authorize`
2. Verifique se os tokens estão válidos
3. Confirme que `GOOGLE_DRIVE_ROOT_FOLDER_ID` existe e tem permissões

---

## 📊 Monitoramento

### Logs Importantes

```bash
# Logs gerais
pm2 logs cesto-damore-api

# Logs apenas de erros
pm2 logs cesto-damore-api --err

# Limpar logs
pm2 flush
```

### Queries SQL para Monitoramento

```sql
-- Verificar webhooks recebidos (últimas 24h)
SELECT * FROM "WebhookLog"
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Verificar pagamentos pendentes
SELECT * FROM "Payment"
WHERE status = 'PENDING'
AND created_at > NOW() - INTERVAL '7 days';

-- Resumo financeiro do dia
SELECT * FROM "FinancialSummary"
WHERE date = CURRENT_DATE;
```

---

## 🎯 URLs Importantes

- **API Base**: https://api.cestodamore.com.br
- **Webhook Mercado Pago**: https://api.cestodamore.com.br/api/webhook/mercadopago
- **Google OAuth Callback**: https://api.cestodamore.com.br/oauth/callback
- **Health Check**: https://api.cestodamore.com.br/api/payment/health

---

## 👨‍💻 Desenvolvido por

**Marcos Henrique** ([@m4rrec0s](https://github.com/m4rrec0s))

**Propriedade**: Cesto d'Amore

---

## 📞 Suporte

Em caso de problemas críticos em produção:

1. Verifique os logs: `pm2 logs`
2. Verifique o status: `pm2 status`
3. Reinicie se necessário: `pm2 restart cesto-damore-api`
4. Reverta para versão anterior se crítico

---

**Última atualização**: 09/11/2025
