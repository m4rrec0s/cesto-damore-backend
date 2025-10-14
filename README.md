# Customização de Cestas – Visão Geral 2025

Este backend foi refatorado para dar suporte ao novo fluxo de personalização de cestas sem dependência de arquivos temporários no servidor. Abaixo um resumo rápido do que mudou:

## Principais mudanças

- **Serviços especializados**

  - `customizationService` agora retorna layouts, regras estruturadas e regras legadas em um formato unificado e também monta o payload para preview 3D.
  - `orderCustomizationService` centraliza o registro de customizações dos itens do pedido e faz o upload definitivo das artes para o Google Drive após o pagamento aprovado.

- **API reorganizada**

  - `GET /customizations/:itemType/:itemId` entrega toda a configuração necessária para o frontend renderizar a etapa de personalização.
  - `POST /customizations/validate` valida as escolhas do cliente antes de seguir com o pedido.
  - `POST /customizations/preview` retorna as instruções de renderização (layout, fotos e textos) para o preview em 3D.
  - `POST /orders/:orderId/items/:itemId/customizations` grava a customização final (incluindo a arte em base64) e `GET /orders/:orderId/customizations` lista o que foi salvo para revisão.

- **Sem arquivos temporários no backend**

  - Uploads instantâneos ficam a cargo do frontend (ex.: `localStorage`). O backend apenas persiste metadados e recebe a arte final renderizada para impressão.

- **Upload definitivo para o Drive**
  - Ao confirmar o pagamento, `orderCustomizationService.finalizeOrderCustomizations` cria a pasta do pedido no Google Drive, envia as artes finais e registra a URL pública.

## Scripts de teste

- `tests/test-new-customization-flow.ts` executa o fluxo ponta a ponta via serviços, gerando uma arte fictícia, salvando a customização do pedido e, se o Google Drive estiver configurado, realizando o upload final.

> Execute `npm run build` para garantir a compilação antes de rodar os scripts. O upload para o Google Drive só ocorre se as credenciais OAuth estiverem configuradas (caso contrário o teste pula essa etapa com um aviso).
