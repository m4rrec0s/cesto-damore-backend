# 🔄 Agente AI Incremental - Ana Bot (Versão de Teste)

## 📋 Visão Geral

Esta é uma **versão experimental** do agente AI que opera em **modo incremental**, enviando múltiplas mensagens separadas durante o atendimento, criando uma experiência mais natural e conversacional.

## 🎯 Diferenças da Versão Atual

| Aspecto                   | Versão Atual (Batch)         | Versão Incremental (Nova)                     |
| ------------------------- | ---------------------------- | --------------------------------------------- |
| **Envio de mensagens**    | 1 mensagem completa no final | Múltiplas mensagens ao longo do processo      |
| **Mensagens de espera**   | ❌ Proibidas                 | ✅ Permitidas ("Vou olhar!", "Deixa eu ver!") |
| **Fragmentação**          | n8n + LLM separadora         | IA decide naturalmente                        |
| **Visibilidade de tools** | ❌ Nunca menciona            | ❌ Nunca menciona (regra mantida)             |
| **Experiência**           | Resposta completa formal     | Conversa natural progressiva                  |

## 🛠️ Arquitetura

### Sistema de Ações

A IA opera com 3 tipos de ação:

1. **[THINK]** - Raciocínio interno (não visível ao cliente)
2. **[SEND]** - Mensagem enviada ao cliente via Evolution API
3. **Tool Calls** - Execução de ferramentas (consultarCatalogo, validate_delivery_availability, etc)

### Fluxo de Exemplo

```
Cliente: "Quero flores para hoje"
  ↓
[THINK] Cliente quer flores. Vou buscar no catálogo.
[SEND] "Que lindo! Deixa eu ver as melhores flores! 💐"
[TOOL] consultarCatalogo(termo="flores")
  → Retorna 2 produtos
[THINK] Recebi 2 produtos. Vou enviar separadamente.
[SEND] "Olha que linda essa rosa! 🌹 R$ 95,00"
[SEND] "E essa margarida também é linda! 🌼 R$ 80,00"
[THINK] Agora preciso validar horários.
[SEND] "Deixa eu ver os horários disponíveis..."
[TOOL] validate_delivery_availability(date="2026-01-30")
  → Retorna horários
[SEND] "Para hoje temos: 10h, 14h ou 16h. Qual você prefere?"
```

## 📁 Arquivos Criados

### `aiAgentServiceIncremental.ts`

Serviço principal com a lógica incremental:

- `chatIncremental()` - Método principal de chat
- `runIncrementalLoop()` - Loop de execução de ações
- `parseMessageAction()` - Detecta tipo de mensagem ([THINK], [SEND], etc)
- `sendToClient()` - Envia mensagem via Evolution API

### `test-incremental-chat.ts`

Script de teste que simula uma conversa completa:

- Teste 1: Cliente pede flores
- Teste 2: Cliente escolhe horário
- Teste 3: Cliente informa endereço
- Exibe histórico completo no final

## 🚀 Como Executar

### 1. Certifique-se que o servidor está rodando

```bash
cd Backend
npm run dev
```

### 2. Em outro terminal, execute o teste

```bash
cd Backend
npm run test:incremental
```

### 3. Observe o output colorido

O teste mostra:

- 👤 Mensagens do cliente (verde)
- 🤖 Respostas da Ana (azul)
- 💭 Pensamentos internos (magenta)
- 🔧 Execuções de ferramentas (ciano)
- ⚙️ Logs do sistema (amarelo)

## 📊 Banco de Dados

Todas as mensagens são salvas com flags específicas:

```sql
-- Mensagem enviada ao cliente
sent_to_client: true

-- Mensagem com tool calls
tool_calls: JSON (stringified)

-- Mensagem de tool result
role: "tool"
tool_call_id: "call_abc123"
name: "consultarCatalogo"
```

## ⚙️ Configuração

### Variáveis de Ambiente Necessárias

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=your-api-key
EVOLUTION_API_INSTANCE=ana-bot

# MCP Server
MCP_SERVER_URL=http://localhost:5000/mcp/sse
```

## 🎭 Regras de Comportamento

### ✅ PERMITIDO

- "Vou olhar aqui!"
- "Deixa eu ver!"
- "Só um instantinho!"
- "Vou buscar as melhores opções!"

### ❌ PROIBIDO

- "Vou usar a tool consultarCatalogo"
- "Chamando validate_delivery_availability"
- "Executando calculate_freight"
- Mencionar qualquer aspecto técnico/ferramentas

### 🔒 OBRIGATÓRIO

- Se disser "vou buscar", DEVE executar a busca
- Se prometer validar, DEVE validar
- Nunca prometer sem executar

## 📈 Vantagens

1. **Experiência Natural**: Cliente sente conversa fluida
2. **Feedback Progressivo**: Cliente vê atividade imediata
3. **Controle Total**: 1 LLM em vez de 2 (elimina separadora ruim)
4. **Flexibilidade**: IA pode usar múltiplas tools livremente
5. **Verificação**: Think mode previne erros antes de enviar

## ⚠️ Limitações Atuais

1. **Teste Local**: Apenas para ambiente de desenvolvimento
2. **Evolution API**: Requer configuração correta
3. **Rate Limits**: Sem proteção contra spam ainda
4. **Custos**: Mais chamadas à Evolution API (a monitorar)

## 🔜 Próximos Passos

1. **Teste em Produção**: Validar com clientes reais
2. **Métricas**: Adicionar tracking de mensagens enviadas
3. **Rate Limiting**: Prevenir spam de mensagens
4. **Otimização de Custos**: Analisar uso da Evolution API
5. **A/B Testing**: Comparar com versão batch

## 📞 Endpoint

```
POST /ai/agent/chat-incremental

Body:
{
  "sessionId": "test-123",
  "message": "Quero flores para hoje",
  "customerPhone": "5583999887766",
  "customerName": "Cliente Teste"
}

Response:
{
  "success": true,
  "message": "Processing started. Messages will be sent incrementally."
}
```

**Nota**: O endpoint retorna imediatamente. As mensagens são enviadas de forma assíncrona via Evolution API.

## 🐛 Debug

Para ver os logs detalhados:

```bash
# Terminal 1: Servidor
npm run dev

# Terminal 2: Teste
npm run test:incremental

# Observe os logs em tempo real
```

---

**Status**: 🧪 Em Teste  
**Versão**: 1.0.0-beta  
**Data**: 30 de Janeiro de 2026
