import type { WebSocket } from "ws";
import prisma from "../database/prisma";
import logger from "../utils/logger";
import type { WSOutboundMessage, PrintJobPayload } from "../types/printJob";
import { printAgentHub } from "../routes/ws-print-agent";

class PrintAgentWSManager {
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
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logger.warn({ raw }, "print_agent_invalid_json");
      return;
    }

    const type = parsed.type as string;
    const jobId = parsed.jobId as string | undefined;
    if (!type) return;
    if (!jobId && type !== "PRINTER_STATUS") return;

    logger.info({ type, jobId }, "ws_inbound_received");

    try {
      switch (type) {
        case "ACK": {
          await prisma.printJob.updateMany({
            where: {
              OR: [{ id: jobId }, { orderId: jobId }],
              status: { in: ["PENDING", "SENT"] },
            },
            data: { status: "RECEIVED", ackedAt: new Date() },
          });
          logger.info({ jobId }, "print_job_acked_in_db");
          break;
        }

        case "PRINTED": {
          await prisma.printJob.updateMany({
            where: {
              OR: [{ id: jobId }, { orderId: jobId }],
              status: { notIn: ["FAILED"] },
            },
            data: { status: "PRINTED", printedAt: new Date() },
          });
          logger.info({ jobId }, "print_job_printed_in_db");
          break;
        }

        case "COMPLETED": {
          await prisma.printJob.updateMany({
            where: {
              OR: [{ id: jobId }, { orderId: jobId }],
              status: { notIn: ["FAILED"] },
            },
            data: { status: "PRINTED", printedAt: new Date() },
          });
          logger.info({ jobId }, "print_job_completed_in_db");
          break;
        }

        case "FAILED": {
          const errorMsg = typeof parsed.error === "string" ? parsed.error : "unknown";
          await prisma.printJob.updateMany({
            where: {
              OR: [{ id: jobId }, { orderId: jobId }],
            },
            data: { status: "FAILED", lastError: errorMsg },
          });
          logger.warn({ jobId, error: errorMsg }, "print_job_failed_in_db");
          break;
        }

        case "PRINTER_STATUS": {
          const available = parsed.available === true;
          const printers = Array.isArray(parsed.printers) ? parsed.printers.filter((p): p is string => typeof p === "string") : [];
          logger.info({ available, printers }, "print_agent_printer_status");
          break;
        }

        case "DOWNLOADING":
        case "DOWNLOADED":
        case "MOVING":
        case "FILE_PRINTED": {
          const fileIndex = typeof parsed.fileIndex === "number" ? parsed.fileIndex : 0;
          logger.debug({ jobId, fileIndex, type }, "print_agent_file_progress");
          break;
        }
      }
    } catch (err) {
      logger.error({ err, msgType: type, jobId }, "print_job_db_update_failed");
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
    await this.syncPrinterConfig().catch((err) => {
      logger.error({ err }, "printer_config_sync_before_pending_failed");
    });

    const pending = await prisma.printJob.findMany({
      where: { status: { in: ["PENDING", "SENT", "RECEIVED"] } },
      orderBy: { createdAt: "asc" },
    });

    if (pending.length === 0) return;
    logger.info({ count: pending.length }, "print_sync_pending_jobs");

    for (const job of pending) {
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
      } catch (err) {
        logger.error({ err, jobId: job.id }, "print_sync_pending_job_error");
      }
    }
  }
}

export const printAgentWSManager = new PrintAgentWSManager();
