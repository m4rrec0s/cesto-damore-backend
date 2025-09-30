// Teste direto do fluxo PIX
async function testPixAPI() {
    try {
        const fetch = (await import('node-fetch')).default;
        
        console.log('🔥 Testando API PIX diretamente...');
        
        // 1. Primeiro criar um pedido de teste (se necessário)
        const testOrderData = {
            orderId: 'TEST-ORDER-' + Date.now(),
            payment_method_id: 'pix',
            payer: {
                email: 'test@cestoamore.com'
            }
        };

        // Primeiro testar se o servidor está funcionando
        console.log('🔥 Testando se servidor está online...');
        const healthCheck = await fetch('http://localhost:8080/');
        console.log('🔥 Health check status (home):', healthCheck.status);
        
        console.log('🔥 Enviando requisição para:', 'http://localhost:8080/api/payment/transparent');
        console.log('🔥 Dados:', JSON.stringify(testOrderData, null, 2));

        const response = await fetch('http://localhost:8080/api/payment/transparent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testOrderData)
        });

        console.log('🔥 Status da resposta:', response.status);
        console.log('🔥 Headers da resposta:', Object.fromEntries(response.headers));

        const responseText = await response.text();
        console.log('🔥 Texto da resposta:', responseText);

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Erro ao fazer parse do JSON:', e.message);
            console.log('📋 Resposta bruta:', responseText);
            return;
        }

        console.log('\n🔥 RESULTADO COMPLETO:');
        console.log(JSON.stringify(result, null, 2));

        if (result.success && result.data) {
            console.log('\n✅ PIX gerado com sucesso!');
            
            if (result.data.qr_code) {
                console.log('✅ QR Code string:', result.data.qr_code.substring(0, 100) + '...');
            }
            
            if (result.data.qr_code_base64) {
                console.log('✅ QR Code base64 (primeiros 50 chars):', result.data.qr_code_base64.substring(0, 50) + '...');
            }
            
            if (result.data.amount) {
                console.log('✅ Valor:', result.data.amount);
            }
            
            if (result.data.payment_id) {
                console.log('✅ Payment ID:', result.data.payment_id);
            }

            if (result.data.expires_at) {
                console.log('✅ Expira em:', result.data.expires_at);
            }

        } else {
            console.log('❌ Falha na geração do PIX');
            if (result.message) {
                console.log('❌ Mensagem de erro:', result.message);
            }
        }

    } catch (error) {
        console.error('❌ Erro no teste:', error.message);
        console.error('❌ Stack:', error.stack);
    }
}

// Executar o teste
testPixAPI();