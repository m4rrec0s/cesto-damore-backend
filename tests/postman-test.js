const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

(async () => {
    try {
        console.log('=== TESTE SIMULANDO POSTMAN ===');

        // Verificar se o arquivo existe
        const imagePath = 'images/1757331256835-Adicionais-Balao-de-Cora_o.jpeg';
        if (!fs.existsSync(imagePath)) {
            console.error('Arquivo não encontrado:', imagePath);
            return;
        }

        const form = new FormData();

        // Adicionar campos exatamente como no Postman
        form.append('name', "Pelúcia d'Amore");
        form.append('description', 'Cesta com urso de pelúcia de 25 cm segurando um coração com frase (Verificar a disponibilidade) , um fio de LED enrolado na alça da cesta, uma caixa de chocolate e com um balão de coração vermelho.');
        form.append('price', '157.90');
        form.append('is_active', 'true');
        form.append('type_id', 'ec5e67b8-5b25-4174-a549-d0ec03b5d863');
        form.append('category_id', 'd90fc080-ceae-4f1e-9e7b-9e025a827ee2');

        // Adicionar imagem com nome de campo exato
        form.append('image', fs.createReadStream(imagePath), {
            filename: 'Cesta-Pelucia_d_amore.jpeg',
            contentType: 'image/jpeg'
        });

        console.log('Enviando requisição...');
        console.log('Headers que serão enviados:', form.getHeaders());

        const resp = await axios.post('http://localhost:8080/api/products', form, {
            headers: {
                ...form.getHeaders(),
                'User-Agent': 'PostmanRuntime/7.32.3' // Simular User-Agent do Postman
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        console.log('\n=== RESPOSTA ===');
        console.log('Status:', resp.status);
        console.log('Produto criado:');
        console.log(JSON.stringify(resp.data, null, 2));

        if (resp.data.image_url) {
            console.log('\n✅ SUCCESS: image_url foi preenchido:', resp.data.image_url);
        } else {
            console.log('\n❌ ERRO: image_url está null');
        }

    } catch (err) {
        console.error('\n=== ERRO ===');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Headers:', err.response.headers);
            console.error('Data:', err.response.data);
        } else {
            console.error('Erro:', err.message);
        }
    }
})();
