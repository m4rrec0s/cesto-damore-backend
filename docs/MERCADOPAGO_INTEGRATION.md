# Integração Mercado Pago - Cesto d'Amore

## 🔧 Configuração Inicial

### 1. Configuração das Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env` e configure as seguintes variáveis:

```env
# Mercado Pago - Obtenha suas credenciais em: https://www.mercadopago.com.br/developers
MERCADO_PAGO_ACCESS_TOKEN="TEST-sua-access-token"
MERCADO_PAGO_PUBLIC_KEY="TEST-sua-public-key"
MERCADO_PAGO_WEBHOOK_SECRET="seu-webhook-secret"
BASE_URL="http://localhost:3000"
JWT_SECRET="sua-chave-jwt-segura"
```

### 2. Migração do Banco de Dados

Execute a migração para criar as tabelas de pagamento:

```bash
npx prisma migrate dev --name add_payment_and_financial_tables
```

### 3. Gerar Cliente Prisma

```bash
npx prisma generate
```

## 📋 Estrutura das Tabelas Criadas

### `Payment`

- Gerencia todos os pagamentos e preferências
- Status sincronizado com Mercado Pago
- Tracking de taxas e valores líquidos

### `FinancialSummary`

- Resumo financeiro diário automático
- Estatísticas de vendas e produtos
- Controle de receita líquida

### `WebhookLog`

- Log de todos os webhooks recebidos
- Debugging e auditoria

## 🔒 Segurança Implementada

### Autenticação

- JWT tokens para proteger rotas
- Verificação de usuário válido

### Rate Limiting

- 10 tentativas de pagamento por IP a cada 15 minutos
- Proteção contra spam e ataques

### Validação de Webhooks

- Validação de IP (habilitável para produção)
- Verificação de assinatura
- Estrutura de dados validada

### Logging Financeiro

- Log de todas operações financeiras
- Tracking de usuário e IP
- Métricas de performance

## 🚀 API Endpoints

### Criar Preferência de Pagamento (Checkout Pro)

```http
POST /payment/preference
Authorization: Bearer {jwt-token}
Content-Type: application/json

{
  "orderId": "uuid-do-pedido",
  "items": [
    {
      "title": "Cesta Premium",
      "description": "Cesta com chocolates e pelúcia",
      "quantity": 1,
      "unit_price": 150.00
    }
  ],
  "payerEmail": "cliente@email.com",
  "payerName": "Nome do Cliente",
  "payerPhone": "+5511999999999"
}
```

### Criar Pagamento Direto (Checkout API)

```http
POST /payment/create
Authorization: Bearer {jwt-token}
Content-Type: application/json

{
  "orderId": "uuid-do-pedido",
  "amount": 150.00,
  "description": "Cesta Premium",
  "payerEmail": "cliente@email.com",
  "payerName": "Nome do Cliente",
  "paymentMethodId": "pix"
}
```

### Consultar Status do Pagamento

```http
GET /payment/{payment-id}/status
Authorization: Bearer {jwt-token}
```

### Listar Pagamentos do Usuário

```http
GET /payments/user?page=1&limit=10&status=APPROVED
Authorization: Bearer {jwt-token}
```

### Relatório Financeiro (Admin)

```http
GET /admin/financial-summary?startDate=2025-01-01&endDate=2025-01-31
Authorization: Bearer {jwt-token}
```

## 🔄 Fluxo de Pagamento

### Checkout Pro (Recomendado)

1. Frontend chama `/payment/preference`
2. Recebe `init_point` do Mercado Pago
3. Redireciona usuário para checkout
4. Mercado Pago processa pagamento
5. Webhook atualiza status automaticamente
6. Usuário retorna para páginas de sucesso/erro

### Checkout API (PIX/Cartão)

1. Frontend chama `/payment/create`
2. Recebe dados de pagamento (QR Code para PIX)
3. Usuário efetua pagamento
4. Webhook atualiza status automaticamente

## 📊 Webhooks

### URL do Webhook

```
POST {BASE_URL}/webhook/mercadopago
```

### Configurar no Mercado Pago

1. Acesse o painel do desenvolvedor
2. Vá em "Webhooks"
3. Adicione a URL: `https://seu-dominio.com/webhook/mercadopago`
4. Selecione eventos: `payment` e `merchant_order`

### Segurança do Webhook

- Validação de IP (habilitável)
- Verificação de assinatura
- Rate limiting
- Log completo de tentativas

## 🧪 Testando a Integração

### Dados de Teste do Mercado Pago

**Cartões de Teste:**

```
# Aprovado
4111 1111 1111 1111 (Visa)
5031 4332 1540 6351 (Mastercard)

# Rejeitado
4000 0000 0000 0002
```

**PIX de Teste:**

- Use o CPF: 12345678909
- Email: test_user_123456@testuser.com

### Scripts de Teste

Crie um arquivo `test-payment.js`:

```javascript
const axios = require("axios");

const BASE_URL = "http://localhost:3000";
const JWT_TOKEN = "seu-jwt-token";

async function testCreatePreference() {
  try {
    const response = await axios.post(
      `${BASE_URL}/payment/preference`,
      {
        orderId: "test-order-123",
        items: [
          {
            title: "Teste Cesta",
            quantity: 1,
            unit_price: 100.0,
          },
        ],
        payerEmail: "test@test.com",
      },
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Preferência criada:", response.data);
  } catch (error) {
    console.error("Erro:", error.response?.data || error.message);
  }
}

testCreatePreference();
```

## 📈 Monitoramento

### Logs Importantes

- Todas operações financeiras são logadas
- Webhooks recebidos ficam registrados
- Erros de pagamento são capturados

### Métricas Disponíveis

- Vendas por dia/período
- Receita líquida (após taxas MP)
- Número de transações
- Taxa de conversão
- Produtos mais vendidos

## 🔧 Configurações de Produção

### Segurança

```env
NODE_ENV=production
MERCADO_PAGO_ACCESS_TOKEN=APP-sua-producao-token
MERCADO_PAGO_PUBLIC_KEY=APP-sua-producao-public-key
BASE_URL=https://seu-dominio-producao.com
```

### Webhook em Produção

- Configure HTTPS obrigatório
- Habilite validação de IP
- Configure secret webhook
- Monitore logs de webhook

### Performance

- Configure rate limiting apropriado
- Monitore uso da API do MP
- Implemente cache onde necessário

## 🆘 Troubleshooting

### Webhook não está sendo recebido

1. Verifique se a URL está acessível externamente
2. Confirme configuração no painel MP
3. Verifique logs de `WebhookLog`

### Pagamento não atualiza status

1. Verifique se webhook está configurado
2. Confirme processamento sem erros
3. Verifique tabela `Payment`

### Erro de autenticação MP

1. Confirme access token válido
2. Verifique se está usando ambiente correto (TEST/PROD)
3. Confirme permissões da aplicação

## 📞 Suporte

- Documentação MP: https://www.mercadopago.com.br/developers
- SDKs: https://github.com/mercadopago
- Suporte técnico: através do painel do desenvolvedor
