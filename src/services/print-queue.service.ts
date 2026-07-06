import { EventEmitter } from "events";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import prisma from "../database/prisma";
import logger from "../utils/logger";
import type { PrintJobPayload } from "../types/printJob";
import { printAgentHub } from "../routes/ws-print-agent";

export type PrintJobStatus = "pending" | "sent" | "received" | "printed" | "failed";

export interface PrintStatusEvent {
  jobId: string;
  status: PrintJobStatus;
  message: string;
  error?: string;
}

const PRINT_QUEUE_NAME = "print-jobs";
const ACK_TIMEOUT_MS = 30_000;
const PRINTED_TIMEOUT_MS = 15 * 60_000;

let instanceCounter = 0;

class PrintQueueService {
  public readonly instanceId: number;
  private queue: Queue<PrintJobPayload> | null = null;
  private worker: Worker<PrintJobPayload> | null = null;
  private readonly events = new EventEmitter();
  private initialized = false;
  private initializing: Promise<void> | null = null;

  constructor() {
    this.instanceId = ++instanceCounter;
    logger.info(`[PrintQueue] INSTANCE CREATED id=${this.instanceId}`);
  }

  async start(): Promise<void> {
    await this.initialize();
  }

  async addPrintJob(payload: PrintJobPayload): Promise<string> {
    await this.initialize();
    await this.upsertPrintJob(payload.orderId, payload, "pending");

    if (!this.queue) {
      throw new Error("Fila de impressao nao inicializada");
    }

    await this.queue.add("print-order", payload, {
      jobId: payload.orderId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.emitStatus({
      jobId: payload.orderId,
      status: "pending",
      message: "Job adicionado a fila",
    });

    return payload.orderId;
  }

  onStatus(jobId: string, listener: (event: PrintStatusEvent) => void): () => void {
    const eventName = this.getEventName(jobId);
    this.events.on(eventName, listener);
    const count = this.events.listenerCount(eventName);
    logger.info(`[PrintQueue] onStatus registered instance=${this.instanceId} jobId=${jobId} eventName=${eventName} count=${count}`);
    return () => {
      this.events.off(eventName, listener);
      const remaining = this.events.listenerCount(eventName);
      logger.info(`[PrintQueue] onStatus unsubscribed instance=${this.instanceId} jobId=${jobId} eventName=${eventName} remaining=${remaining}`);
    };
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.doInitialize();
    await this.initializing;
  }

  private async doInitialize(): Promise<void> {
    await this.ensureTable();

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL nao configurado para fila de impressao");
    }

    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<PrintJobPayload>(PRINT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      },
    });

    this.worker = new Worker<PrintJobPayload>(
      PRINT_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection,
        concurrency: 1,
      },
    );

    this.worker.on("failed", async (job, error) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      const exhausted = job.attemptsMade >= attempts;
      const status: PrintJobStatus = exhausted ? "failed" : "pending";
      await this.updatePrintJob(job.id || job.data.orderId, status, error.message);
      this.emitStatus({
        jobId: job.id || job.data.orderId,
        status,
        message: exhausted
          ? "Job falhou apos todas as tentativas"
          : "Job sera retentado com backoff",
        error: error.message,
      });
    });

    this.worker.on("error", (error) => {
      logger.error(`[PrintQueue] Worker error: ${error.message}`);
    });

    this.initialized = true;
    logger.info(`[PrintQueue] Fila ${PRINT_QUEUE_NAME} inicializada`);
  }

  private async processJob(job: Job<PrintJobPayload>): Promise<void> {
    const jobId = job.id || job.data.orderId;
    logger.info(`[PrintQueue] processJob iniciado jobId=${jobId}`);

    const dispatch = printAgentHub.dispatchPrintJob(
      jobId,
      job.data,
      ACK_TIMEOUT_MS,
      PRINTED_TIMEOUT_MS,
    );

    // Mark as sent only AFTER dispatching to agent (not before)
    // If process crashes before this, job stays PENDING and syncPendingJobs will recover it
    logger.info(`[PrintQueue] aguardando ACK jobId=${jobId}`);
    await dispatch.ack;

    // Agent confirmed receipt — now safe to mark as sent/received
    await this.updatePrintJob(jobId, "received");
    this.emitStatus({
      jobId,
      status: "received",
      message: "Agente recebeu o job (ACK)",
    });

    logger.info(`[PrintQueue] aguardando PRINTED jobId=${jobId}`);
    await dispatch.printed;
    logger.info(`[PrintQueue] PRINTED recebido, emitindo printed jobId=${jobId}`);
    await this.updatePrintJob(jobId, "printed");
    this.emitStatus({
      jobId,
      status: "printed",
      message: "Impressao confirmada",
    });
  }

  private async ensureTable(): Promise<void> {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        drive_folder_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        printed_at TIMESTAMPTZ
      )
    `);
  }

  private async upsertPrintJob(
    jobId: string,
    payload: PrintJobPayload,
    status: PrintJobStatus,
  ): Promise<void> {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO print_jobs (
          id,
          order_id,
          customer_name,
          drive_folder_id,
          payload,
          status,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          customer_name = EXCLUDED.customer_name,
          drive_folder_id = EXCLUDED.drive_folder_id,
          payload = EXCLUDED.payload,
          status = EXCLUDED.status,
          last_error = NULL,
          updated_at = NOW(),
          printed_at = NULL
      `,
      jobId,
      payload.orderId,
      payload.customerName,
      payload.driveFolderId,
      JSON.stringify(payload),
      status,
    );
  }

  private async updatePrintJob(
    jobId: string,
    status: PrintJobStatus,
    error?: string,
  ): Promise<void> {
    await prisma.$executeRawUnsafe(
      `
        UPDATE print_jobs
        SET
          status = $2,
          attempts = CASE WHEN $2 = 'pending' OR $2 = 'failed' THEN attempts + 1 ELSE attempts END,
          last_error = $3,
          updated_at = NOW(),
          printed_at = CASE WHEN $2 = 'printed' THEN NOW() ELSE printed_at END
        WHERE id = $1
      `,
      jobId,
      status,
      error || null,
    );
  }

  private emitStatus(event: PrintStatusEvent): void {
    const eventName = this.getEventName(event.jobId);
    const listenerCount = this.events.listenerCount(eventName);
    logger.info(`[PrintQueue] emitStatus instance=${this.instanceId} jobId=${event.jobId} status=${event.status} eventName=${eventName} listeners=${listenerCount}`);
    this.events.emit(eventName, event);
  }

  private getEventName(jobId: string): string {
    return `print-job:${jobId}`;
  }
}

export const printQueueService = new PrintQueueService();
