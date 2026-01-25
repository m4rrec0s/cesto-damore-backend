import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import routes from "./routes";
import cron from "node-cron";
import orderService from "./services/orderService";
import { PaymentService } from "./services/paymentService";
import { webhookNotificationService } from "./services/webhookNotificationService";
import logger from "./utils/logger";
import prisma from "./database/prisma";
import tempFileService from "./services/tempFileService";
import followUpService from "./services/followUpService";
import path from "path";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const tempDir = process.env.TEMP_UPLOADS_DIR
  ? path.resolve(process.env.TEMP_UPLOADS_DIR)
  : process.env.NODE_ENV === "production"
    ? "/app/storage/temp"
    : path.join(process.cwd(), "storage", "temp");

logger.info(`📂 [Server] Serving temp files from: ${tempDir}`);
app.use("/uploads/temp", express.static(tempDir));

const imagesDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.NODE_ENV === "production"
    ? "/app/images"
    : path.join(process.cwd(), "images");

logger.info(`📂 [Server] Serving images from: ${imagesDir}`);
app.use("/images", express.static(imagesDir));

app.get("/", async (req, res) => {
  return res.json({ message: "Cesto d'Amore Backend is running!" });
});

app.use(routes);

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

    const expiredSessionIds = await prisma.aIAgentSession.findMany({
      where: {
        expires_at: {
          lt: now,
        },
      },
      select: { id: true },
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
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de dados expirados:", error);
  }
});

const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL;

app.listen(PORT, () => {
  logger.status(`🚀 Server running on ${BASE_URL}`, "green");
  logger.status(`📡 PORT: ${PORT}`, "green");
  logger.status(`🔗 BASE_URL: ${BASE_URL}`, "green");
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
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de conexões SSE:", error);
  }
});

// FollowUp Automation - runs every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  try {
    await followUpService.triggerFollowUpFunction();
  } catch (error) {
    logger.error("❌ [Cron] Erro ao disparar follow-up automático:", error);
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

        // ✅ NOVO: Buscar arquivo em text (DYNAMIC_LAYOUT)
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
