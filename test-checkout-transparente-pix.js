const axios = require('axios');

// Configuração
const BASE_URL = 'http://localhost:8080/api';
const ORDER_ID = 'b1f043b0-b8ab-4a41-b784-0a1d44ee91c8'; // Você precisará criar um pedido válido primeiro

async function testCheckoutTransparente() {
    console.log('=== TESTE DO CHECKOUT TRANSPARENTE COM PIX ===\n');

    try {
        // 1. Teste de criação de pagamento PIX
        console.log('1. Testando criação de pagamento PIX...');

        const pixPaymentData = {
            orderId: ORDER_ID,
            payment_method_id: 'pix',
            payer: {
                email: 'test@example.com',
                identification: {
                    type: 'CPF',
                    number: '12345678901'
                }
            }
        };

        try {
            const pixResponse = await axios.post(`${BASE_URL}/api/payment/transparent`, pixPaymentData, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (pixResponse.data.success) {
                console.log('✅ PIX criado com sucesso:');
                console.log(`   - Payment ID: ${pixResponse.data.paymentId}`);
                console.log(`   - Status: ${pixResponse.data.status}`);

                if (pixResponse.data.data) {
                    console.log(`   - QR Code disponível: ${!!pixResponse.data.data.qr_code}`);
                    if (pixResponse.data.data.qr_code) {
                        console.log(`   - QR Code: ${pixResponse.data.data.qr_code.substring(0, 50)}...`);
                    }
                }
            } else {
                console.log('❌ Erro na criação do PIX:', pixResponse.data.message);
            }
        } catch (error) {
            console.log('❌ Erro ao criar PIX:', error.response?.data?.message || error.message);
        }

        console.log('\n' + '='.repeat(50) + '\n');

        // 2. Teste de criação de pagamento com cartão
        console.log('2. Testando criação de pagamento com cartão...');

        const cardPaymentData = {
            orderId: ORDER_ID,
            token: 'test-token-123', // Token fictício para teste
            payment_method_id: 'credit_card',
            issuer_id: '25',
            installments: 1,
            payer: {
                email: 'test@example.com',
                identification: {
                    type: 'CPF',
                    number: '12345678901'
                }
            }
        };

        try {
            const cardResponse = await axios.post(`${BASE_URL}/api/payment/transparent`, cardPaymentData, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (cardResponse.data.success) {
                console.log('✅ Pagamento com cartão processado:');
                console.log(`   - Payment ID: ${cardResponse.data.paymentId}`);
                console.log(`   - Status: ${cardResponse.data.status}`);
            } else {
                console.log('❌ Erro no pagamento com cartão:', cardResponse.data.message);
            }
        } catch (error) {
            console.log('❌ Erro ao processar cartão:', error.response?.data?.message || error.message);
        }

        console.log('\n' + '='.repeat(50) + '\n');

        // 3. Teste de carregamento da página
        console.log('3. Testando carregamento da página de checkout...');

        try {
            const pageResponse = await axios.get(`${BASE_URL}/checkout-transparente?orderId=${ORDER_ID}`);

            if (pageResponse.status === 200 && pageResponse.data.includes('Checkout Transparente')) {
                console.log('✅ Página de checkout carregada com sucesso');

                // Verificar se contém elementos PIX
                if (pageResponse.data.includes('payment_method') && pageResponse.data.includes('pix')) {
                    console.log('✅ Opções de PIX detectadas na página');
                }

                // Verificar se contém elementos de cartão
                if (pageResponse.data.includes('cardNumber') && pageResponse.data.includes('securityCode')) {
                    console.log('✅ Campos de cartão detectados na página');
                }
            } else {
                console.log('❌ Erro ao carregar página:', pageResponse.status);
            }
        } catch (error) {
            console.log('❌ Erro ao acessar página:', error.response?.status || error.message);
        }

        console.log('\n' + '='.repeat(50) + '\n');

        // 4. Teste de carregamento de dados do pedido
        console.log('4. Testando carregamento de dados do pedido...');

        try {
            const orderResponse = await axios.get(`${BASE_URL}/api/orders/${ORDER_ID}`);

            if (orderResponse.status === 200 && orderResponse.data.id) {
                console.log('✅ Dados do pedido carregados:');
                console.log(`   - ID: ${orderResponse.data.id}`);
                console.log(`   - Total: R$ ${orderResponse.data.grand_total}`);
                console.log(`   - Método: ${orderResponse.data.payment_method}`);
            } else {
                console.log('❌ Erro ao carregar dados do pedido');
            }
        } catch (error) {
            console.log('❌ Erro ao buscar pedido:', error.response?.data?.error || error.message);
        }

    } catch (error) {
        console.error('❌ Erro geral no teste:', error.message);
    }

    console.log('\n=== TESTE CONCLUÍDO ===');
    console.log('\n📋 PRÓXIMOS PASSOS:');
    console.log('1. Crie um pedido válido no sistema');
    console.log('2. Substitua ORDER_ID pelo ID real do pedido');
    console.log('3. Certifique-se de que o servidor está rodando na porta 3000');
    console.log('4. Teste manualmente acessando: http://localhost:3000/checkout-transparente?orderId=SEU_ORDER_ID');
}

// Executar teste
testCheckoutTransparente().catch(console.error);