import { addDays } from "date-fns";
import prisma from "../database/prisma";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type SessionRow = {
  session_id: string;
  message_count: bigint | number;
  last_message_at: Date | null;
};

type MappedMessageRole = "user" | "assistant" | "tool" | "system";

function toSafeDate(value: Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value.toISOString();
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function clampPagination(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function mapRole(rawMessage: Record<string, unknown>): MappedMessageRole {
  const rawType = (rawMessage.type ?? rawMessage.role ?? "").toString().toLowerCase();

  if (rawType === "human" || rawType === "user") return "user";
  if (rawType === "ai" || rawType === "assistant") return "assistant";
  if (rawType === "tool") return "tool";
  if (rawType === "system") return "system";

  return "assistant";
}

function mapContent(rawMessage: Record<string, unknown>): string {
  const content = rawMessage.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as Record<string, unknown>).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content === null || content === undefined) {
    return "";
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

class N8nChatHistoryService {
  private async ensureSessionExists(sessionId: string) {
    const existing = await prisma.aIAgentSession.findUnique({ where: { id: sessionId } });

    if (existing) {
      return existing;
    }

    const extractedPhone = sessionId.match(/^session-(\d+)$/)?.[1] ?? null;

    return prisma.aIAgentSession.create({
      data: {
        id: sessionId,
        customer_phone: extractedPhone,
        expires_at: addDays(new Date(), 5),
      },
    });
  }

  private async getSessionCustomerName(phone: string | null | undefined) {
    if (!phone) return undefined;

    const customer = await prisma.customer.findUnique({
      where: { number: phone },
      select: { name: true },
    });

    return customer || undefined;
  }

  async getSessionMessages(sessionId: string, pageInput?: unknown, limitInput?: unknown) {
    const page = clampPagination(pageInput, DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER);
    const limit = clampPagination(limitInput, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const session = await this.ensureSessionExists(sessionId);

    const [total, rows] = await Promise.all([
      prisma.n8n_chat_histories.count({ where: { session_id: sessionId } }),
      prisma.n8n_chat_histories.findMany({
        where: { session_id: sessionId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
    ]);

    const messages = rows
      .map((row) => {
        const parsed = row.message;
        const messageObject =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : ({ content: String(parsed ?? "") } as Record<string, unknown>);

        return {
          id: `n8n-${row.id}`,
          role: mapRole(messageObject),
          content: mapContent(messageObject),
          created_at: toSafeDate(row.createdAt),
          source: "n8n_chat_histories",
          raw: row.message,
        };
      })
      .reverse();

    const customer = await this.getSessionCustomerName(session.customer_phone);

    return {
      id: session.id,
      customer_phone: session.customer_phone,
      is_blocked: session.is_blocked,
      expires_at: session.expires_at.toISOString(),
      created_at: session.created_at.toISOString(),
      customer,
      _count: {
        messages: total,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + rows.length < total,
      },
      messages,
    };
  }

  async listSessions() {
    const groupedRows = await prisma.$queryRaw<SessionRow[]>`
      SELECT
        session_id,
        COUNT(*) AS message_count,
        MAX("createdAt") AS last_message_at
      FROM n8n_chat_histories
      GROUP BY session_id
    `;

    const groupedMap = new Map(
      groupedRows.map((row) => [
        row.session_id,
        {
          messageCount: toNumber(row.message_count),
          lastMessageAt: row.last_message_at,
        },
      ]),
    );

    const groupedSessionIds = [...groupedMap.keys()];
    const existingSessions = await prisma.aIAgentSession.findMany();
    const existingById = new Map(existingSessions.map((session) => [session.id, session]));

    const missingIds = groupedSessionIds.filter((id) => !existingById.has(id));

    if (missingIds.length > 0) {
      await Promise.all(missingIds.map((id) => this.ensureSessionExists(id)));
    }

    const allSessions =
      missingIds.length > 0
        ? await prisma.aIAgentSession.findMany()
        : existingSessions;

    const sessionsWithCustomer = await Promise.all(
      allSessions.map(async (session) => {
        const grouped = groupedMap.get(session.id);
        const customer = await this.getSessionCustomerName(session.customer_phone);

        return {
          id: session.id,
          customer_phone: session.customer_phone,
          is_blocked: session.is_blocked,
          expires_at: session.expires_at.toISOString(),
          created_at: session.created_at.toISOString(),
          customer,
          _count: {
            messages: grouped?.messageCount ?? 0,
          },
          _last_message_at: grouped?.lastMessageAt ?? null,
        };
      }),
    );

    return sessionsWithCustomer
      .sort((a, b) => {
        const aTime = a._last_message_at
          ? new Date(a._last_message_at).getTime()
          : new Date(a.created_at).getTime();
        const bTime = b._last_message_at
          ? new Date(b._last_message_at).getTime()
          : new Date(b.created_at).getTime();

        return bTime - aTime;
      })
      .map(({ _last_message_at, ...session }) => session);
  }

  async blockSession(sessionId: string) {
    await this.ensureSessionExists(sessionId);

    return prisma.aIAgentSession.update({
      where: { id: sessionId },
      data: {
        is_blocked: true,
        expires_at: addDays(new Date(), 4),
      },
    });
  }

  async unblockSession(sessionId: string) {
    await this.ensureSessionExists(sessionId);

    return prisma.aIAgentSession.update({
      where: { id: sessionId },
      data: {
        is_blocked: false,
      },
    });
  }

  async clearSessionHistory(sessionId: string) {
    const result = await prisma.n8n_chat_histories.deleteMany({
      where: { session_id: sessionId },
    });

    return result.count;
  }
}

export default new N8nChatHistoryService();
