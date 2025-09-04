import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

let prisma: PrismaClient;

try {
  if (process.env.NODE_ENV === "production") {
    prisma = new PrismaClient();
  } else {
    if (!global.__prisma) {
      global.__prisma = new PrismaClient();
    }
    prisma = global.__prisma;
  }
} catch (e: any) {
  console.error(
    "Prisma client not initialized. Ensure you ran 'npx prisma generate' and the generated client is available."
  );
  throw e;
}

export default prisma;
