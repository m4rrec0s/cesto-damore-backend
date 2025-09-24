# 🌐 Testando Webhooks com ngrok (Opcional)

Se você quiser testar webhooks reais do Mercado Pago mesmo localmente, pode usar o **ngrok** para expor sua aplicação local.

## 🚀 Configuração do ngrok

### 1. Instalar ngrok

```bash
# Windows (Chocolatey)
choco install ngrok

# ou baixar de: https://ngrok.com/download
```

### 2. Autenticar ngrok

```bash
ngrok authtoken SEU_TOKEN_DO_NGROK
```

### 3. Expor aplicação local

```bash
# Expor porta 3000 (onde sua aplicação roda)
ngrok http 3000
```

### 4. Resultado

```
ngrok by @inconshreveable

Session Status                online
Account                       seu-email@example.com
Version                       3.0.0
Region                        United States (us)
Forwarding                    https://abc123.ngrok.io -> http://localhost:3000
Forwarding                    http://abc123.ngrok.io -> http://localhost:3000

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

## 🔧 Configurar Webhook no Mercado Pago

### 1. Acessar Painel do Desenvolvedor

- Vá para: https://www.mercadopago.com.br/developers
- Acesse "Suas integrações"
- Selecione sua aplicação

### 2. Configurar Webhook

- Vá em "Webhooks"
- URL: `https://abc123.ngrok.io/webhook/mercadopago`
- Eventos: ✅ Payments, ✅ Merchant Orders

### 3. Atualizar .env

```env
# Usar URL do ngrok
BASE_URL="https://abc123.ngrok.io"
```

## 🧪 Testando com Webhook Real

### 1. Criar Pagamento de Teste

```bash
# Executar teste que cria pagamento real
node test-mercadopago.js
```

### 2. Efetuar Pagamento

- Use dados de teste do MP
- PIX: CPF 12345678909
- Cartão: 4111 1111 1111 1111

### 3. Monitorar Webhooks

```bash
# Ver logs em tempo real
node -e "
const axios = require('axios');
setInterval(async () => {
  try {
    const response = await axios.get('http://localhost:3000/test/webhook/logs?limit=1', {
      headers: { 'Authorization': 'Bearer SEU_TOKEN' }
    });
    if (response.data.data.logs.length > 0) {
      const latest = response.data.data.logs[0];
      console.log(\`\${new Date().toLocaleTimeString()} - \${latest.topic} - \${latest.processed ? '✅' : '⏳'}\`);
    }
  } catch (error) {
    console.error('Erro:', error.message);
  }
}, 2000);
"
```

## 📊 Dashboard em Tempo Real

Crie um arquivo `webhook-monitor.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Webhook Monitor - Cesto d'Amore</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 20px;
      }
      .status {
        padding: 10px;
        margin: 5px 0;
        border-radius: 5px;
      }
      .success {
        background-color: #d4edda;
        color: #155724;
      }
      .error {
        background-color: #f8d7da;
        color: #721c24;
      }
      .pending {
        background-color: #fff3cd;
        color: #856404;
      }
      .refresh {
        margin: 10px 0;
      }
    </style>
  </head>
  <body>
    <h1>🎯 Webhook Monitor</h1>
    <button onclick="loadDashboard()" class="refresh">🔄 Atualizar</button>

    <div id="dashboard"></div>
    <div id="logs"></div>

    <script>
      const API_BASE = "http://localhost:3000";
      const JWT_TOKEN = "SEU_JWT_TOKEN_AQUI";

      async function loadDashboard() {
        try {
          const response = await fetch(`${API_BASE}/test/webhook/dashboard`, {
            headers: { Authorization: `Bearer ${JWT_TOKEN}` },
          });
          const data = await response.json();

          document.getElementById("dashboard").innerHTML = `
                    <h2>📊 Resumo</h2>
                    <div class="status success">
                        Total de Pagamentos: ${data.data.summary.total_payments}
                    </div>
                    <div class="status pending">
                        Pendentes: ${data.data.summary.pending_payments}
                    </div>
                    <div class="status success">
                        Aprovados: ${data.data.summary.approved_payments}
                    </div>
                    <div class="status error">
                        Rejeitados: ${data.data.summary.rejected_payments}
                    </div>
                    <div class="status">
                        Taxa de Conversão: ${data.data.summary.conversion_rate}%
                    </div>
                `;

          loadLogs();
        } catch (error) {
          console.error("Erro ao carregar dashboard:", error);
        }
      }

      async function loadLogs() {
        try {
          const response = await fetch(
            `${API_BASE}/test/webhook/logs?limit=10`,
            {
              headers: { Authorization: `Bearer ${JWT_TOKEN}` },
            }
          );
          const data = await response.json();

          const logsHtml = data.data.logs
            .map(
              (log) => `
                    <div class="status ${
                      log.processed ? "success" : "pending"
                    }">
                        ${log.topic} - ${log.resource_id} - 
                        ${new Date(log.created_at).toLocaleString()} - 
                        ${log.processed ? "✅ Processado" : "⏳ Pendente"}
                        ${
                          log.error_message ? `<br>❌ ${log.error_message}` : ""
                        }
                    </div>
                `
            )
            .join("");

          document.getElementById("logs").innerHTML = `
                    <h2>📝 Logs Recentes</h2>
                    ${logsHtml}
                `;
        } catch (error) {
          console.error("Erro ao carregar logs:", error);
        }
      }

      // Auto-refresh a cada 5 segundos
      setInterval(loadDashboard, 5000);
      loadDashboard();
    </script>
  </body>
</html>
```

## ⚠️ Importante para Produção

### Quando for para produção:

1. **Remover todas as rotas `/test/webhook/*`**
2. **Configurar webhook real no domínio de produção**
3. **Habilitar validação de IP do webhook**
4. **Usar HTTPS obrigatório**

### Arquivo `.env` de produção:

```env
NODE_ENV=production
BASE_URL=https://seu-dominio-producao.com
MERCADO_PAGO_ACCESS_TOKEN=APP-production-token
# Remover ou comentar variáveis de teste
```

## 🎯 Vantagens de Cada Método

### 🏠 Simulador Local (Recomendado para desenvolvimento)

- ✅ Rápido e fácil
- ✅ Não depende de internet
- ✅ Controle total dos cenários
- ✅ Debug mais fácil

### 🌐 ngrok + Webhook Real

- ✅ Testa integração real com MP
- ✅ Valida comportamento real
- ❌ Mais complexo de configurar
- ❌ Requer internet estável

**💡 Recomendação: Use o simulador local para 90% do desenvolvimento e ngrok apenas para validação final antes de produção.**
