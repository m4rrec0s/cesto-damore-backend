import prisma from "../database/prisma";

async function backfillPendingOwnerKey() {
  console.log("🔧 [backfillPendingOwnerKey] Iniciando saneamento...");

  const duplicateUsers = await prisma.order.groupBy({
    by: ["user_id"],
    where: { status: "PENDING" },
    _count: { _all: true },
  });

  const usersWithDuplicates = duplicateUsers.filter(
    (entry) => (entry._count?._all || 0) > 1,
  );

  let canceledDuplicates = 0;
  for (const entry of usersWithDuplicates) {
    const pendingOrders = await prisma.order.findMany({
      where: { user_id: entry.user_id, status: "PENDING" },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });

    const toCancel = pendingOrders.slice(1).map((order) => order.id);
    if (toCancel.length === 0) continue;

    const result = await prisma.order.updateMany({
      where: { id: { in: toCancel } },
      data: {
        status: "CANCELED",
        pending_owner_key: null,
      },
    });
    canceledDuplicates += result.count;
  }

  const pendingOrders = await prisma.order.findMany({
    where: { status: "PENDING" },
    select: { id: true, user_id: true, pending_owner_key: true },
  });

  let fixedPendingKeys = 0;
  for (const order of pendingOrders) {
    if (order.pending_owner_key === order.user_id) continue;

    await prisma.order.update({
      where: { id: order.id },
      data: { pending_owner_key: order.user_id },
    });
    fixedPendingKeys++;
  }

  const clearedNonPending = await prisma.order.updateMany({
    where: {
      status: { not: "PENDING" },
      pending_owner_key: { not: null },
    },
    data: { pending_owner_key: null },
  });

  console.log("✅ [backfillPendingOwnerKey] Saneamento concluído:", {
    usersWithDuplicates: usersWithDuplicates.length,
    canceledDuplicates,
    fixedPendingKeys,
    clearedNonPending: clearedNonPending.count,
  });
}

backfillPendingOwnerKey()
  .catch((error) => {
    console.error("❌ [backfillPendingOwnerKey] Falha:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
