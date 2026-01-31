"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function fixOrphanedSessions() {
    try {
        console.log('🔍 Verificando sessões órfãs...');
        // Buscar todas as sessões com customer_phone
        const sessions = await prisma.aIAgentSession.findMany({
            where: {
                customer_phone: {
                    not: null,
                },
            },
            select: {
                customer_phone: true,
            },
        });
        const uniquePhones = [...new Set(sessions.map(s => s.customer_phone).filter(Boolean))];
        console.log(`📊 Encontrados ${uniquePhones.length} telefones únicos nas sessões`);
        let created = 0;
        // Verificar e criar cada cliente
        for (const phone of uniquePhones) {
            if (!phone)
                continue;
            const existingCustomer = await prisma.customer.findUnique({
                where: { number: phone },
            });
            if (!existingCustomer) {
                console.log(`📝 Criando cliente para ${phone}...`);
                await prisma.customer.create({
                    data: {
                        number: phone,
                        name: `Cliente ${phone.substring(0, 10)}`,
                        follow_up: false,
                        already_a_customer: false,
                    },
                });
                created++;
            }
        }
        console.log(`✅ ${created} clientes criados!`);
    }
    catch (error) {
        console.error('❌ Erro:', error);
    }
    finally {
        await prisma.$disconnect();
    }
}
fixOrphanedSessions();
