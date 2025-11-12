# 🚀 Guia de Deploy - Cesto d'Amore Backend

## 📋 Problema Atual

As imagens estão retornando 404 porque não estão sendo persistidas no Docker. Este guia resolve esse problema.

## 🔧 Solução Passo a Passo

### 1️⃣ Na VPS - Preparar Volumes

```bash
# Conectar na VPS
ssh seu-usuario@seu-servidor

# Navegar para o diretório do projeto
cd /caminho/do/projeto/Backend

# Executar script de setup (se ainda não executou)
chmod +x setup-volumes.sh
./setup-volumes.sh
```

### 2️⃣ Migrar Imagens Existentes (SE HOUVER)

Se você já tem imagens na pasta `images/` do container atual:

```bash
# Opção A: Se o container está rodando
docker cp nome-do-container:/code/images/. ./data/images/

# Opção B: Se as imagens estão no Git/projeto local
cp -r images/* data/images/
```

### 3️⃣ Reconstruir e Iniciar Container

```bash
# Parar containers antigos
docker-compose down

# Reconstruir com as novas configurações
docker-compose build --no-cache

# Iniciar com os volumes configurados
docker-compose up -d

# Verificar se está funcionando
docker-compose logs -f
```

### 4️⃣ Verificar Persistência

```bash
# Entrar no container
docker exec -it nome-do-container sh

# Verificar se os volumes estão montados
ls -la /code/images
ls -la /code/customizations
ls -la /code/storage

# Sair do container
exit
```

### 5️⃣ Testar Upload de Imagem

```bash
# Fazer upload de um produto com imagem pela API
# A imagem deve aparecer em data/images/ no host
ls -la data/images/

# Reiniciar container para testar persistência
docker-compose restart

# Verificar se as imagens ainda existem
curl https://api.cestodamore.com.br/images/nome-da-imagem.webp
```

## 📁 Estrutura de Volumes

```
Backend/
├── docker-compose.yml       # Configuração dos volumes
├── Dockerfile               # Build da imagem
├── data/                    # 📌 PERSISTÊNCIA (não commitar)
│   ├── images/              # ← Imagens de produtos
│   │   └── customizations/  # ← Imagens de customizações
│   ├── customizations/
│   │   └── models/          # ← Modelos 3D
│   └── storage/
│       └── temp/            # ← Arquivos temporários
```

## ⚠️ Importante para .gitignore

Adicione ao `.gitignore`:

```gitignore
# Dados persistentes do Docker (não versionar)
data/
```

## 🔄 Se Precisar Resetar Tudo

```bash
# CUIDADO: Isso apaga TODOS os dados!
docker-compose down -v
rm -rf data/
./setup-volumes.sh
docker-compose up -d
```

## 📊 Monitorar Uso de Disco

```bash
# Ver tamanho das pastas
du -sh data/*

# Ver espaço disponível
df -h
```

## 🆘 Troubleshooting

### Problema: Permissões negadas

```bash
sudo chown -R $USER:$USER data/
chmod -R 755 data/
```

### Problema: Imagens ainda não aparecem

```bash
# Verificar logs
docker-compose logs backend

# Verificar se o volume está montado corretamente
docker inspect nome-do-container | grep -A 10 Mounts
```

### Problema: Container não inicia

```bash
# Ver logs detalhados
docker-compose logs -f backend

# Verificar se as portas estão disponíveis
netstat -tulpn | grep 3333
```

## ✅ Checklist Final

- [ ] Executou `setup-volumes.sh`
- [ ] Migrou imagens antigas (se houver)
- [ ] Rebuild do container com `docker-compose build --no-cache`
- [ ] Container iniciado com `docker-compose up -d`
- [ ] Testou upload de nova imagem
- [ ] Testou persistência após `docker-compose restart`
- [ ] Adicionou `data/` ao `.gitignore`

## 📝 Resposta à Sua Pergunta

> Se eu atualizar as imagens deve funcionar normal?

**Sim e Não:**

- ✅ **Sim**: Se você fizer upload novamente das imagens, elas vão funcionar
- ❌ **Mas**: Sem os volumes configurados, ao reiniciar o container você vai perder as imagens de novo
- ✅ **Solução**: Configure os volumes como descrito acima e faça re-upload das imagens

**Melhor Abordagem:**

1. Configure os volumes PRIMEIRO (passos acima)
2. DEPOIS faça re-upload das imagens
3. Assim elas ficam permanentes mesmo após reiniciar o container

## 🎯 Automação (Opcional)

Criar backup automático das imagens:

```bash
# Criar script de backup
cat > backup-images.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/cestodamore"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/images_$DATE.tar.gz -C data images
echo "Backup criado: $BACKUP_DIR/images_$DATE.tar.gz"
EOF

chmod +x backup-images.sh

# Adicionar ao cron (backup diário às 2h)
echo "0 2 * * * /caminho/do/projeto/backup-images.sh" | crontab -
```
