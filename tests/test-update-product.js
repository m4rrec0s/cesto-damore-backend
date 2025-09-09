const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

(async () => {
    try {
        console.log('=== TESTE DE ATUALIZAR PRODUTO COM NOVA IMAGEM ===');

        // 1. Criar um produto com imagem
        console.log('\n1. Criando produto com imagem inicial...');
        const form1 = new FormData();
        form1.append('name', 'Produto Teste para Atualizar');
        form1.append('description', 'Este produto será atualizado com nova imagem');
        form1.append('price', '99.90');
        form1.append('type_id', 'ec5e67b8-5b25-4174-a549-d0ec03b5d863');
        form1.append('category_id', 'd90fc080-ceae-4f1e-9e7b-9e025a827ee2');
        form1.append('image', fs.createReadStream('images/1757331256835-Adicionais-Balao-de-Cora_o.jpeg'), {
            filename: 'teste-update-1.jpeg',
            contentType: 'image/jpeg'
        });

        const createResp = await axios.post('http://localhost:8080/api/products', form1, {
            headers: form1.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        console.log('✅ Produto criado com ID:', createResp.data.id);
        console.log('📷 Imagem URL inicial:', createResp.data.image_url);

        const productId = createResp.data.id;
        const oldImageUrl = createResp.data.image_url;
        const oldFileName = oldImageUrl.split('/').pop();
        const oldImagePath = `images/${oldFileName}`;

        // 2. Verificar se a primeira imagem existe
        console.log('\n2. Verificando se a primeira imagem foi criada...');
        if (fs.existsSync(oldImagePath)) {
            console.log('✅ Primeira imagem encontrada:', oldImagePath);
        } else {
            console.log('❌ Primeira imagem não encontrada:', oldImagePath);
            return;
        }

        // 3. Aguardar um pouco antes de atualizar
        console.log('\n3. Aguardando 2 segundos antes de atualizar...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Atualizar o produto com nova imagem
        console.log('\n4. Atualizando produto com nova imagem...');
        const form2 = new FormData();
        form2.append('name', 'Produto Teste ATUALIZADO');
        form2.append('description', 'Produto atualizado com nova imagem');
        form2.append('price', '149.90');
        form2.append('image', fs.createReadStream('images/1757425921983-Cesta-Pelucia_dAmore.webp'), {
            filename: 'teste-update-2.webp',
            contentType: 'image/webp'
        });

        const updateResp = await axios.put(`http://localhost:8080/api/products/${productId}`, form2, {
            headers: form2.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        console.log('✅ Produto atualizado');
        console.log('📷 Nova imagem URL:', updateResp.data.image_url);

        const newImageUrl = updateResp.data.image_url;
        const newFileName = newImageUrl.split('/').pop();
        const newImagePath = `images/${newFileName}`;

        // 5. Verificar se a imagem antiga foi removida e a nova criada
        console.log('\n5. Verificando troca de imagens...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const oldExists = fs.existsSync(oldImagePath);
        const newExists = fs.existsSync(newImagePath);

        if (!oldExists && newExists) {
            console.log('✅ SUCCESS: Imagem antiga removida e nova criada!');
            console.log('   - Imagem antiga removida:', oldImagePath);
            console.log('   - Nova imagem criada:', newImagePath);
        } else {
            if (oldExists) {
                console.log('❌ ERRO: Imagem antiga ainda existe:', oldImagePath);
            }
            if (!newExists) {
                console.log('❌ ERRO: Nova imagem não foi criada:', newImagePath);
            }
        }

        // 6. Limpar: deletar o produto para remover a nova imagem também
        console.log('\n6. Limpando: deletando produto criado...');
        await axios.delete(`http://localhost:8080/api/products/${productId}`);
        console.log('✅ Produto deletado');

        console.log('\n=== TESTE CONCLUÍDO ===');

    } catch (err) {
        console.error('\n=== ERRO NO TESTE ===');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        } else {
            console.error('Erro:', err.message);
        }
    }
})();
