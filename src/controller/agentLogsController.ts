import { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import logger from "../utils/logger";

const getLogDir = () => process.env.COMMERCIAL_LOG_DIR || "storage/logs";
const getAgentLogPath = () => path.join(getLogDir(), "agent.log");

interface AgentLogEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

/**
 * Parse JSONL file and return entries
 */
async function parseAgentLogs(
  filePath: string,
  limit?: number,
  offset: number = 0,
): Promise<AgentLogEntry[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const entries: AgentLogEntry[] = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AgentLogEntry => entry !== null)
      .reverse(); // Show newest first

    const paginated = entries.slice(offset, limit ? offset + limit : undefined);
    return paginated;
  } catch (error) {
    logger.error(`Failed to parse agent logs: ${error}`);
    return [];
  }
}

/**
 * GET /agent-logs - Fetch agent logs with filters
 */
export async function getAgentLogs(req: Request, res: Response) {
  try {
    const logPath = getAgentLogPath();

    // Check if file exists
    try {
      await fs.access(logPath);
    } catch {
      return res.json({
        entries: [],
        total: 0,
        truncated: false,
      });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const eventFilter = req.query.event as string;
    const sessionFilter = req.query.sessionId as string;

    const allEntries = await parseAgentLogs(logPath);

    let filtered = allEntries;

    if (eventFilter) {
      filtered = filtered.filter((entry) => entry.event === eventFilter);
    }

    if (sessionFilter) {
      filtered = filtered.filter((entry) =>
        JSON.stringify(entry).includes(sessionFilter),
      );
    }

    const total = filtered.length;
    const entries = filtered.slice(offset, offset + limit);
    const truncated = offset + limit < total;

    res.json({
      entries,
      total,
      truncated,
    });
  } catch (error) {
    logger.error(`Error fetching agent logs: ${error}`);
    res.status(500).json({ error: "Failed to fetch agent logs" });
  }
}

/**
 * GET /agent-logs/events - Get list of unique events
 */
export async function getAvailableEvents(req: Request, res: Response) {
  try {
    const logPath = getAgentLogPath();

    try {
      await fs.access(logPath);
    } catch {
      return res.json({ events: [] });
    }

    const entries = await parseAgentLogs(logPath);
    const events = Array.from(new Set(entries.map((e) => e.event))).sort();

    res.json({ events });
  } catch (error) {
    logger.error(`Error fetching available events: ${error}`);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}

/**
 * GET /agent-logs/stats - Get statistics about logs
 */
export async function getAgentLogStats(req: Request, res: Response) {
  try {
    const logPath = getAgentLogPath();

    try {
      await fs.access(logPath);
    } catch {
      return res.json({
        totalEntries: 0,
        eventsCount: {},
        lastUpdate: new Date().toISOString(),
      });
    }

    const entries = await parseAgentLogs(logPath);

    const eventsCount: Record<string, number> = {};
    entries.forEach((entry) => {
      eventsCount[entry.event] = (eventsCount[entry.event] || 0) + 1;
    });

    res.json({
      totalEntries: entries.length,
      eventsCount,
      lastUpdate: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Error fetching agent log stats: ${error}`);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
}

/**
 * GET /agent-logs/export - Export logs as CSV
 */
export async function exportAgentLogs(req: Request, res: Response) {
  try {
    const logPath = getAgentLogPath();

    try {
      await fs.access(logPath);
    } catch {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="agent-logs.csv"',
      );
      res.send("timestamp,event,payload\n");
      return;
    }

    const entries = await parseAgentLogs(logPath);

    // Convert to CSV
    let csv = "timestamp,event,payload\n";
    entries.forEach((entry) => {
      const { ts, event, ...payload } = entry;
      const payloadStr = JSON.stringify(payload).replace(/"/g, '""');
      csv += `"${ts}","${event}","${payloadStr}"\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="agent-logs-${new Date().toISOString().split("T")[0]}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    logger.error(`Error exporting agent logs: ${error}`);
    res.status(500).json({ error: "Failed to export logs" });
  }
}

export default {
  getAgentLogs,
  getAvailableEvents,
  getAgentLogStats,
  exportAgentLogs,
};
