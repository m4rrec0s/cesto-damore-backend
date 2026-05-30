import type { WebSocket } from "ws";
import prisma from "../database/prisma";
import logger from "../utils/logger";
import type { WSOutboundMessage, WSInboundMessage, PrintJobPayload } from "../types/printJob";
import { printAgentHub } from "../routes/ws-print-agent";

class PrintAgentWSManager {
  private oncePrinterStatus: ((printers: string[]) => void) | null = null;

  register(socket: WebSocket, clientId: string): void {
    printAgentHub.setAgentSocket(socket);

    socket.on("message", (raw: Buffer) => {
      this.handleInbound(raw.toString()).catch((err) => {
        logger.error({ err }, "print_agent_inbound_error");
      });
    });

    this.syncPrinterConfig().catch((err) => {
      logger.error({ err }, "printer_config_sync_on_connect_failed");
    });
  }

  isConnected(): boolean {
    return printAgentHub.isConnected();
  }

  send(msg: WSOutboundMessage): boolean {
    return printAgentHub.sendRaw(msg as unknown as Record<string, unknown>).success;
  }

  private async handleInbound(raw: string): Promise<void> {
    let msg: WSInboundMessage;
    try {
      msg = JSON.parse(raw) as WSInboundMessage;
    } catch (parseErr) {
      logger.error({ raw, err: parseErr }, "ws_inbound_parse_failed");
      return;
    }

    const jobId = (msg as any).jobId as string | undefined;
    logger.info({ type: msg.type, jobId }, "ws_inbound_received");

    if (!jobId) {
      if (msg.type === "PRINTER_STATUS") {
        const printers = (msg as any).printers as string[];
        if (this.oncePrinterStatus) {
          this.oncePrinterStatus(printers);
          this.oncePrinterStatus = null;
        }
      }
      return;
    }

    const whereClause = {
      OR: [
        { id: jobId },
        { orderId: jobId },
      ],
    };

    try {
      switch (msg.type) {
        case "ACK":
          await prisma.printJob.updateMany({
            where: {
              ...whereClause,
              status: { in: ["PENDING", "SENT"] },
            },
            data: { status: "RECEIVED", ackedAt: new Date() },
          });
          logger.info({ jobId }, "db_updated_RECEIVED");
          break;

        case "PRINTED":
        case "COMPLETED":
          await prisma.printJob.updateMany({
            where: {
              ...whereClause,
              status: { notIn: ["FAILED"] },
            },
            data: { status: "PRINTED", printedAt: new Date() },
          });
          logger.info({ jobId }, "db_updated_PRINTED");
          break;

        case "FAILED":
          await prisma.printJob.updateMany({
            where: whereClause,
            data: {
              status: "FAILED",
              lastError: (msg as any).error ?? "unknown error",
            },
          });
          logger.warn({ jobId, error: (msg as any).error }, "db_updated_FAILED");
          break;

        default:
          logger.info({ type: msg.type, jobId }, "ws_progress_event_ignored");
      }
    } catch (dbErr) {
      logger.error({ err: dbErr, type: msg.type, jobId }, "db_update_FAILED");
    }
  }

  private async syncPrinterConfig(): Promise<void> {
    try {
      const configs = await prisma.printerConfig.findMany();
      const photo = configs.find((c) => c.role === "photo")?.printerName ?? null;
      const letter = configs.find((c) => c.role === "letter")?.printerName ?? null;

      this.send({
        type: "PRINTER_CONFIG_UPDATE",
        config: { photo, letter },
        timestamp: new Date().toISOString(),
      });

      logger.info({ photo, letter }, "printer_config_synced_on_connect");
    } catch (err) {
      logger.error({ err }, "printer_config_sync_failed");
    }
  }

  async syncPendingJobs(): Promise<void> {
    const jobs = await prisma.printJob.findMany({
      where: {
        status: { in: ["PENDING"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

    logger.info({ count: jobs.length }, "print_sync_pending_jobs");

    if (jobs.length === 0) return;

    await this.syncPrinterConfig();

    for (const job of jobs) {
      try {
        const payload: PrintJobPayload = {
          jobId: job.id,
          orderId: job.orderId,
          customerName: job.customerName,
          driveFolderId: job.driveFolderId,
          files: JSON.parse(job.filesJson) as PrintJobPayload["files"],
        };

        const sent = this.send({
          type: "PRINT_JOB",
          jobId: payload.jobId,
          job: payload,
          timestamp: new Date().toISOString(),
        });

        if (sent) {
          await prisma.printJob.update({
            where: { id: job.id },
            data: { status: "SENT", sentAt: new Date() },
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        logger.error({ err, jobId: job.id }, "print_sync_pending_job_error");
      }
    }
  }
}

export const printAgentWSManager = new PrintAgentWSManager();
