import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `perf_${Date.now()}_`;
const TEST_DATA_PREFIX = "perf_";

export { prisma, TEST_PREFIX };

export async function cleanupTestData() {
  const orders = await prisma.order.findMany({
    where: { user: { email: { startsWith: TEST_DATA_PREFIX } } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  if (orderIds.length > 0) {
    const orderItems = await prisma.orderItem.findMany({
      where: { order_id: { in: orderIds } },
      select: { id: true },
    });
    const itemIds = orderItems.map((i) => i.id);
    const reservations = await prisma.stockReservation.findMany({
      where: { order_id: { in: orderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((reservation) => reservation.id);

    await prisma.stockReservationItem.deleteMany({
      where: { reservation_id: { in: reservationIds } },
    });
    await prisma.stockReservation.deleteMany({
      where: { id: { in: reservationIds } },
    });
    if (itemIds.length > 0) {
      await prisma.orderItemAdditional.deleteMany({ where: { order_item_id: { in: itemIds } } });
      await prisma.orderItemCustomization.deleteMany({ where: { order_item_id: { in: itemIds } } });
    }
    await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.productCategory.deleteMany({ where: { product: { name: { startsWith: TEST_DATA_PREFIX } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TEST_DATA_PREFIX } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TEST_DATA_PREFIX } } });
  await prisma.productType.deleteMany({ where: { name: { startsWith: TEST_DATA_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_DATA_PREFIX } } });
}

export async function seedTestData() {
  const user = await prisma.user.create({
    data: {
      firebaseUId: `fb_${TEST_PREFIX}`,
      email: `${TEST_PREFIX}@test.com`,
      name: "Perf Test User",
      phone: "83999990000",
    },
  });

  const type = await prisma.productType.create({ data: { name: `${TEST_PREFIX}_type` } });
  const category = await prisma.category.create({ data: { name: `${TEST_PREFIX}_cat` } });
  const product = await prisma.product.create({
    data: {
      name: `${TEST_PREFIX}_product`,
      price: 99.9,
      stock_quantity: 999,
      stock_mode: "PRODUCT_ONLY",
      type_id: type.id,
    },
  });
  await prisma.productCategory.create({ data: { product_id: product.id, category_id: category.id } });

  for (let i = 0; i < 10; i++) {
    await prisma.order.create({
      data: {
        user_id: user.id,
        status: i % 3 === 0 ? "PAID" : "PENDING",
        total: 99.9 + i,
        grand_total: 99.9 + i,
        delivery_city: "Campina Grande",
        delivery_state: "PB",
        recipient_phone: "83999990000",
        payment_method: "pix",
        source: "customer",
        items: { create: [{ product_id: product.id, quantity: 1, price: 99.9 }] },
      },
    });
  }

  return { user, product, type, category };
}
