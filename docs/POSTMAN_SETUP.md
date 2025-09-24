# Instruções para Upload de Imagens no Postman

## Problema Identificado

O script de teste funciona, mas o Postman não está enviando a imagem corretamente.

## Configuração Correta do Postman

### 1. Método e URL

- **Método**: POST
- **URL**: `http://localhost:8080/api/products`

### 2. Headers

**NÃO adicione** manualmente o header `Content-Type`. O Postman deve configurar automaticamente como `multipart/form-data` com boundary.

### 3. Body

- Selecione **form-data** (não raw, não x-www-form-urlencoded)
- Configure os campos exatamente assim:

| Key           | Type     | Value                                  |
| ------------- | -------- | -------------------------------------- |
| `name`        | Text     | `Pelúcia d'Amore`                      |
| `description` | Text     | `Cesta com urso de pelúcia...`         |
| `price`       | Text     | `157.90`                               |
| `is_active`   | Text     | `true`                                 |
| `type_id`     | Text     | `ec5e67b8-5b25-4174-a549-d0ec03b5d863` |
| `category_id` | Text     | `d90fc080-ceae-4f1e-9e7b-9e025a827ee2` |
| `image`       | **File** | Selecionar arquivo de imagem           |

### 4. Campo de Imagem

- **IMPORTANTE**: O campo `image` deve ter o tipo **File**, não Text
- Clique no dropdown ao lado de "Key" e selecione "File"
- Clique em "Select Files" e escolha sua imagem

### 5. Endpoints de Debug (se ainda não funcionar)

#### Teste 1: Debug básico

- **URL**: `http://localhost:8080/api/test/debug-multipart`
- **Método**: POST
- Configure o body da mesma forma e veja o que o servidor recebe

#### Teste 2: Upload com uploadAny

- **URL**: `http://localhost:8080/api/products-debug`
- **Método**: POST
- Este endpoint aceita qualquer configuração de campo

## Verificações

1. **Confirme que o servidor está rodando**: `npm run dev`
2. **Verifique os logs do servidor**: O controller faz log detalhado de tudo que recebe
3. **Teste o endpoint de debug primeiro**: Para ver exatamente o que o Postman está enviando

## Possíveis Problemas do Postman

1. **Tipo de campo incorreto**: Campo `image` como Text em vez de File
2. **Headers manuais**: Content-Type configurado manualmente
3. **Versão do Postman**: Algumas versões têm bugs com multipart/form-data
4. **Arquivo muito grande**: Limite é 8MB

## Alternativa: Usar cURL

Se o Postman continuar com problemas, use este comando cURL:

```bash
curl -X POST http://localhost:8080/api/products \
  -F "name=Pelúcia d'Amore" \
  -F "description=Cesta com urso de pelúcia..." \
  -F "price=157.90" \
  -F "is_active=true" \
  -F "type_id=ec5e67b8-5b25-4174-a549-d0ec03b5d863" \
  -F "category_id=d90fc080-ceae-4f1e-9e7b-9e025a827ee2" \
  -F "image=@caminho/para/sua/imagem.jpg"
```
