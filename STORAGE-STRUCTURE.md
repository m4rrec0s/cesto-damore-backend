# 📁 Estrutura de Armazenamento - Cesto d'Amore API

## 🏗️ Arquitetura de Pastas

### Em Produção (VPS/EasyPanel)

```
/etc/easypanel/projects/cesto_damore/cestodamore_api/
├── code/                          # Código gerenciado pelo Git
│   ├── src/
│   ├── dist/
│   ├── package.json
│   ├── docker-compose.yml
│   └── ...
├── images/                        # ✅ PERSISTENTE (fora do Git)
│   ├── customizations/            # Imagens de customizações
│   └── [arquivos de imagem]       # Imagens de produtos/adicionais
└── storage/                       # ✅ PERSISTENTE (fora do Git)
    └── temp/                      # Arquivos temporários
```

### Em Desenvolvimento (Local)

```
Backend/
├── src/
├── dist/
├── images/                        # Criado localmente (ignorado pelo Git)
│   └── customizations/
├── storage/                       # Criado localmente (ignorado pelo Git)
│   └── temp/
└── ...
```

---

## 🎯 Por que esta estrutura?

### ❌ Problema Anterior

Quando as pastas `images/` e `storage/` estavam dentro de `code/`:

1. A cada deploy, o EasyPanel faz `git pull`
2. O Git **sobrescreve** o diretório `code/`
3. Pastas não versionadas (no `.gitignore`) são **apagadas**
4. **PERDA DE DADOS!** 💥

### ✅ Solução Atual

Pastas de dados ficam **FORA** do diretório `code/`:

- ✅ Git pull não afeta `images/` e `storage/`
- ✅ Dados persistem entre deploys
- ✅ Sem risco de perda de imagens
- ✅ Facilita backups

---

## 🚀 Setup Inicial na VPS

### 1. Primeira vez (executar UMA vez)

```bash
# SSH no servidor
ssh root@seu-servidor

# Executar o script de setup
cd /etc/easypanel/projects/cesto_damore/cestodamore_api/code
chmod +x setup-vps-structure.sh
./setup-vps-structure.sh
```

Isso criará:

```
/etc/easypanel/projects/cesto_damore/cestodamore_api/
├── code/
├── images/customizations/
└── storage/temp/
```

### 2. Deploy no EasyPanel

Agora basta clicar em "Implantar" no EasyPanel!

---

## 🔧 Configuração do Docker

### docker-compose.yml

```yaml
volumes:
  - ../images:/app/images # Mapeia pasta externa para dentro do container
  - ../storage:/app/storage # Mapeia pasta externa para dentro do container
```

**Importante:**

- `../images` = sai de `code/` e acessa `images/` no nível acima
- `/app/images` = caminho dentro do container
- Em produção, `NODE_ENV=production` usa `/app/images`
- Em desenvolvimento, usa `./images` (pasta local)

---

## 📂 Caminhos Configurados

### localStorage.ts

```typescript
const IMAGES_DIR =
  process.env.NODE_ENV === "production"
    ? "/app/images" // Produção: mapeado via volume
    : path.join(process.cwd(), "images"); // Dev: pasta local
```

### multer.ts

```typescript
const baseStorageDir =
  process.env.NODE_ENV === "production"
    ? "/app/storage" // Produção: mapeado via volume
    : "storage"; // Dev: pasta local
```

### routes.ts

```typescript
const imagesPath =
  process.env.NODE_ENV === "production"
    ? "/app/images" // Produção
    : path.join(process.cwd(), "images"); // Dev
```

---

## 🔍 Verificação

### Dentro do container

```bash
# Entrar no container
docker exec -it cestodamore_api sh

# Verificar se as pastas foram mapeadas
ls -la /app/images
ls -la /app/storage

# Verificar variável de ambiente
echo $NODE_ENV
```

### No host (VPS)

```bash
# Verificar estrutura
ls -la /etc/easypanel/projects/cesto_damore/cestodamore_api/

# Ver imagens salvas
ls -la /etc/easypanel/projects/cesto_damore/cestodamore_api/images/

# Ver arquivos temporários
ls -la /etc/easypanel/projects/cesto_damore/cestodamore_api/storage/
```

---

## 💾 Backup

### Backup Manual

```bash
cd /etc/easypanel/projects/cesto_damore/cestodamore_api

# Backup completo
tar -czf backup-images-$(date +%Y%m%d-%H%M%S).tar.gz images/
tar -czf backup-storage-$(date +%Y%m%d-%H%M%S).tar.gz storage/

# Download via SCP
scp root@servidor:/etc/easypanel/projects/cesto_damore/cestodamore_api/backup-*.tar.gz ./
```

### Restauração

```bash
# Upload do backup
scp backup-images-*.tar.gz root@servidor:/tmp/

# Restaurar
cd /etc/easypanel/projects/cesto_damore/cestodamore_api
tar -xzf /tmp/backup-images-*.tar.gz
```

---

## 🛠️ Desenvolvimento Local

### Primeira execução

```bash
# Criar pastas localmente
mkdir -p images/customizations
mkdir -p storage/temp
chmod -R 755 images storage
```

### Executar

```bash
npm run dev
```

As imagens serão salvas em `./images` localmente.

---

## ⚠️ Importante

1. **Nunca commitar** pastas `images/` e `storage/` (já estão no `.gitignore`)
2. **Fazer backup regular** das pastas na VPS
3. **Não deletar** as pastas `images/` e `storage/` na VPS
4. Se precisar recriar, execute `setup-vps-structure.sh` novamente

---

## 🐛 Troubleshooting

### Erro: "ENOENT: no such file or directory '/app/images'"

**Solução:**

```bash
# Verificar se o volume foi mapeado corretamente
docker inspect cestodamore_api | grep Mounts -A 20

# Recriar as pastas se necessário
./setup-vps-structure.sh

# Restart do container
docker compose restart
```

### Imagens não aparecem

**Verificar:**

1. Pastas existem no host?
2. Permissões corretas? (`chmod -R 755`)
3. Volume mapeado corretamente no docker-compose.yml?
4. NODE_ENV=production está configurado?

### Espaço em disco

```bash
# Ver uso de disco
du -sh /etc/easypanel/projects/cesto_damore/cestodamore_api/images/
du -sh /etc/easypanel/projects/cesto_damore/cestodamore_api/storage/

# Limpar arquivos temporários antigos (> 7 dias)
find /etc/easypanel/projects/cesto_damore/cestodamore_api/storage/temp/ -type f -mtime +7 -delete
```
