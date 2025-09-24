# API de Consulta de CEP - Cesto d'Amore

## Visão Geral

A API agora possui integração com a API ViaCEP para validação e consulta de informações de endereço a partir do CEP (Código de Endereçamento Postal).

## Funcionalidades Implementadas

### 1. Validação de CEP em Usuários

Os campos de endereço dos usuários agora incluem validação automática de CEP:

- **Campos disponíveis:**

  - `address` (string): Logradouro
  - `city` (string): Cidade
  - `state` (string): Estado (UF)
  - `zip_code` (string): CEP

- **Validações:**
  - Formato de CEP: aceita `12345-678` ou `12345678`
  - Automaticamente formata para o padrão `12345-678`
  - Validação opcional (não obrigatória)

### 2. Nova Rota de Consulta de CEP

**Endpoint:** `GET /users/cep/:zipCode`

**Descrição:** Consulta informações de endereço a partir de um CEP.

**Parâmetros:**

- `zipCode` (string): CEP a ser consultado (com ou sem formatação)

**Exemplo de Requisição:**

```http
GET /users/cep/01310-100
```

**Exemplo de Resposta (200):**

```json
{
  "zip_code": "01310-100",
  "address": "Avenida Paulista",
  "neighborhood": "Bela Vista",
  "city": "São Paulo",
  "state": "SP",
  "additional_info": {
    "ibge_code": "3550308",
    "ddd": "11"
  }
}
```

**Códigos de Resposta:**

- `200 OK`: CEP encontrado com sucesso
- `400 Bad Request`: Formato de CEP inválido
- `404 Not Found`: CEP não encontrado
- `503 Service Unavailable`: Serviço de CEP temporariamente indisponível
- `500 Internal Server Error`: Erro interno do servidor

## Exemplos de Uso

### 1. Criando Usuário com CEP

```json
POST /users
Content-Type: application/json

{
  "name": "João Silva",
  "email": "joao@email.com",
  "firebaseUId": "firebase123",
  "phone": "(11) 99999-9999",
  "zip_code": "01310100",
  "address": "Avenida Paulista, 1000",
  "city": "São Paulo",
  "state": "SP"
}
```

### 2. Atualizando Endereço do Usuário

```json
PUT /users/user-id-123
Content-Type: application/json

{
  "zip_code": "04038-001",
  "address": "Rua Vergueiro, 500",
  "city": "São Paulo",
  "state": "SP"
}
```

### 3. Consultando CEP

```http
GET /users/cep/04038-001
```

Resposta:

```json
{
  "zip_code": "04038-001",
  "address": "Rua Vergueiro",
  "neighborhood": "Liberdade",
  "city": "São Paulo",
  "state": "SP",
  "additional_info": {
    "ibge_code": "3550308",
    "ddd": "11"
  }
}
```

## Tratamento de Erros

### Erros de Validação de CEP

- **CEP com formato inválido:**

```json
{
  "error": "Formato de CEP inválido. Use o formato 00000-000 ou 00000000"
}
```

- **CEP não encontrado:**

```json
{
  "error": "CEP não encontrado"
}
```

- **Serviço indisponível:**

```json
{
  "error": "Serviço de CEP temporariamente indisponível"
}
```

### Timeout de Requisição

A API possui timeout de 5 segundos para consultas de CEP. Caso exceda este tempo:

```json
{
  "error": "Timeout na consulta do CEP. Tente novamente."
}
```

## Fluxo Recomendado para Frontend

1. **Captura do CEP:** Usuario digita o CEP
2. **Consulta automática:** Chamar `GET /users/cep/:zipCode`
3. **Preenchimento automático:** Preencher campos de endereço automaticamente
4. **Validação:** Permitir que usuário edite se necessário
5. **Salvamento:** Enviar dados completos para `POST /users` ou `PUT /users/:id`

## Integração com ViaCEP

- **API utilizada:** https://viacep.com.br/
- **Gratuita:** Sem necessidade de API key
- **Confiável:** Mantida pelos Correios
- **Timeout configurado:** 5 segundos
- **User-Agent personalizado:** "Cesto-dAmore-Backend/1.0"

## Observações

- A validação de CEP é **opcional** - usuários podem não fornecer CEP
- CEPs são automaticamente formatados no padrão brasileiro (12345-678)
- A API funciona mesmo se o serviço ViaCEP estiver indisponível
- Logs de erro são gerados para debugging
- Integração transparente com validações existentes do userService
