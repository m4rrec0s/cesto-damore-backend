const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function viewOrders() {
  try {
    console.log("\n📦 ===== PEDIDOS =====\n");
    
    const orders = await prisma.order.findMany({
      take: 20,
      orderBy: {
        created_at: "desc",
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (orders.length === 0) {
      console.log("❌ Nenhum pedido encontrado");
      return;
    }

    console.log(`✅ Total: ${orders.length} pedidos\n`);

    orders.forEach((order, index) => {
      console.log(`\n${index + 1}. Pedido #${order.id.substring(0, 8)}`);
      console.log(`   Cliente: ${order.user.name} (${order.user.email})`);
      console.log(`   📱 Tel. Cliente: ${order.user.phone || "Não informado"}`);
      console.log(`   🎁 Tel. Destinatário: ${order.recipient_phone || "Não informado"}`);
      console.log(`   Status: ${order.status}`);
      console.log(`   Total: R$ ${order.total.toFixed(2)}`);
      console.log(`   Frete: R$ ${(order.shipping_price || 0).toFixed(2)}`);
      console.log(`   Total Final: R$ ${(order.grand_total || 0).toFixed(2)}`);
      console.log(`   Método: ${order.payment_method || "N/A"}`);
      console.log(`   Endereço: ${order.delivery_address || "N/A"}`);
      console.log(`   Data entrega: ${order.delivery_date ? new Date(order.delivery_date).toLocaleString("pt-BR") : "N/A"}`);
      console.log(`   Criado em: ${new Date(order.created_at).toLocaleString("pt-BR")}`);
      
      if (order.items.length > 0) {
        console.log(`   Itens (${order.items.length}):`);
        order.items.forEach(item => {
          console.log(`      - ${item.product.name} (${item.quantity}x) - R$ ${item.price.toFixed(2)}`);
        });
      }
      console.log(`   ${"=".repeat(60)}`);
    });

  } catch (error) {
    console.error("❌ Erro:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

viewOrders();
