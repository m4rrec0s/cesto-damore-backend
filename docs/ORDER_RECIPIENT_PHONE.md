# Campo recipient_phone no Order

## Descrição

O campo `recipient_phone` foi adicionado ao modelo `Order` para armazenar o número de telefone do destinatário da cesta/pedido.

## Motivação

- Permite identificar o destinatário do pedido
- Facilita a entrega quando o pedido é um presente
- Melhora a comunicação para confirmar entregas

## Schema

```prisma
model Order {
  // ... outros campos
  recipient_phone  String?     // Número do destinatário da cesta
  // ... outros campos
}
```

## Migration

A migration `20251022152000_add_recipient_phone_to_order` adiciona a coluna `recipient_phone` na tabela `Order`.

```sql
ALTER TABLE "Order" ADD COLUMN "recipient_phone" TEXT;
```

## API

### Criar Pedido

**Endpoint:** `POST /orders`

**Body:**

```json
{
  "user_id": "uuid",
  "items": [...],
  "delivery_address": "string",
  "delivery_city": "string",
  "delivery_state": "string",
  "delivery_date": "ISO8601 DateTime",
  "payment_method": "pix" | "card",
  "recipient_phone": "string (obrigatório)",
  "shipping_price": number,
  "grand_total": number
}
```

### Validações

1. **Obrigatoriedade:** O campo `recipient_phone` é obrigatório
2. **Formato:** Deve conter apenas números (caracteres não numéricos serão removidos no frontend)
3. **Tamanho:** Deve ter entre 10 e 11 dígitos (após remoção de caracteres especiais)

**Exemplos válidos:**

- `11987654321` (celular com DDD)
- `1938887777` (fixo com DDD)

**Exemplos inválidos:**

- `123456789` (menos de 10 dígitos)
- `119876543210` (mais de 11 dígitos)
- `` (vazio)

### Mensagens de Erro

- `"Número do destinatário é obrigatório"` - Campo não preenchido
- `"Número do destinatário deve ter entre 10 e 11 dígitos"` - Formato inválido

## Frontend

### Interface de Usuário

Na tela de checkout (carrinho), foi adicionado:

1. **Campo de Telefone do Destinatário**

   - Label: "🎁 Telefone do Destinatário \*"
   - Placeholder: "+55 (XX) XXXXX-XXXX"
   - Formatação automática com máscara

2. **Checkbox "Eu vou receber"**
   - Quando marcado, oculta o campo de telefone do destinatário
   - Automaticamente copia o telefone do cliente para o campo recipient_phone
   - Melhora a experiência quando o cliente é o destinatário

### Validação no Frontend

- Campo obrigatório para prosseguir para a etapa de pagamento
- Validação de formato (10 ou 11 dígitos)
- Mensagem de erro: "⚠️ Telefone incompleto"

### Estados

```typescript
const [recipientPhone, setRecipientPhone] = useState("");
const [isSelfRecipient, setIsSelfRecipient] = useState(false);

// Sincronização automática quando "eu vou receber" é marcado
useEffect(() => {
  if (isSelfRecipient) {
    setRecipientPhone(customerPhone);
  }
}, [isSelfRecipient, customerPhone]);
```

## Fluxo de Criação de Pedido

1. Cliente preenche dados de entrega
2. Cliente preenche seu telefone (customerPhone)
3. Cliente pode:
   - Marcar "Eu vou receber" → recipientPhone = customerPhone
   - Ou preencher manualmente o telefone do destinatário
4. Na finalização:
   - recipientPhone é enviado para o backend (apenas números)
   - Backend valida formato e obrigatoriedade
   - Pedido é criado com o recipient_phone armazenado

## Observações

- O campo aceita `null` no schema do Prisma, mas é validado como obrigatório no service layer
- No frontend, caracteres não numéricos são removidos antes do envio
- A formatação visual com máscara é aplicada apenas na interface
- Quando "Eu vou receber" está marcado, o campo é oculto mas o valor é definido automaticamente
