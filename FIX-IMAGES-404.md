# 🚨 CORREÇÃO URGENTE - Imagens 404

## Problema

As imagens retornam 404 porque não estão persistindo no Docker.

## Solução Rápida (Na VPS)

```bash
# 1. Parar container
docker-compose down

# 2. Criar estrutura de volumes
chmod +x setup-volumes.sh
./setup-volumes.sh

# 3. Se tem imagens antigas no container, copie:
# (substitua 'backend' pelo nome do seu container se diferente)
docker cp backend:/code/images/. ./data/images/

# 4. OU se as imagens estão no Git:
chmod +x migrate-images.sh
./migrate-images.sh

# 5. Rebuild completo
docker-compose build --no-cache
docker-compose up -d

# 6. Verificar logs
docker-compose logs -f
```

## O Que Foi Mudado

- ✅ `docker-compose.yml` configurado com volumes persistentes
- ✅ `Dockerfile` otimizado
- ✅ `docker-entrypoint.sh` cria pastas automaticamente
- ✅ Scripts de setup e migração criados

## Testando

```bash
# Upload uma nova imagem via API
# Depois teste:
curl https://api.cestodamore.com.br/images/nome-da-imagem.webp

# Reinicie o container
docker-compose restart

# Teste novamente - a imagem deve continuar acessível!
curl https://api.cestodamore.com.br/images/nome-da-imagem.webp
```

## 📝 Respondendo Sua Pergunta

**"Se eu atualizar as imagens deve funcionar normal?"**

- ❌ **Não**, se apenas fazer re-upload sem configurar os volumes
- ✅ **Sim**, se seguir os passos acima PRIMEIRO e depois fazer re-upload

**Ordem Correta:**

1. Configure volumes (passos acima) ⬅️ FAÇA ISSO PRIMEIRO
2. Faça re-upload das imagens
3. Pronto! Agora são permanentes

## Arquivos Importantes

- `docker-compose.yml` - Volumes configurados
- `Dockerfile` - Build otimizado
- `docker-entrypoint.sh` - Setup automático
- `setup-volumes.sh` - Cria estrutura de pastas
- `migrate-images.sh` - Migra imagens antigas
- `DEPLOY.md` - Guia completo

## ⚠️ IMPORTANTE

Após configurar, adicione ao `.gitignore` (já feito):

```
data/
```

Não versione as imagens no Git! Use os volumes do Docker.
