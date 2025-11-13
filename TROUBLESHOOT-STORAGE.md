# 🔍 GUIA DE DIAGNÓSTICO - Bind Mount não funcionando

## 🔴 Problema

As imagens são salvas dentro do container mas desaparecem após restart, indicando que o bind mount não está funcionando.

## 🛠️ Passos para Diagnosticar

### 1. Verificar logs do container

```bash
# Ver logs do container
docker logs cestodamore_api --tail 50

# Procurar por:
# - "📁 [STORAGE CONFIG]" - Mostra NODE_ENV e IMAGES_DIR
# - "💾 [STORAGE] Salvando imagem em:" - Mostra onde está salvando
```

### 2. Executar diagnóstico dentro do container

```bash
# Copiar script para o container
docker cp diagnose-storage.sh cestodamore_api:/tmp/diagnose.sh

# Executar dentro do container
docker exec cestodamore_api sh /tmp/diagnose.sh
```

Isso vai mostrar:

- ✅ Variáveis de ambiente
- ✅ Se as pastas existem
- ✅ Permissões
- ✅ Bind mounts ativos
- ✅ Arquivos salvos
- ✅ Teste de escrita

### 3. Verificar estrutura no HOST (VPS)

```bash
# Na VPS, verificar se as pastas existem
ls -la /etc/easypanel/projects/cesto_damore/cestodamore_api/

# Deve mostrar:
# ├── code/
# ├── images/
# └── storage/
```

### 4. Verificar mapeamento do Docker

```bash
# Ver detalhes do container
docker inspect cestodamore_api | grep -A 20 "Mounts"

# Deve mostrar algo como:
# "Source": "/etc/easypanel/projects/cesto_damore/cestodamore_api/images",
# "Destination": "/app/images",
# "Type": "bind"
```

---

## 🎯 Possíveis Causas e Soluções

### ❌ Causa 1: NODE_ENV não está definido como "production"

**Verificar:**

```bash
docker exec cestodamore_api env | grep NODE_ENV
```

**Solução:**
No `docker-compose.yml`, garantir que está:

```yaml
environment:
  - NODE_ENV=production
```

### ❌ Causa 2: Pastas não existem no HOST

**Verificar:**

```bash
ls -la /etc/easypanel/projects/cesto_damore/cestodamore_api/images
```

**Solução:**

```bash
cd /etc/easypanel/projects/cesto_damore/cestodamore_api
mkdir -p images/customizations
mkdir -p storage/temp
chmod -R 755 images storage
```

### ❌ Causa 3: Caminho do bind mount está errado

**Verificar no docker-compose.yml:**

```yaml
volumes:
  - ../images:/app/images # ← Correto (relativo ao diretório code)
  - ../storage:/app/storage
```

**NÃO pode ser:**

```yaml
volumes:
  - ./images:/app/images # ❌ Errado! Dentro do code
```

### ❌ Causa 4: Container está usando caminho errado

**Verificar logs:**

```bash
docker logs cestodamore_api | grep "STORAGE CONFIG"
```

Deve mostrar:

```
📁 [STORAGE CONFIG] {
  NODE_ENV: 'production',
  IMAGES_DIR: '/app/images',  ← Deve ser /app/images
  BASE_URL: 'https://api.cestodamore.com.br'
}
```

Se mostrar outro caminho, o NODE_ENV não está correto.

### ❌ Causa 5: Permissões incorretas

**Verificar:**

```bash
docker exec cestodamore_api ls -la /app/images
```

**Solução:**

```bash
# No host
chmod -R 755 /etc/easypanel/projects/cesto_damore/cestodamore_api/images
```

---

## 🧪 Teste Manual

### 1. Criar arquivo de teste no HOST

```bash
# Na VPS
echo "teste do host" > /etc/easypanel/projects/cesto_damore/cestodamore_api/images/teste-host.txt
```

### 2. Verificar se aparece no container

```bash
# Entrar no container
docker exec -it cestodamore_api sh

# Listar arquivos
ls -la /app/images/

# Ver conteúdo
cat /app/images/teste-host.txt
# Deve mostrar: teste do host
```

Se aparecer: ✅ Bind mount está funcionando!

### 3. Criar arquivo de teste no CONTAINER

```bash
# Dentro do container
echo "teste do container" > /app/images/teste-container.txt
exit
```

### 4. Verificar se aparece no HOST

```bash
# Na VPS
cat /etc/easypanel/projects/cesto_damore/cestodamore_api/images/teste-container.txt
# Deve mostrar: teste do container
```

Se aparecer: ✅ Bind mount está funcionando nas duas direções!

---

## 🚀 Solução Definitiva

Se nada funcionar, tente reconstruir o container do zero:

```bash
# Parar container
docker compose down

# Remover container e volumes órfãos
docker compose rm -f
docker volume prune -f

# Verificar se as pastas existem no host
ls -la /etc/easypanel/projects/cesto_damore/cestodamore_api/

# Se não existirem, criar:
mkdir -p /etc/easypanel/projects/cesto_damore/cestodamore_api/images/customizations
mkdir -p /etc/easypanel/projects/cesto_damore/cestodamore_api/storage/temp
chmod -R 755 /etc/easypanel/projects/cesto_damore/cestodamore_api/images
chmod -R 755 /etc/easypanel/projects/cesto_damore/cestodamore_api/storage

# Rebuild e restart
docker compose build --no-cache
docker compose up -d

# Verificar logs
docker logs cestodamore_api -f
```

---

## 📋 Checklist

- [ ] NODE_ENV=production está definido
- [ ] Pastas existem no host (`/etc/easypanel/.../images` e `.../storage`)
- [ ] Permissões corretas (755)
- [ ] docker-compose.yml usa `../images:/app/images`
- [ ] Bind mount aparece no `docker inspect`
- [ ] Teste manual funciona (arquivo criado no host aparece no container)
- [ ] Logs mostram `/app/images` como IMAGES_DIR
- [ ] Após upload, arquivo aparece no host

---

## 💡 Dica Final

Após fazer qualquer mudança, sempre:

1. Rebuild do container: `docker compose build`
2. Restart: `docker compose restart`
3. Ver logs: `docker logs cestodamore_api --tail 100`
4. Testar upload de imagem
5. Verificar se arquivo está no host: `ls -la /etc/easypanel/.../images/`
