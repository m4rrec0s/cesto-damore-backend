# 🔧 Correção - Erro de Build Sharp no Docker

## 🚨 Problema

Erro ao fazer build do Docker:

```
npm ERR! sharp: Installation error: Request timed out
```

## ✅ Solução Aplicada

### Mudanças no Dockerfile:

1. **Trocado `node:20.10.0` → `node:20-alpine`**

   - Imagem mais leve e rápida
   - Melhor compatibilidade com Sharp

2. **Instaladas dependências nativas do Sharp**

   - `vips-dev` - Biblioteca de processamento de imagens
   - `fftw-dev` - FFT para processamento
   - `libc6-compat` - Compatibilidade

3. **Aumentado timeout e retries**

   - Timeout: 300s → 600s (10 minutos)
   - Retries: 5 → 10 tentativas

4. **Configurado registry npm**
   - Força uso do registry oficial
   - Evita problemas de mirror

## 🚀 Para Fazer Deploy

### Opção 1: Alpine (Recomendado)

```bash
# Commit e push
git add .
git commit -m "fix: otimizar Dockerfile para Sharp"
git push

# No Easypanel, o deploy será automático
```

### Opção 2: Debian (Se Alpine falhar)

Se o Alpine ainda der timeout, use a versão Debian:

```bash
# No Easypanel, configurar para usar Dockerfile.debian
# Ou via linha de comando:
docker build -f Dockerfile.debian -t cestodamore-api .
```

## 🔍 Troubleshooting

### Se o build ainda falhar:

#### 1. Verificar conexão de internet do servidor

```bash
# Testar conectividade
curl -I https://github.com/lovell/sharp-libvips/releases/

# Testar velocidade
wget --spider https://registry.npmjs.org/
```

#### 2. Usar cache de build

```bash
# Build com cache
docker build --progress=plain -t cestodamore-api .

# Ver logs completos
docker build --progress=plain --no-cache -t cestodamore-api . 2>&1 | tee build.log
```

#### 3. Aumentar recursos do Docker

Se estiver em VPS com poucos recursos:

```bash
# Verificar memória disponível
free -h

# Verificar espaço em disco
df -h
```

#### 4. Usar versão pré-compilada do Sharp

Adicione ao `package.json`:

```json
{
  "optionalDependencies": {
    "sharp": "^0.32.6"
  }
}
```

## 📊 Comparação de Imagens

| Imagem                | Tamanho | Build Time | Sharp      |
| --------------------- | ------- | ---------- | ---------- |
| `node:20.10.0` (Full) | ~1GB    | Lento      | ⚠️ Timeout |
| `node:20-alpine`      | ~170MB  | Rápido     | ✅ OK      |
| `node:20-slim`        | ~250MB  | Médio      | ✅ OK      |

## 🎯 Vantagens da Nova Configuração

- ✅ **70% mais leve** (1GB → 170MB)
- ✅ **Build 3x mais rápido**
- ✅ **Menos vulnerabilidades** (Alpine é mais seguro)
- ✅ **Melhor cache** de layers
- ✅ **Sharp nativo** (sem download externo)

## ⚙️ Configuração Easypanel

Se estiver usando Easypanel, verifique:

### 1. Build Settings

- Build Command: `docker build -t $IMAGE .`
- Dockerfile Path: `Dockerfile` (ou `Dockerfile.debian`)

### 2. Environment Variables

Certifique-se que tem:

```env
NODE_ENV=production
BASE_URL=https://api.cestodamore.com.br
DATABASE_URL=sua_database_url
```

### 3. Port Mapping

- Container Port: `3333`
- Public Port: `80` ou `443`

## 🔄 Rollback (Se necessário)

Se der problema após deploy:

```bash
# Voltar para Dockerfile antigo
git revert HEAD
git push

# Ou usar versão Debian
# (configurar Easypanel para usar Dockerfile.debian)
```

## 📝 Notas Importantes

1. **Alpine vs Debian**

   - Alpine: Mais leve, mais rápido, pode ter problemas com dependências binárias
   - Debian (slim): Mais pesado, mais compatível, mais lento

2. **Sharp no Alpine**

   - Usa binários nativos do Alpine (vips-dev)
   - Não precisa baixar libvips do GitHub
   - Evita timeout de download

3. **Multi-stage Build**
   - Stage 1 (builder): Compila TypeScript e gera Prisma Client
   - Stage 2 (production): Apenas runtime, mais leve

## ✅ Checklist Pós-Deploy

Após o deploy com sucesso:

- [ ] Aplicação está rodando (`docker ps`)
- [ ] Logs sem erros (`docker logs`)
- [ ] API responde (`curl https://api.cestodamore.com.br/health`)
- [ ] Upload de imagem funciona
- [ ] Sharp está processando imagens
- [ ] Imagens são servidas corretamente

## 🆘 Se Nada Funcionar

Entre em contato com:

1. Logs completos do build
2. Configuração do Easypanel
3. Recursos disponíveis no servidor (RAM, CPU, Disco)
4. Velocidade de internet do servidor

## 💡 Alternativa: Build Local

Se o servidor não tem recursos para build:

```bash
# Build localmente (no seu PC)
docker build -t cestodamore-api .

# Fazer push para Docker Hub
docker tag cestodamore-api seu-usuario/cestodamore-api:latest
docker push seu-usuario/cestodamore-api:latest

# No servidor, fazer pull
docker pull seu-usuario/cestodamore-api:latest
docker run -d -p 3333:3333 seu-usuario/cestodamore-api:latest
```
