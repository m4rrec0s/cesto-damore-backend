const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

(async () => {
    try {
        console.log('=== TESTE DE CRIAÇÃO DE PRODUTO COM IMAGEM ===');

        const form = new FormData();
        form.append('image', fs.createReadStream('images/1757331256835-Adicionais-Balao-de-Cora_o.jpeg'));
        form.append('name', 'Produto Teste');
        form.append('description', 'Descrição do produto teste');
        form.append('price', '99.90');
        form.append('type_id', 'ec5e67b8-5b25-4174-a549-d0ec03b5d863');
        form.append('category_id', 'd90fc080-ceae-4f1e-9e7b-9e025a827ee2');

        const resp = await axios.post('http://localhost:8080/api/products', form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        console.log('Status:', resp.status);
        console.log('Produto criado:');
        console.log(JSON.stringify(resp.data, null, 2));

        // Verificar se image_url foi preenchido
        if (resp.data.image_url) {
            console.log('\n✅ SUCCESS: image_url foi preenchido:', resp.data.image_url);
        } else {
            console.log('\n❌ ERRO: image_url está null');
        }

    } catch (err) {
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        } else {
            console.error('Erro:', err.message);
        }
    }
})();