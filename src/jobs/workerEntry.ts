import dotenv from "dotenv";
dotenv.config();

import IORedis from "ioredis";
import { Worker } from "bullmq";
import logger from "../utils/logger";
import { QUEUE_NAME, runCustomerMemorySyncJob } from "./jobQueues";

const url = process.env.REDIS_URL?.trim();
if (!url) {
  logger.error("[worker] REDIS_URL não definido — encerrando.");
  process.exit(1);
}

const connection = new IORedis(url, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === "customer_memory_sync") {
      const sessionId = String(job.data?.sessionId || "");
      if (!sessionId) return;
      await runCustomerMemorySyncJob(sessionId);
      return;
    }
    if (job.name === "embedding_prefetch") {
      logger.info(
        `[worker] embedding_prefetch placeholder productId=${job.data?.productId}`,
      );
      return;
    }
    if (job.name === "session_summary") {
      logger.info(
        `[worker] session_summary placeholder session=${job.data?.sessionId}`,
      );
      return;
    }
    logger.warn(`[worker] job desconhecido: ${job.name}`);
  },
  { connection: connection.duplicate() },
);

worker.on("failed", (job, err) => {
  logger.error(`[worker] job failed ${job?.name}: ${err}`);
});

logger.info(`[worker] escutando fila ${QUEUE_NAME}`);
