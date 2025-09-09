# Guia da Nova API de Adicionais

## Resumo das Mudanças

A API de adicionais foi completamente refatorada para suportar:

1. **Preço base** do adicional (para venda separada)
2. **Preço customizado** quando vendido como adicional de um produto específico
3. **Gestão de compatibilidade** através de tabela de junção
4. **Preservação de histórico** de preços nos pedidos

## Estrutura dos Dados

### Adicional

```json
{
  "id": "uuid",
  "name": "Quadro Personalizado",
  "description": "Quadro decorativo",
  "price": 45.0, // Preço base (venda separada)
  "image_url": "url_da_imagem",
  "created_at": "2025-09-09T15:49:34.000Z",
  "updated_at": "2025-09-09T15:49:34.000Z",
  "compatible_products": [
    {
      "product_id": "produto_uuid",
      "product_name": "Cesta Romântica",
      "custom_price": 40.0, // Preço quando vendido com este produto
      "is_active": true
    }
  ]
}
```

## Endpoints da API

### 1. Listar Adicionais

```http
GET /additional
GET /additional?include_products=true
```

### 2. Buscar Adicional por ID

```http
GET /additional/:id
GET /additional/:id?include_products=true
```

### 3. Criar Adicional

```http
POST /additional
Content-Type: application/json

{
  "name": "Quadro Personalizado",
  "description": "Quadro decorativo",
  "price": 45.00,
  "compatible_products": [
    {
      "product_id": "produto_uuid",
      "custom_price": 40.00
    }
  ]
}
```

### 4. Atualizar Adicional

```http
PUT /additional/:id
Content-Type: application/json

{
  "name": "Novo Nome",
  "price": 50.00,
  "compatible_products": [
    {
      "product_id": "produto_uuid",
      "custom_price": 45.00
    }
  ]
}
```

### 5. Vincular Adicional a Produto

```http
POST /additional/:id/link
Content-Type: application/json

{
  "productId": "produto_uuid",
  "customPrice": 40.00  // Opcional
}
```

### 6. Atualizar Vínculo (Preço Customizado)

```http
PUT /additional/:id/link
Content-Type: application/json

{
  "productId": "produto_uuid",
  "customPrice": 35.00
}
```

### 7. Desvincular Adicional de Produto

```http
POST /additional/:id/unlink
Content-Type: application/json

{
  "productId": "produto_uuid"
}
```

### 8. Buscar Preço do Adicional

```http
GET /additional/:id/price
GET /additional/:id/price?productId=produto_uuid
```

**Resposta:**

```json
{
  "price": 40.0 // Preço customizado ou base
}
```

### 9. Buscar Adicionais de um Produto

```http
GET /products/:productId/additionals
```

## Lógica de Preços

### Preço Base vs Preço Customizado

1. **Venda separada**: Usa `additional.price` (R$ 45,00)
2. **Como adicional de produto**:
   - Se existe `custom_price` na relação → usa ele (R$ 40,00)
   - Senão → usa preço base (R$ 45,00)

### Exemplo Prático

```javascript
// Buscar preço para venda separada
GET /additional/uuid-quadro/price
// Retorna: { "price": 45.00 }

// Buscar preço como adicional de uma cesta
GET /additional/uuid-quadro/price?productId=uuid-cesta
// Retorna: { "price": 40.00 }
```

## Casos de Uso

### 1. Criar Adicional com Produtos Compatíveis

```javascript
const novoAdicional = {
  name: "Cartão Personalizado",
  description: "Cartão com mensagem especial",
  price: 15.0, // Preço se vendido separadamente
  compatible_products: [
    {
      product_id: "cesta-romantica-uuid",
      custom_price: 10.0, // Preço promocional quando vendido com a cesta
    },
    {
      product_id: "cesta-aniversario-uuid",
      custom_price: 12.0, // Preço diferente para outra cesta
    },
  ],
};
```

### 2. Adicionar ao Carrinho

```javascript
// Lógica no frontend/app
async function addToCart(additionalId, productId = null) {
  const response = await fetch(
    `/additional/${additionalId}/price?productId=${productId}`
  );
  const { price } = await response.json();

  // Adicionar ao carrinho com o preço correto
  cart.addItem({
    type: "additional",
    id: additionalId,
    price: price,
    productId: productId, // Para referência
  });
}
```

### 3. Gerenciar Preços Dinâmicos

```javascript
// Atualizar preço de um adicional para produto específico
await fetch(`/additional/${additionalId}/link`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    productId: productId,
    customPrice: 25.0, // Novo preço promocional
  }),
});
```

## Migração dos Dados Existentes

A migração foi executada automaticamente e:

1. ✅ Removeu o campo `compatible_with` da tabela `Additional`
2. ✅ Adicionou campos `custom_price`, `is_active`, `created_at`, `updated_at` na tabela `ProductAdditional`
3. ✅ Preservou todos os dados existentes
4. ✅ Migrou as associações da string serializada para a tabela de junção

## Vantagens da Nova Implementação

1. **Flexibilidade de Preços**: Cada produto pode ter preço diferente para o mesmo adicional
2. **Performance**: Queries mais eficientes com JOINs nativos
3. **Integridade**: Foreign keys garantem consistência
4. **Escalabilidade**: Fácil adicionar novos campos (desconto, validade, etc.)
5. **Histórico**: OrderItemAdditional preserva preço no momento da compra
6. **Manutenção**: Código mais limpo e sem duplicação
