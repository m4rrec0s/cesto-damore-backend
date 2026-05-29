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

    switch (type) {
      case "ACK": {
        await prisma.printJob.updateMany({
          where: { id: jobId, status: "SENT" },
          data: { status: "RECEIVED", ackedAt: new Date() },
        });
        logger.info({ jobId }, "print_job_acked");
        break;
      }

      case "PRINTED": {
        await prisma.printJob.updateMany({
          where: { id: jobId, status: "RECEIVED" },
          data: { status: "PRINTED", printedAt: new Date() },
        });
        logger.info({ jobId }, "print_job_printed");
        break;
      }

      case "COMPLETED": {
        await prisma.printJob.updateMany({
          where: { id: jobId },
          data: { status: "PRINTED", printedAt: new Date() },
        });
        logger.info({ jobId }, "print_job_completed");
        break;
      }

      case "FAILED": {
        const errorMsg = typeof parsed.error === "string" ? parsed.error : "unknown";
        await prisma.printJob.updateMany({
          where: { id: jobId },
          data: { status: "FAILED", lastError: errorMsg },
        });
        logger.warn({ jobId, error: errorMsg }, "print_job_failed");
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
  }

  async syncPendingJobs(): Promise<void> {
    const pending = await prisma.printJob.findMany({
      where: { status: { in: ["PENDING", "SENT"] } },
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
