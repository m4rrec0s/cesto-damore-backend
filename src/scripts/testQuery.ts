import dotenv from "dotenv";
dotenv.config();

import prisma from "../database/prisma";

async function main() {
  try {
    console.log("Checking AdminNotification table...");
    const count = await prisma.adminNotification.count();
    console.log("Total admin notifications in database:", count);

    const latest = await prisma.adminNotification.findMany({
      orderBy: { created_at: "desc" },
      take: 5,
    });
    console.log("Latest notifications:", JSON.stringify(latest, null, 2));

    const webhooksCount = await prisma.webhookLog.count();
    console.log("Total webhook logs in database:", webhooksCount);

    const latestWebhooks = await prisma.webhookLog.findMany({
      orderBy: { created_at: "desc" },
      take: 5,
    });
    console.log("Latest webhooks:", JSON.stringify(latestWebhooks, null, 2));
  } catch (error) {
    console.error("Database query failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
