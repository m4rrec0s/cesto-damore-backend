import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import prisma from "../database/prisma";
import logger from "../utils/logger";
import { printAgentWSManager } from "./printAgentWSManager";
import type { PrintJobPayload } from "../types/printJob";

const QUEUE_NAME = "payment-print-jobs";

let queue: Queue<PrintJobPayload> | null = null;
let worker: Worker<PrintJobPayload> | null = null;
let initialized = false;

function getRedisConnection(): IORedis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export async function startPrintQueue(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const connection = getRedisConnection();
  if (!connection) {
    logger.warn("[PrintQueue] REDIS_URL não configurada — jobs rodam sem fila");
    return;
  }

  queue = new Queue<PrintJobPayload>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: false,
      removeOnFail: false,
    },
  });

  worker = new Worker<PrintJobPayload>(
    QUEUE_NAME,
    async (job: Job<PrintJobPayload>) => {
      const sent = await dispatch(job.data);
      if (!sent) {
        throw new Error("Agente de impressão offline");
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: { max: 1, duration: 2000 },
    },
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    logger.warn({ jobId: job.id, error: err.message, attemptsMade: job.attemptsMade }, "print_queue_job_failed");
  });

  logger.info(`[PrintQueue] Fila ${QUEUE_NAME} inicializada`);
}

export async function enqueue(payload: PrintJobPayload): Promise<void> {
  await prisma.printJob.upsert({
    where: { orderId: payload.orderId },
    create: {
      id: payload.jobId,
      orderId: payload.orderId,
      customerName: payload.customerName,
      driveFolderId: payload.driveFolderId,
      filesJson: JSON.stringify(payload.files),
      status: "PENDING",
    },
    update: {
      status: "PENDING",
      attempts: { increment: 1 },
      filesJson: JSON.stringify(payload.files),
      lastError: null,
    },
  });

  const sent = await dispatch(payload);

  if (!sent && queue) {
    await queue.add("retry", payload, {
      jobId: `print-${payload.orderId}`,
      removeOnComplete: false,
      removeOnFail: false,
    });
    logger.info({ orderId: payload.orderId }, "print_job_queued_for_retry");
  }
}

async function dispatch(payload: PrintJobPayload): Promise<boolean> {
  if (!printAgentWSManager.isConnected()) return false;

  const sent = printAgentWSManager.send({
    type: "PRINT_JOB",
    jobId: payload.jobId,
    job: payload,
    timestamp: new Date().toISOString(),
  });

  if (sent) {
    await prisma.printJob.update({
      where: { id: payload.jobId },
      data: { status: "SENT", sentAt: new Date() },
    });
    logger.info({ jobId: payload.jobId, orderId: payload.orderId }, "print_job_sent");
  }

  return sent;
}
