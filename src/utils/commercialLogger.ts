import fs from "fs/promises";
import path from "path";
import logger from "./logger";

export function getCommercialLogBaseDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.COMMERCIAL_LOG_DIR || "storage/logs",
  );
}

export type CommercialLogPaths = {
  baseDir: string;
  agent: string;
  conversion: string;
  sessions: string;
  errors: string;
};

export function getCommercialLogPaths(): CommercialLogPaths {
  const baseDir = getCommercialLogBaseDir();
  return {
    baseDir,
    agent: path.join(baseDir, "agent.log"),
    conversion: path.join(baseDir, "conversion.log"),
    sessions: path.join(baseDir, "sessions.log"),
    errors: path.join(baseDir, "errors.log"),
  };
}

const TAIL_SCAN_BYTES = Math.min(
  Math.max(4096, Number(process.env.AGENT_LOG_TAIL_SCAN_BYTES || "262144")),
  1048576,
);

/** Lê o final de um arquivo de texto e devolve linhas que contêm `needle`. */
export async function tailLogLinesContaining(
  filePath: string,
  needle: string,
  maxLines: number,
): Promise<string[]> {
  if (!needle) return [];
  try {
    const stat = await fs.stat(filePath);
    const toRead = Math.min(stat.size, TAIL_SCAN_BYTES);
    const start = stat.size - toRead;
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(toRead);
      await fh.read(buf, 0, toRead, start);
      const text = buf.toString("utf-8");
      const lines = text.split("\n");
      const hits = lines.filter((ln) => ln.includes(needle));
      return hits.slice(-maxLines);
    } finally {
      await fh.close();
    }
  } catch {
    return [];
  }
}

type CommercialChannel = "conversion" | "agent" | "sessions" | "errors";

function channelFile(ch: CommercialChannel): string {
  const map: Record<CommercialChannel, string> = {
    conversion: "conversion.log",
    agent: "agent.log",
    sessions: "sessions.log",
    errors: "errors.log",
  };
  return path.join(getCommercialLogBaseDir(), map[ch]);
}

async function appendJsonl(channel: CommercialChannel, record: object) {
  try {
    const base = getCommercialLogBaseDir();
    await fs.mkdir(base, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...record,
    });
    await fs.appendFile(channelFile(channel), `${line}\n`, "utf-8");
  } catch (e) {
    logger.warn(`[commercialLogger] append failed (${channel}): ${e}`);
  }
}

export const commercialLogger = {
  conversion(event: string, payload: Record<string, unknown> = {}) {
    return appendJsonl("conversion", { event, ...payload });
  },
  agent(event: string, payload: Record<string, unknown> = {}) {
    return appendJsonl("agent", { event, ...payload });
  },
  session(event: string, payload: Record<string, unknown> = {}) {
    return appendJsonl("sessions", { event, ...payload });
  },
  error(event: string, payload: Record<string, unknown> = {}) {
    return appendJsonl("errors", { event, ...payload });
  },
};
