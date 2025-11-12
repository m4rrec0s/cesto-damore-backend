# 🔍 DIAGNÓSTICO - Easypanel + Imagens 404

## Situação Atual

Você está usando **Easypanel** e:

- ✅ As imagens antigas estão visíveis em `/code/images`
- ❌ As imagens novas que você salva não aparecem
- ❌ Algumas imagens retornam 404

## 🚀 Passo a Passo de Diagnóstico

### 1️⃣ Execute o Script de Diagnóstico

Na VPS:

```bash
cd /etc/easypanel/projects/cesto_damore/cestodamore_api

# Se não tem o script ainda, baixe o código do Git
git pull

# Tornar executável
chmod +x diagnose-images.sh

# Executar
./diagnose-images.sh
```

### 2️⃣ Verificar Dentro do Container

```bash
# Entrar no container
docker exec -it $(docker ps | grep cestodamore_api | awk '{print $1}') sh

# Verificar diretório de trabalho
pwd

# Listar imagens
ls -la /code/images/

# Verificar permissões
ls -ld /code/images

# Testar criar arquivo
touch /code/images/teste.txt
ls -la /code/images/teste.txt

# Limpar
rm /code/images/teste.txt

# Sair
exit
```

### 3️⃣ Verificar Logs em Tempo Real

```bash
# Ver logs do container
docker logs -f $(docker ps | grep cestodamore_api | awk '{print $1}')

# Em outro terminal, tente fazer upload de uma imagem
# Observe os logs para ver se há erros
```

### 4️⃣ Teste de Salvamento Manual

Entre no container e teste:

```bash
docker exec -it $(docker ps | grep cestodamore_api | awk '{print $1}') sh

# Criar arquivo de teste
echo "teste" > /code/images/teste-manual.txt

# Verificar se foi criado
ls -la /code/images/teste-manual.txt

# Tentar acessar via API
# (em outro terminal ou navegador)
curl http://localhost:3333/images/teste-manual.txt

# Limpar
rm /code/images/teste-manual.txt
exit
```

## 🎯 Possíveis Causas e Soluções

### Causa 1: Problema de Permissões

**Sintomas:**

- Erro ao salvar imagem
- Permissões negadas nos logs

**Solução:**

```bash
docker exec -it $(docker ps | grep cestodamore_api | awk '{print $1}') sh
chmod -R 755 /code/images
chown -R node:node /code/images
exit
```

### Causa 2: Path Errado no Código

**Sintomas:**

- Imagem salva mas não aparece em `/code/images`
- `process.cwd()` retorna path diferente

**Solução:**

```bash
# Verificar dentro do container
docker exec $(docker ps | grep cestodamore_api | awk '{print $1}') node -e "console.log('CWD:', process.cwd())"

# Se não for /code, adicione ao Dockerfile:
# WORKDIR /code
```

### Causa 3: Container Reiniciando

**Sintomas:**

- Imagem aparece mas depois desaparece
- Após reiniciar, imagens novas somem

**Solução:**
Configure volumes persistentes no Easypanel:

1. Acesse o painel do Easypanel
2. Vá em seu app > Settings > Mounts
3. Adicione mount:
   - Host Path: `/var/lib/easypanel/projects/cesto_damore/cestodamore_api/images`
   - Container Path: `/code/images`
   - Read Only: **NO**

### Causa 4: Múltiplas Instâncias

**Sintomas:**

- Às vezes funciona, às vezes não
- Comportamento inconsistente

**Solução:**

```bash
# Verificar quantos containers estão rodando
docker ps | grep cestodamore

# Se houver mais de um, pare os extras
docker stop <container-id>
```

## 🔧 Solução Rápida (Mais Provável)

Se as imagens antigas estão lá mas as novas não aparecem:

```bash
# 1. Entrar no container
docker exec -it $(docker ps | grep cestodamore_api | awk '{print $1}') sh

# 2. Verificar e corrigir permissões
ls -la /code/images
chmod -R 755 /code/images
chown -R node:node /code/images

# 3. Criar teste
echo "teste" > /code/images/teste-permissao.txt
ls -la /code/images/teste-permissao.txt

# Se conseguir criar, o problema está resolvido!
rm /code/images/teste-permissao.txt
exit

# 4. Reiniciar aplicação
docker restart $(docker ps | grep cestodamore_api | awk '{print $1}')
```

## 📊 Checklist de Verificação

Execute e anote os resultados:

- [ ] `pwd` dentro do container = `/code` ?
- [ ] `/code/images` existe e tem permissão 755 ?
- [ ] Consegue criar arquivo em `/code/images` ?
- [ ] Owner da pasta é `node:node` ou `root:root` ?
- [ ] Logs mostram erro ao salvar imagens ?
- [ ] API retorna erro 500 ao fazer upload ?
- [ ] Há volumes configurados no Easypanel ?

## 🆘 Se Nada Funcionar

Entre em contato com:

1. Screenshots dos logs
2. Resultado do `diagnose-images.sh`
3. Checklist preenchido acima
4. Versão do Node dentro do container: `docker exec $(docker ps | grep cestodamore_api | awk '{print $1}') node -v`

## 💡 Dica Importante

**Antes de qualquer deploy**, sempre:

1. Commit e push o código
2. Configure volumes no Easypanel
3. Faça backup das imagens existentes:
   ```bash
   docker cp $(docker ps | grep cestodamore_api | awk '{print $1}):/code/images ./backup-images-$(date +%Y%m%d)
   ```
