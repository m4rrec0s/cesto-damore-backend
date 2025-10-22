const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function testOrderQuery() {
    try {
        console.log("🔍 Testando consulta de pedidos...");

        const orders = await prisma.order.findMany({
            take: 5,
            orderBy: {
                created_at: "desc",
            },
            select: {
                id: true,
                user_id: true,
                status: true,
                total: true,
                recipient_phone: true,
                created_at: true,
            },
        });

        console.log("✅ Consulta bem-sucedida!");
        console.log(`📦 Encontrados ${orders.length} pedidos`);

        if (orders.length > 0) {
            console.log("\n📋 Exemplo de pedido:");
            console.log(JSON.stringify(orders[0], null, 2));
        }

        // Verificar se o campo recipient_phone existe
        if (orders.length > 0) {
            console.log("\n🎯 Campo recipient_phone está presente:", "recipient_phone" in orders[0]);
        }

    } catch (error) {
        console.error("❌ Erro na consulta:", error);
    } finally {
        await prisma.$disconnect();
    }
}

testOrderQuery();
