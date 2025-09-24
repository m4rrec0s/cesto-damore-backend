# Sistema de Configuração de Feed - Cesto d'Amore

## Visão Geral

O sistema de configuração de Feed permite que administradores configurem a página inicial e outras páginas do cliente de forma dinâmica e flexível. O sistema inclui banners promocionais, seções de produtos, categorias em destaque e adicionais.

## Estrutura do Sistema

### 1. Configuração de Feed (`FeedConfiguration`)

A configuração principal que define:

- Nome da configuração
- Se está ativa
- Quais seções mostrar (banners, produtos recomendados, etc.)
- Limites máximos para cada tipo de seção

### 2. Banners Promocionais (`FeedBanner`)

Banners que podem conter:

- Título e subtítulo
- Imagem de fundo
- Botão com texto e link personalizável
- Cores customizáveis (fundo, texto, botão)
- Data de início e fim de exibição
- Ordem de exibição

### 3. Seções de Feed (`FeedSection`)

Seções que organizam o conteúdo:

- Produtos Recomendados
- Produtos com Desconto
- Categorias em Destaque
- Adicionais em Destaque
- Produtos Personalizados
- Novos Produtos
- Mais Vendidos

### 4. Itens das Seções (`FeedSectionItem`)

Itens individuais dentro das seções, que podem ser:

- Produtos
- Categorias
- Adicionais

## API Endpoints

### Rotas Públicas

#### Obter Feed Público

```
GET /feed?config_id=<opcional>
```

Retorna a configuração de feed ativa para exibição no cliente.

#### Tipos de Seção Disponíveis

```
GET /feed/section-types
```

Retorna lista dos tipos de seção disponíveis.

### Rotas Administrativas (Requerem autenticação de Admin)

#### Configurações de Feed

**Listar todas as configurações:**

```
GET /admin/feed/configurations
```

**Obter configuração específica:**

```
GET /admin/feed/configurations/:id
```

**Criar nova configuração:**

```
POST /admin/feed/configurations
Content-Type: application/json

{
  "name": "Home Page Feed",
  "is_active": true,
  "show_banners": true,
  "show_recommended": true,
  "show_discounted": true,
  "show_categories": true,
  "show_additionals": true,
  "max_recommended": 6,
  "max_discounted": 4,
  "max_categories": 8,
  "max_additionals": 6
}
```

**Atualizar configuração:**

```
PUT /admin/feed/configurations/:id
Content-Type: application/json

{
  "name": "Nova Nome",
  "max_recommended": 8
}
```

**Deletar configuração:**

```
DELETE /admin/feed/configurations/:id
```

#### Banners

**Criar banner:**

```
POST /admin/feed/banners
Content-Type: multipart/form-data

feed_config_id: "uuid-da-configuração"
title: "Promoção de Verão"
subtitle: "Até 50% de desconto"
button_text: "Ver Ofertas"
button_url: "/produtos?desconto=true"
background_color: "#FF6B6B"
text_color: "#FFFFFF"
button_color: "#4ECDC4"
image: [arquivo]
start_date: "2025-01-01"
end_date: "2025-01-31"
display_order: 0
```

**Atualizar banner:**

```
PUT /admin/feed/banners/:id
Content-Type: multipart/form-data

title: "Novo Título"
image: [novo arquivo] (opcional)
```

**Deletar banner:**

```
DELETE /admin/feed/banners/:id
```

#### Seções

**Criar seção:**

```
POST /admin/feed/sections
Content-Type: application/json

{
  "feed_config_id": "uuid-da-configuração",
  "title": "Produtos em Destaque",
  "section_type": "FEATURED_PRODUCTS",
  "max_items": 8,
  "show_view_all": true,
  "view_all_url": "/produtos",
  "display_order": 1
}
```

**Atualizar seção:**

```
PUT /admin/feed/sections/:id
Content-Type: application/json

{
  "title": "Novo Título da Seção",
  "max_items": 12
}
```

**Deletar seção:**

```
DELETE /admin/feed/sections/:id
```

#### Itens das Seções

**Criar item:**

```
POST /admin/feed/section-items
Content-Type: application/json

{
  "feed_section_id": "uuid-da-seção",
  "item_type": "product",
  "item_id": "uuid-do-produto",
  "display_order": 0,
  "is_featured": true,
  "custom_title": "Produto Especial",
  "custom_subtitle": "Edição Limitada"
}
```

