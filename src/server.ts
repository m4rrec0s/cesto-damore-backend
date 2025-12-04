import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import routes from "./routes";
import cron from "node-cron";
import orderService from "./services/orderService";
import { PaymentService } from "./services/paymentService";
import logger from "./utils/logger";
import prisma from "./database/prisma";
import tempFileService from "./services/tempFileService";
import path from "path";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const baseStorageDir =
  process.env.NODE_ENV === "production" ? "/app/storage" : "storage";
const tempDir = path.join(process.cwd(), baseStorageDir, "temp");
app.use("/uploads/temp", express.static(tempDir));

const imagesDir = path.join(process.cwd(), "images");
app.use("/images", express.static(imagesDir));

app.get("/", async (req, res) => {
  return res.json({ message: "Cesto d'Amore Backend is running!" });
});

app.use(routes);

cron.schedule("0 */6 * * *", async () => {
  try {
    logger.info("🕒 [Cron] Iniciando limpeza de pedidos cancelados...");

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
      logger.info("🕒 [Cron] Nenhum pedido cancelado para deletar");
      return;
    }

    logger.info(
      `🕒 [Cron] Deletando ${canceledOrders.length} pedidos cancelados...`
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

const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL;

app.listen(PORT, () => {
  logger.info(`🚀 Server running on ${BASE_URL}`);
  logger.info(`📡 PORT: ${PORT}`);
  logger.info(`🔗 BASE_URL: ${BASE_URL}`);
  logger.info(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
  (async () => {
    try {
      await PaymentService.replayStoredWebhooks();
      // On startup, reprocess any failed finalizations (e.g., webhooks processed but finalization failed)
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
      err
    );
  }
});

// ============================================
// CRON JOB - Limpeza de arquivos temporários
// ============================================
// Executa a cada 6 horas (0 */6 * * *)
cron.schedule("0 */6 * * *", async () => {
  try {
    logger.info("🕒 [Cron] Iniciando limpeza de arquivos temporários...");

    // Limpar arquivos com mais de 48 horas
    const result = tempFileService.cleanupOldFiles(48);

    logger.info(
      `✅ [Cron] Limpeza de arquivos temporários concluída: ${result.deleted} deletados, ${result.failed} falharam`
    );
  } catch (error) {
    logger.error("❌ [Cron] Erro na limpeza de arquivos temporários:", error);
  }
});
