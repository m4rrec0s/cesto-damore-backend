"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
let prisma;
try {
    if (process.env.NODE_ENV === "production") {
        prisma = new client_1.PrismaClient({
            datasources: {
                db: {
                    url: process.env.DATABASE_URL,
                },
            },
        });
    }
    else {
        if (!global.__prisma) {
            global.__prisma = new client_1.PrismaClient({
                datasources: {
                    db: {
                        url: process.env.DATABASE_URL,
                    },
                },
            });
        }
        prisma = global.__prisma;
    }
}
catch (e) {
    console.error("Prisma client not initialized. Ensure you ran 'npx prisma generate' and the generated client is available.");
    throw e;
}
// Graceful shutdown
process.on("beforeExit", async () => {
    await prisma.$disconnect();
});
exports.default = prisma;
