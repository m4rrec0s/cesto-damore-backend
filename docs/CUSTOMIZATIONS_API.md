# API de Customizações

## Rotas de Customizações

### Listar customizações

```
GET /customizations?itemId={optional}
Headers: Authorization: Bearer {token}
```

### Buscar customização por ID

```
GET /customizations/:id
Headers: Authorization: Bearer {token}
```

### Criar customização

```
POST /customizations
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "item_id": "uuid",
  "type": "TEXT" | "IMAGES" | "MULTIPLE_CHOICE" | "BASE_LAYOUT",
  "name": "string",
  "description": "string",
  "isRequired": boolean,
  "price": number,
  "customization_data": {
    // Estrutura varia de acordo com o tipo
  }
}
```

### Atualizar customização

```
PUT /customizations/:id
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body: (todos os campos opcionais)
{
  "name": "string",
  "description": "string",
  "isRequired": boolean,
  "price": number,
  "customization_data": {}
}
```

### Deletar customização

```
DELETE /customizations/:id
Headers: Authorization: Bearer {token}
```

### Buscar customizações de um item (público)

```
GET /items/:itemId/customizations
```

### Validar customizações (público)

```
POST /customizations/validate
Content-Type: application/json

Body:
{
  "itemId": "uuid",
  "inputs": [
    {
      "customization_id": "uuid",
      "customization_type": "TEXT",
      "data": {}
    }
  ]
}
```

### Gerar preview (público)

```
POST /customizations/preview
Content-Type: application/json

Body:
{
  "itemId": "uuid",
  "customizations": [
    {
      "customization_id": "uuid",
      "customization_type": "TEXT",
      "data": {}
    }
  ]
}
```

## Rotas de Layouts 3D

### Listar layouts

```
GET /layouts?itemId={optional}
Headers: Authorization: Bearer {token}
```

### Buscar layout por ID

```
GET /layouts/:id
Headers: Authorization: Bearer {token}
```

### Criar layout

```
POST /layouts
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "item_id": "uuid",
  "name": "string",
  "layout_data": {
    "model_url": "string",
    "print_areas": [],
    "camera_position": { "x": 0, "y": 5, "z": 10 },
    "camera_target": { "x": 0, "y": 0, "z": 0 }
  }
}
```

### Atualizar layout

```
PUT /layouts/:id
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body: (campos opcionais)
{
  "name": "string",
  "layout_data": {}
}
```

### Deletar layout

```
DELETE /layouts/:id
Headers: Authorization: Bearer {token}
```

### Upload de modelo 3D

```
POST /layouts/upload-3d
Headers: Authorization: Bearer {token}
Content-Type: multipart/form-data

Body (FormData):
- model: arquivo .glb ou .gltf

Response:
{
  "success": true,
  "url": "/3d-models/model-123456.glb",
  "filename": "model-123456.glb",
  "size": 1234567
}
```

### Servir modelo 3D

```
GET /3d-models/:filename
```

## Estruturas de customization_data por tipo

### TEXT

```json
{
  "fields": [
    {
      "id": "field-1",
      "label": "Nome",
      "placeholder": "Digite o nome",
      "required": true,
      "max_length": 50
    }
  ]
}
```

### IMAGES

```json
{
  "base_layout": {
    "max_images": 5,
    "min_width": 800,
    "min_height": 800,
    "max_file_size_mb": 10,
    "accepted_formats": ["image/jpeg", "image/png", "image/webp"]
  }
}
```

### MULTIPLE_CHOICE

```json
{
  "options": [
    {
      "id": "option-1",
      "label": "Tamanho Grande",
      "description": "Adicional de 50cm",
      "price_modifier": 10.0
    }
  ],
  "min_selection": 1,
  "max_selection": 3
}
```

### BASE_LAYOUT

```json
{
  "layouts": [
    {
      "id": "layout-uuid",
      "name": "Layout Caneca Clássica",
      "model_url": "/3d-models/model-123.glb"
    }
  ]
}
```
