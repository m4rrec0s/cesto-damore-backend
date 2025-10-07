# 📘 GUIA DE IMPLEMENTAÇÃO — ITENS 3D COM PREVIEW EM TEMPO REAL

Este documento descreve como implementar a **visualização 3D em tempo real** de **canecas** e **quadros personalizados** na plataforma **Cesto d’Amore**, utilizando a biblioteca [Three.js](https://threejs.org/docs/).

---

## 🧩 Objetivo

Permitir que o cliente visualize, em tempo real, as **customizações aplicadas a produtos 3D** (caneca e quadro), incluindo:

- Inserção de **imagens personalizadas** (upload);
- Inserção de **texto** (nome, frase ou data);
- Alteração dinâmica de modelos e artes;
- Atualização em tempo real do **preview** conforme o cliente altera o produto.

---

## ⚙️ Estrutura Geral

### Backend (Node.js / Express)

O backend deve ser responsável por:

1. **Enviar a estrutura base de customização** de cada produto;
2. **Fornecer o layout base** (texturas, imagens e áreas customizáveis);
3. **Definir as limitações de texto** (ex: número máximo de caracteres, posição e tamanho);
4. **Fornecer os modelos 3D** (formatos `.glb`, `.gltf` ou `.obj`) dos produtos.

### Frontend (Next.js + Three.js)

O frontend será responsável por:

1. **Renderizar o modelo 3D** do produto usando Three.js;
2. **Aplicar as texturas e imagens recebidas do backend**;
3. **Adicionar os textos personalizados em tempo real** (CanvasTexture);
4. **Gerar previews dinâmicos** quando o cliente altera qualquer campo de customização;
5. **Sincronizar com a cesta de compras**.

---

## 🧠 Lógica de Customização (Backend)

### 1. Estrutura de Resposta do Produto 3D

O endpoint `/api/products/:id/customization` deve retornar um JSON como este:

```json
{
  "id": "caneca01",
  "nome": "Caneca Personalizada com Foto",
  "modelo3D": "/models/caneca.glb",
  "layoutBase": "/layouts/caneca-base.png",
  "areasCustomizaveis": [
    {
      "id": "area1",
      "tipo": "imagem",
      "posicao": { "x": 1.2, "y": 0.5, "z": 0 },
      "dimensoes": { "largura": 2.4, "altura": 1.2 },
      "permitirUpload": true
    },
    {
      "id": "texto_nome",
      "tipo": "texto",
      "posicao": { "x": 1.2, "y": 0.8, "z": 0.1 },
      "maxCaracteres": 20,
      "fonte": "Arial",
      "cor": "#000000"
    }
  ]
}
```

#### 📝 Explicação:

- `modelo3D`: link do modelo 3D para renderização no Three.js.
- `layoutBase`: imagem principal usada como textura base.
- `areasCustomizaveis`: define as regiões ou elementos que o cliente pode alterar.

  - `tipo`: `"imagem"` ou `"texto"`.
  - `posicao`: coordenadas 3D relativas no modelo.
  - `permitirUpload`: se o cliente pode enviar imagem.

---

## 🎨 Renderização no Frontend

### 1. Estrutura Básica Three.js

```ts
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Luz
const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
scene.add(light);

// Carrega o modelo 3D
const loader = new GLTFLoader();
loader.load("/models/caneca.glb", (gltf) => {
  const model = gltf.scene;
  scene.add(model);
  animate();
});

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
```

---

## 🖼️ Aplicação de Imagem Customizada

Quando o usuário faz upload de uma imagem:

1. O frontend recebe o arquivo e o aplica como **CanvasTexture** sobre a área definida;
2. Essa textura substitui a textura base da região `imagem` informada pelo backend.

Exemplo:

```ts
const textureLoader = new THREE.TextureLoader();
const uploadedTexture = textureLoader.load(URL.createObjectURL(uploadedFile));

// aplica na área do modelo
model.getObjectByName("area1").material.map = uploadedTexture;
model.getObjectByName("area1").material.needsUpdate = true;
```

---

## ✍️ Aplicação de Texto em Tempo Real

1. Cria-se um **canvas HTML** invisível;
2. O texto digitado pelo usuário é desenhado nesse canvas;
3. O canvas é convertido em uma textura e aplicada no modelo.

```ts
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
ctx.font = "bold 32px Arial";
ctx.fillStyle = "#000";
ctx.fillText(userInput, 50, 50);

const textTexture = new THREE.CanvasTexture(canvas);
model.getObjectByName("texto_nome").material.map = textTexture;
model.getObjectByName("texto_nome").material.needsUpdate = true;
```

> Cada alteração no texto deve atualizar automaticamente o canvas e o preview.

---

## 🔄 Integração com a Cesta de Compras

Toda customização feita deve ser refletida no objeto do carrinho:

```json
{
  "produtoId": "caneca01",
  "customizacoes": {
    "imagem": "https://cdn.cestodamore.com/uploads/cliente/foto123.jpg",
    "texto": "Feliz Aniversário!"
  },
  "quantidade": 1,
  "precoFinal": 89.9
}
```

Ao confirmar, o backend grava a customização (imagens e texto) associada ao pedido.

---

## 🔍 Lista de Customizações Disponíveis

O backend também deve fornecer um endpoint:

```
GET /api/customizacoes/canecas
GET /api/customizacoes/quadros
```

Que retorna todas as artes ou modelos disponíveis:

```json
[
  {
    "id": "modelo_romantico",
    "nome": "Romântico",
    "preview": "/images/modelos/romantico.png"
  },
  {
    "id": "modelo_moderno",
    "nome": "Moderno",
    "preview": "/images/modelos/moderno.png"
  }
]
```

O frontend exibe essas opções como thumbnails, e ao selecionar uma:

- Atualiza o layout 3D;
- Adiciona a customização à cesta.

---

## 🚀 Extensões Futuras

- Adicionar **animação de rotação** automática do produto;
- Implementar **exportação do preview final em imagem** (para o cliente compartilhar);
- Suporte a **vários ângulos de câmera**;
- Pré-carregamento otimizado de modelos 3D (lazy loading).

---

## 🧾 Conclusão

Essa arquitetura cria um fluxo claro e escalável entre backend e frontend:

- O backend define **o que pode ser customizado**;
- O frontend **renderiza e aplica as mudanças em tempo real**;
- O preview 3D garante **fidelidade visual** e **experiência interativa**.

```

```
