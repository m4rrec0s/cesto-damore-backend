import dotenv from "dotenv";
dotenv.config();

import { validateEnv } from "./utils/envValidator";

validateEnv();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import routes from "./routes";
import cron from "node-cron";
import orderService from "./services/orderService";
import { PaymentService } from "./services/paymentService";
import { webhookNotificationService } from "./services/webhookNotificationService";
import { chatRealtimeService } from "./services/chatRealtimeService";
import scheduledJobsService from "./services/scheduledJobsService";
import logger from "./utils/logger";
import prisma from "./database/prisma";
import tempFileService from "./services/tempFileService";
import followUpService from "./services/followUpService";
import reservationService from "./services/reservationService";
import { apiRateLimit, requireApiKey, initializeSecurityMonitor } from "./middleware/security";
import path from "path";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  }),
);

const allowedOrigins = [
  "https://cestodamore.com.br",
  "http://185.205.246.213",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:3333",
  "http://localhost:5173",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const isMainDomain = origin === "https://cestodamore.com.br";
    const isSubdomain = origin.endsWith(".cestodamore.com.br");

    if (isMainDomain || isSubdomain || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origem ${origin} não permitida por CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-API-Key",
    "api-key",
    "x-ai-api-key",
    "ngrok-skip-browser-warning",
  ],
  exposedHeaders: ["Content-Length", "Content-Type"],
};

app.use(cors(corsOptions));

// OPTIONS (preflight) deve responder ANTES do requireApiKey
app.options(/.*/, cors(corsOptions));

// Middleware de API key vem DEPOIS do OPTIONS handler
app.use(requireApiKey);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const normalizePath = (envVar?: string, defaultPath: string = "") => {
  if (!envVar) return path.join(process.cwd(), defaultPath);
  return path.resolve(envVar);
};

const tempDir = normalizePath(process.env.TEMP_UPLOADS_DIR, "storage/temp");

logger.info(`📂 [Server] Serving temp files from: ${tempDir}`);
app.use("/uploads/temp", express.static(tempDir));

const imagesDir = normalizePath(process.env.UPLOAD_DIR, "images");

logger.info(`📂 [Server] Serving images from: ${imagesDir}`);
app.use(
  "/images",
  express.static(imagesDir, {
    maxAge: "365d",
    immutable: true,
  }),
);

app.get("/", async (req, res) => {
  return res.json({ message: "Cesto d'Amore Backend is running!" });
});

app.use(routes);

scheduledJobsService.start();
chatRealtimeService
  .initCursor()
  .then(() => chatRealtimeService.startPolling())
  .catch((error) => {
    logger.error("❌ [ChatStream] Falha ao iniciar stream de chat:", error);
  });

cron.schedule("0 */6 * * *", async () => {
  try {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const canceledOrders = await prisma.order.findMany({
      where: {
        status: "CANCELED",
        updated_at: {
          lt: twentyFourHoursAgo,
        },
      },
      select: {
        id: true,
        updated_at: true,
      },
    });

    if (canceledOrders.length === 0) {
      return;
    }

    logger.info(
      `🕒 [Cron] Deletando ${canceledOrders.length} pedidos cancelados...`,
    );

    for (const order of canceledOrders) {
      try {
        await orderService.deleteOrder(order.id);
        logger.info(`✅ [Cron] Pedido cancelado deletado: ${order.id}`);
      } catch (error) {
        logger.error(`❌ [Cron] Erro ao deletar pedido ${order.id}:`, error);
      }
    }

    logger.info("✅ [Cron] Limpeza de pedidos cancelados concluída");
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de pedidos cancelados:", error);
  }
});

cron.schedule("*/10 * * * *", async () => {
  try {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const expiredSessionIds = await prisma.aIAgentSession.findMany({
      where: {
        expires_at: {
          lt: now,
        },
      },
      select: { id: true, customer_phone: true },
    });

    if (expiredSessionIds.length > 0) {
      const ids = expiredSessionIds.map((s) => s.id);

      await prisma.aIAgentMessage.deleteMany({
        where: {
          session_id: { in: ids },
        },
      });

      await prisma.aISessionProductHistory.deleteMany({
        where: {
          session_id: { in: ids },
        },
      });

      const expiredCount = await prisma.aIAgentSession.deleteMany({
        where: {
          id: { in: ids },
        },
      });

      logger.info(
        `🕒 [Cron] Limpeza concluída: ${expiredCount.count} sessões e seus dados removidos`,
      );
    }

    const expiredMemories = await prisma.customerMemory.deleteMany({
      where: {
        expires_at: {
          lt: now,
        },
      },
    });

    if (expiredMemories.count > 0) {
      logger.info(
        `🕒 [Cron] Deletadas ${expiredMemories.count} memórias de clientes expiradas`,
      );
    }

    const expiredN8nMessages = await prisma.n8n_chat_histories.deleteMany({
      where: {
        createdAt: {
          lt: fiveDaysAgo,
        },
      },
    });

    if (expiredN8nMessages.count > 0) {
      logger.info(
        `🕒 [Cron] Deletadas ${expiredN8nMessages.count} mensagens n8n expiradas (5 dias)`,
      );
    }
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de dados expirados:", error);
  }
});

const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL;

// Inicializa o monitoramento de segurança
initializeSecurityMonitor();

app.listen(PORT, () => {
  logger.status(`🚀 Server running`, "green");
  logger.status(`📡 PORT: ${PORT}`, "green");
  logger.status(`🔗 BASE_URL: ${BASE_URL ? "[configured]" : "[not set]"}`, "green");
  logger.status(
    `🌐 Environment: ${process.env.NODE_ENV || "development"}`,
    "green",
  );
  (async () => {
    try {
      await PaymentService.replayStoredWebhooks();
      try {
        await PaymentService.reprocessFailedFinalizations();
      } catch (err) {
        logger.error("Erro ao reprocessar finalizações na inicialização:", err);
      }
    } catch (err) {
      logger.error("Erro ao executar replay de webhooks armazenados:", err);
    }
  })();
});

