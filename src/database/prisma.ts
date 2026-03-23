import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

let prisma: PrismaClient;

try {
  if (process.env.NODE_ENV === "production") {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  } else {
    if (!global.__prisma) {
      global.__prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
    }
    prisma = global.__prisma;
  }
} catch (e: any) {
  logger.error(
    "Prisma client not initialized. Ensure you ran 'npx prisma generate' and the generated client is available."
  );
  throw e;
}

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export default prisma;