**Atualizar item:**

```
PUT /admin/feed/section-items/:id
Content-Type: application/json

{
  "display_order": 1,
  "custom_title": "Novo Título"
}
```

**Deletar item:**

```
DELETE /admin/feed/section-items/:id
```

## Tipos de Seção

1. **RECOMMENDED_PRODUCTS**: Produtos selecionados automaticamente
2. **DISCOUNTED_PRODUCTS**: Produtos com desconto > 0
3. **FEATURED_CATEGORIES**: Categorias principais
4. **FEATURED_ADDITIONALS**: Adicionais populares
5. **CUSTOM_PRODUCTS**: Produtos selecionados manualmente
6. **NEW_ARRIVALS**: Produtos mais recentes
7. **BEST_SELLERS**: Produtos mais vendidos (implementação futura)

## Funcionalidades Automáticas

### Preenchimento Automático de Seções

Se uma seção não tem itens manuais, o sistema preenche automaticamente:

- **Produtos Recomendados**: Produtos mais recentes
- **Produtos com Desconto**: Produtos ordenados por maior desconto
- **Categorias em Destaque**: Categorias ordenadas alfabeticamente
- **Adicionais em Destaque**: Adicionais mais recentes
- **Novos Produtos**: Produtos ordenados por data de criação

### Validação de Datas para Banners

Banners com `start_date` e `end_date` só aparecem no período configurado.

### Processamento de Imagens

Banners têm suas imagens automaticamente:

- Redimensionadas para 1920x600px (formato otimizado para banners)
- Convertidas para WebP (melhor compressão)
- Comprimidas com qualidade 85%

## Exemplo de Resposta do Feed Público

```json
{
  "id": "feed-config-uuid",
  "name": "Home Page Feed",
  "is_active": true,
  "banners": [
    {
      "id": "banner-uuid",
      "title": "Promoção de Verão",
      "subtitle": "Até 50% de desconto",
      "image_url": "/images/banner_123.webp",
      "button_text": "Ver Ofertas",
      "button_url": "/produtos?desconto=true",
      "background_color": "#FF6B6B",
      "text_color": "#FFFFFF",
      "button_color": "#4ECDC4",
      "display_order": 0
    }
  ],
  "sections": [
    {
      "id": "section-uuid",
      "title": "Produtos Recomendados",
      "section_type": "RECOMMENDED_PRODUCTS",
      "max_items": 6,
      "show_view_all": true,
      "view_all_url": "/produtos",
      "items": [
        {
          "id": "item-uuid",
          "item_type": "product",
          "item_id": "product-uuid",
          "is_featured": false,
          "item_data": {
            "id": "product-uuid",
            "name": "Cesta Romântica",
            "price": 85.90,
            "image_url": "/images/product.webp",
            "categories": [...]
          }
        }
      ]
    }
  ],
  "configuration": {
    "show_banners": true,
    "show_recommended": true,
    "max_recommended": 6
  }
}
```

## Fluxo de Trabalho Recomendado

### 1. Configuração Inicial

1. Criar uma nova configuração de feed
2. Definir limites máximos para cada seção
3. Ativar a configuração

### 2. Adição de Banners

1. Criar banners promocionais com imagens atrativas
2. Definir períodos de exibição
3. Configurar links para páginas relevantes

### 3. Configuração de Seções

1. Criar seções para diferentes tipos de conteúdo
2. Definir ordem de exibição
3. Para seções customizadas, adicionar itens manualmente

### 4. Manutenção

1. Monitorar datas de banners
2. Atualizar seções conforme necessário
3. Ajustar limites baseado no desempenho

## Segurança

- Todas as rotas administrativas requerem autenticação
- Apenas usuários com role de admin podem configurar feeds
- Validação de tipos de arquivo para upload de imagens
- Limpeza automática de imagens ao deletar banners

## Limitações e Considerações

1. **Imagens**: Banners são redimensionados para 1920x600px
2. **Performance**: Feeds com muitas seções podem impactar performance
3. **Cache**: Considere implementar cache para feeds públicos
4. **Backup**: Sempre faça backup antes de deletar configurações

## Próximas Melhorias

1. Analytics de cliques em banners
2. A/B testing para diferentes configurações
3. Agendamento automático de banners
4. Templates de configuração pré-definidos
5. Implementação real de "Mais Vendidos" baseado em dados de vendas
