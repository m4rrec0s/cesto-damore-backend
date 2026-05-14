import IORedis from "ioredis";
import { Queue } from "bullmq";
import logger from "../utils/logger";
import prisma from "../database/prisma";

const QUEUE_NAME = "agent-async";

let sharedConnection: IORedis | null = null;
let agentQueue: Queue | null = null;

export function getRedisConnection(): IORedis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!sharedConnection) {
    sharedConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
    });
    sharedConnection.on("error", (e) => {
      logger.warn(`[Redis] connection error: ${e}`);
    });
  }
  return sharedConnection;
}

export function getAgentAsyncQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!agentQueue) {
    agentQueue = new Queue(QUEUE_NAME, { connection: conn });
  }
  return agentQueue;
}

/** One-shot ping without keeping a global connection on the API process. */
export async function pingRedisHealth(): Promise<boolean> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return false;
  const c = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  try {
    await c.connect();
    const p = await c.ping();
    return p === "PONG";
  } catch {
    return false;
  } finally {
    try {
      await c.quit();
    } catch {
      /* ignore */
    }
  }
}

export async function runCustomerMemorySyncJob(sessionId: string): Promise<void> {
  const session = await prisma.aIAgentSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return;
  if (session.customer_phone) {
    const profile = await prisma.customerKnowledgeProfile.findUnique({
      where: { customer_phone: session.customer_phone },
    });
    if (profile?.auto_updates) {
      const customerKnowledgeService = (
        await import("../agent/service/customerKnowledgeProfileService")
      ).default;
      await customerKnowledgeService.learnFromSession(sessionId);
    }
  }
  logger.info(`[JobQueues] customer_memory_sync done session=${sessionId}`);
}

export async function enqueuePostSessionLearnings(
  sessionId: string,
): Promise<boolean> {
  const q = getAgentAsyncQueue();
  if (!q) return false;
  await q.add(
    "customer_memory_sync",
    { sessionId },
    { removeOnComplete: 50, removeOnFail: 20 },
  );
  return true;
}

export async function enqueueEmbeddingPrefetch(productId: string): Promise<boolean> {
  const q = getAgentAsyncQueue();
  if (!q) return false;
  await q.add(
    "embedding_prefetch",
    { productId },
    { removeOnComplete: 100, removeOnFail: 10 },
  );
  return true;
}

export async function enqueueSessionSummary(sessionId: string): Promise<boolean> {
  const q = getAgentAsyncQueue();
  if (!q) return false;
  await q.add(
    "session_summary",
    { sessionId },
    { removeOnComplete: 30, removeOnFail: 10 },
  );
  return true;
}

export { QUEUE_NAME };
