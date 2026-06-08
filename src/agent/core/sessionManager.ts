import prisma from "../../database/prisma";
import { addHours, isPast } from "date-fns";
import type { AgentContext, ChatMessage } from "./types";
import { ShortTermMemoryStore } from "./memory/shortTerm";
import { loadLongTermProfile } from "./memory/longTerm";
import logger from "../../utils/logger";

interface InitSessionParams {
  customerPhone: string;
  customerName?: string;
}

export async function initSession(
  params: InitSessionParams,
): Promise<AgentContext> {
  const { customerPhone, customerName } = params;
  const sessionId = `session-${customerPhone}`;

  const session = await getOrCreateSession(sessionId, customerPhone);

  const shortTerm = new ShortTermMemoryStore();

  // Hydrate short-term from existing messages
  if (session.messages?.length) {
    for (const msg of session.messages) {
      shortTerm.append({
        role: msg.role as ChatMessage["role"],
        content: msg.content,
      });
    }
  }

  const longTerm = await loadLongTermProfile(customerPhone);

  // Resolve name: param > DB > fallback
  let resolvedName = customerName;
  if (!resolvedName) {
    const customer = await prisma.customer.findUnique({
      where: { number: customerPhone },
      select: { name: true },
    });
    resolvedName = customer?.name ?? undefined;
  }

  return {
    sessionId: session.id,
    customerPhone,
    customerName: resolvedName,
    shortTerm,
    longTerm,
  };
}

async function getOrCreateSession(sessionId: string, customerPhone: string) {
  let session = await prisma.aIAgentSession.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: { created_at: "asc" } } },
  });

  if (session && isPast(session.expires_at)) {
    logger.info(`[SessionManager] Sessão expirada, recriando: ${sessionId}`);
    await prisma.aIAgentMessage.deleteMany({ where: { session_id: sessionId } });
    await prisma.aISessionProductHistory.deleteMany({ where: { session_id: sessionId } });
    await prisma.aIAgentSession.delete({ where: { id: sessionId } });
    session = null;
  }

  if (!session) {
    session = await prisma.aIAgentSession.create({
      data: {
        id: sessionId,
        customer_phone: customerPhone,
        expires_at: addHours(new Date(), 24),
      },
      include: { messages: true },
    });
    logger.info(`[SessionManager] Nova sessão: ${sessionId}`);
  }

  return session;
}
