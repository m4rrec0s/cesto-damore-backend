const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

(async () => {
    try {
        console.log('=== TESTE DE DELETAR PRODUTO COM IMAGEM ===');

        // 1. Criar um produto com imagem
        console.log('\n1. Criando produto com imagem...');
        const form = new FormData();
        form.append('name', 'Produto Teste para Deletar');
        form.append('description', 'Este produto será deletado para testar remoção de imagem');
        form.append('price', '99.90');
        form.append('type_id', 'ec5e67b8-5b25-4174-a549-d0ec03b5d863');
        form.append('category_id', 'd90fc080-ceae-4f1e-9e7b-9e025a827ee2');
        form.append('image', fs.createReadStream('images/1757331256835-Adicionais-Balao-de-Cora_o.jpeg'), {
            filename: 'teste-delete.jpeg',
            contentType: 'image/jpeg'
        });

        const createResp = await axios.post('http://localhost:8080/api/products', form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        console.log('✅ Produto criado com ID:', createResp.data.id);
        console.log('📷 Imagem URL:', createResp.data.image_url);

        const productId = createResp.data.id;
        const imageUrl = createResp.data.image_url;

        // Extrair nome do arquivo da URL
        const fileName = imageUrl.split('/').pop();
        const imagePath = `images/${fileName}`;

        // 2. Verificar se a imagem existe no sistema de arquivos
        console.log('\n2. Verificando se a imagem foi criada...');
        if (fs.existsSync(imagePath)) {
            console.log('✅ Imagem encontrada no sistema:', imagePath);
        } else {
            console.log('❌ Imagem não encontrada no sistema:', imagePath);
            return;
        }

        // 3. Aguardar um pouco antes de deletar
        console.log('\n3. Aguardando 2 segundos antes de deletar...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Deletar o produto
        console.log('\n4. Deletando o produto...');
        const deleteResp = await axios.delete(`http://localhost:8080/api/products/${productId}`);
        console.log('✅ Produto deletado:', deleteResp.data.message);

        // 5. Verificar se a imagem foi removida
        console.log('\n5. Verificando se a imagem foi removida...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Aguardar um pouco

        if (!fs.existsSync(imagePath)) {
            console.log('✅ SUCCESS: Imagem foi removida do sistema!');
        } else {
            console.log('❌ ERRO: Imagem ainda existe no sistema:', imagePath);
        }

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