cron.schedule("*/5 * * * *", async () => {
  try {
    await PaymentService.replayStoredWebhooks();
    await PaymentService.reprocessFailedFinalizations();
  } catch (err) {
    logger.error(
      "Erro ao executar replay periódico de webhooks armazenados:",
      err,
    );
  }
});

cron.schedule("0 */6 * * *", async () => {
  try {
    const result = tempFileService.cleanupOldFiles(48);
    logger.info(
      `✅ [Cron] Limpeza de arquivos temporários concluída: ${result.deleted} deletados, ${result.failed} falharam`,
    );
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de arquivos temporários:", error);
  }
});

cron.schedule("*/10 * * * *", () => {
  try {
    webhookNotificationService.cleanupDeadConnections();
    chatRealtimeService.cleanupDeadConnections();
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de conexões SSE:", error);
  }
});

cron.schedule("*/10 * * * *", async () => {
  try {
    await followUpService.triggerFollowUpFunction();
  } catch (error) {
    logger.error("❌ [Cron] Erro ao disparar follow-up automático:", error);
  }
});

cron.schedule("*/15 * * * *", async () => {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = await prisma.botSession.deleteMany({
      where: {
        updated_at: {
          lt: threeDaysAgo,
        },
      },
    });

    if (result.count > 0) {
      logger.info(
        `🧹 [Cron] Sessões do bot expiradas removidas: ${result.count}`,
      );
    }
  } catch (error) {
    logger.error("❌ [Cron] Erro ao limpar sessões expiradas do bot:", error);
  }
});

cron.schedule("*/20 * * * *", async () => {
  try {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

    const orphanedCustomizations = await prisma.orderItemCustomization.findMany(
      {
        where: {
          created_at: {
            lt: twentyMinutesAgo,
          },
        },
        select: {
          id: true,
          value: true,
          created_at: true,
          order_item_id: true,
        },
      },
    );

    const orphaned = orphanedCustomizations.filter(
      (c: any) => !c.order_item_id,
    );

    if (orphaned.length === 0) {
      return;
    }

    logger.info(
      `🕒 [Cron] Encontradas ${orphaned.length} customização(ões) órfã(s)...`,
    );

    let cleanedCount = 0;
    const tempFilesToDelete: string[] = [];

    for (const customization of orphaned) {
      try {
        const value = JSON.parse(customization.value);

        if (value.photos && Array.isArray(value.photos)) {
          value.photos.forEach((photo: any) => {
            if (
              photo.preview_url &&
              photo.preview_url.includes("/uploads/temp/")
            ) {
              const filename = photo.preview_url.split("/uploads/temp/").pop();
              if (filename) tempFilesToDelete.push(filename);
            }
          });
        }

        if (value.final_artwork && value.final_artwork.preview_url) {
          const url = value.final_artwork.preview_url;
          if (url.includes("/uploads/temp/")) {
            const filename = url.split("/uploads/temp/").pop();
            if (filename) tempFilesToDelete.push(filename);
          }
        }

        if (value.final_artworks && Array.isArray(value.final_artworks)) {
          value.final_artworks.forEach((artwork: any) => {
            if (
              artwork.preview_url &&
              artwork.preview_url.includes("/uploads/temp/")
            ) {
              const filename = artwork.preview_url
                .split("/uploads/temp/")
                .pop();
              if (filename) tempFilesToDelete.push(filename);
            }
          });
        }

        if (
          (value.customization_type === "DYNAMIC_LAYOUT" ||
            value.customizationType === "DYNAMIC_LAYOUT") &&
          value.text &&
          typeof value.text === "string" &&
          value.text.includes("/uploads/temp/")
        ) {
          const filename = value.text.split("/uploads/temp/").pop();
          if (filename) tempFilesToDelete.push(filename);
        }

        await prisma.orderItemCustomization.delete({
          where: { id: customization.id },
        });

        logger.debug(`✅ Customização órfã deletada: ${customization.id}`);
        cleanedCount++;
      } catch (err) {
        logger.warn(
          `⚠️ Erro ao processar customização órfã ${customization.id}:`,
          err,
        );
      }
    }

    if (tempFilesToDelete.length > 0) {
      const result = tempFileService.deleteFiles(tempFilesToDelete);
      logger.info(
        `🗑️ Arquivos temporários deletados: ${result.deleted}, falharam: ${result.failed}`,
      );
    }

    logger.info(
      `✅ [Cron] Limpeza de imagens órfãs concluída: ${cleanedCount} customização(ões) deletada(s)`,
    );
  } catch (error) {
    logger.error(
      "❌ [Cron] Erro na limpeza de imagens órfãs DYNAMIC_LAYOUT:",
      error,
    );
  }
});

cron.schedule("*/5 * * * *", async () => {
  try {
    const cleaned = await reservationService.cleanupExpiredReservations();
    if (cleaned > 0) {
      logger.info(`🧹 [Cron] Reservas expiradas limpas: ${cleaned}`);
    }
  } catch (error) {
    logger.error("❌ [Cron] Erro ao limpar reservas expiradas:", error);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("🛑 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("🛑 Uncaught Exception:", error);

  process.exit(1);
});

process.on("SIGTERM", () => {
  logger.info("🛑 SIGTERM recebido, parando scheduled jobs...");
  scheduledJobsService.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("🛑 SIGINT recebido, parando scheduled jobs...");
  scheduledJobsService.stop();
  process.exit(0);
});
