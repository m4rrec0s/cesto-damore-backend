import { cleanupTestData, seedTestData, prisma } from "./setup";

jest.setTimeout(300000);

function percentil(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function logMetric(label: string, durations: number[], target: number) {
  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = percentil(sorted, 50);
  const p90 = percentil(sorted, 90);
  const p95 = percentil(sorted, 95);
  const p99 = percentil(sorted, 99);
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const passou = p99 <= target;

  console.log(`\n📊 ${label}`);
  console.log(`   P50: ${p50}ms | P90: ${p90}ms | P95: ${p95}ms | P99: ${p99}ms`);
  console.log(`   Média: ${avg.toFixed(1)}ms | Min: ${min}ms | Max: ${max}ms`);
  console.log(`   Meta: ≤${target}ms → ${passou ? "✅ PASSOU" : "❌ FALHOU"}`);

  return { p50, p90, p95, p99, avg, min, max, passou };
}

const FULL_INCLUDE = {
  items: {
    include: {
      additionals: { include: { additional: true } },
      product: { select: { id: true, name: true, price: true, discount: true, image_url: true, production_time: true } },
      customizations: { include: { customization: true } },
    },
  },
  user: true,
  payment: true,
} as const;

let testUser: any;
let testProduct: any;

beforeAll(async () => {
  await cleanupTestData();
  const data = await seedTestData();
  testUser = data.user;
  testProduct = data.product;
  console.log(`\n🔧 Seed: 10 orders, user=${testUser.id}`);
}, 120000);

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// Jest may receive SIGINT/SIGTERM before afterAll runs. Clean the remote DB
// before allowing the process to terminate in that case.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    try {
      await cleanupTestData();
    } finally {
      await prisma.$disconnect();
      process.exit(1);
    }
  });
}

describe("P99 Integração - Banco Real Remoto", () => {
  it("Order findMany por usuário", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = Date.now();
      await prisma.order.findMany({
        where: { user_id: testUser.id },
        include: FULL_INCLUDE,
        orderBy: { created_at: "desc" },
      });
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /orders (user)", durations, 5000);
    expect(r.p99).toBeLessThanOrEqual(5000);
  });

  it("Order findUnique com joins", async () => {
    const order = await prisma.order.findFirst({ where: { user_id: testUser.id } });
    if (!order) return;

    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      await prisma.order.findUnique({
        where: { id: order.id },
        include: FULL_INCLUDE,
      });
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /orders/:id", durations, 5000);
    expect(r.p99).toBeLessThanOrEqual(5000);
  });

  it("Order findMany paginado com count", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = Date.now();
      await Promise.all([
        prisma.order.findMany({
          where: { source: "customer" as any },
          orderBy: { created_at: "desc" },
          take: 8,
          include: FULL_INCLUDE,
        }),
        prisma.order.count({ where: { source: "customer" as any } }),
      ]);
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /orders (admin)", durations, 8000);
    expect(r.p99).toBeLessThanOrEqual(8000);
  });

  it("Order summary mode", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = Date.now();
      await prisma.order.findMany({
        where: { source: "customer" as any },
        orderBy: { created_at: "desc" },
        take: 8,
        select: {
          id: true, status: true, total: true, grand_total: true,
          created_at: true, recipient_phone: true, delivery_date: true,
          user: { select: { id: true, name: true, phone: true } },
          _count: { select: { items: true } },
        },
      });
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /orders (summary)", durations, 4000);
    expect(r.p99).toBeLessThanOrEqual(4000);
  });

  it("User findUnique", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      await prisma.user.findUnique({ where: { id: testUser.id } });
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /users/:id", durations, 3000);
    expect(r.p99).toBeLessThanOrEqual(3000);
  });

  it("Product catálogo", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = Date.now();
      await prisma.product.findMany({
        where: { is_active: true },
        include: { type: true },
        take: 20,
      });
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /products", durations, 4000);
    expect(r.p99).toBeLessThanOrEqual(4000);
  });

  it("Stock check", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      await prisma.product.findUnique({
        where: { id: testProduct.id },
        select: { id: true, name: true, stock_quantity: true, stock_mode: true },
      });
      durations.push(Date.now() - start);
    }
    const r = logMetric("GET /stock", durations, 3000);
    expect(r.p99).toBeLessThanOrEqual(3000);
  });

  it("20x concorrência", async () => {
    const results = await Promise.all(
      Array(20).fill(null).map(async () => {
        const start = Date.now();
        await prisma.order.findMany({
          where: { user_id: testUser.id },
          include: {
            items: { include: { product: { select: { id: true, name: true, price: true } } } },
            user: true,
          },
          orderBy: { created_at: "desc" },
          take: 10,
        });
        return Date.now() - start;
      }),
    );
    const r = logMetric("20x Concorrência", results, 10000);
    expect(r.p99).toBeLessThanOrEqual(10000);
  });

  it("Order create + delete", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      const order = await prisma.order.create({
        data: {
          user_id: testUser.id,
          status: "PENDING",
          total: 99.9,
          grand_total: 99.9,
          delivery_city: "Campina Grande",
          delivery_state: "PB",
          recipient_phone: "83999990000",
          payment_method: "pix",
          source: "customer",
          items: { create: [{ product_id: testProduct.id, quantity: 1, price: 99.9 }] },
        },
      });
      durations.push(Date.now() - start);
      await prisma.orderItem.deleteMany({ where: { order_id: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    }
    const r = logMetric("POST /orders", durations, 5000);
    expect(r.p99).toBeLessThanOrEqual(5000);
  });
});
