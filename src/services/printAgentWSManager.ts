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

  getDefaultActiveDevice() {
    return printAgentHub.getDefaultActiveDevice();
  }

  getDeviceName(): string | null {
    const device = printAgentHub.getDefaultActiveDevice();
    return device?.deviceName ?? null;
  }

  send(msg: WSOutboundMessage): boolean {
    return printAgentHub.sendRaw(msg as unknown as Record<string, unknown>).success;
  }

  /** Send message to a specific device. Falls back to default device if deviceId omitted. */
  sendToDevice(deviceId: string | undefined, msg: WSOutboundMessage): boolean {
    return printAgentHub.sendRaw(msg as unknown as Record<string, unknown>, deviceId).success;
  }

  async handleInbound(raw: string): Promise<void> {
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
        case "ACK": {
          const result = await prisma.printJob.updateMany({
            where: {
              ...whereClause,
              status: { in: ["PENDING", "SENT"] },
            },
            data: { status: "RECEIVED", ackedAt: new Date() },
          });
          if (result.count > 0) {
            logger.info({ jobId, updated: result.count }, "db_updated_RECEIVED");
          } else {
            logger.warn({ jobId, whereClause }, "db_update_RECEIVED_no_records");
          }
          break;
        }

        case "DOWNLOADING":
        case "DOWNLOADED":
        case "GENERATING_PDF":
        case "PDF_GENERATED":
        case "MOVING":
        case "SENDING_TO_PRINTER":
        case "FILE_PRINTED": {
          const result = await prisma.printJob.updateMany({
            where: {
              ...whereClause,
              status: { in: ["PENDING", "SENT", "RECEIVED"] },
            },
            data: { status: "PRINTING" },
          });
          if (result.count > 0) {
            logger.info({ jobId, type: msg.type, updated: result.count }, "db_updated_PRINTING");
          }
          break;
        }

        case "PRINTED":
        case "COMPLETED": {
          const result = await prisma.printJob.updateMany({
            where: {
              ...whereClause,
              status: { notIn: ["FAILED"] },
            },
            data: { status: "PRINTED", printedAt: new Date() },
          });
          if (result.count > 0) {
            logger.info({ jobId, updated: result.count }, "db_updated_PRINTED");
          } else {
            logger.warn({ jobId, whereClause }, "db_update_PRINTED_no_records");
          }
          break;
        }

        case "FAILED": {
          const result = await prisma.printJob.updateMany({
            where: whereClause,
            data: {
              status: "FAILED",
              lastError: (msg as any).error ?? "unknown error",
            },
          });
          if (result.count > 0) {
            logger.warn({ jobId, updated: result.count, error: (msg as any).error }, "db_updated_FAILED");
          } else {
            logger.error({ jobId, whereClause, error: (msg as any).error }, "db_update_FAILED_no_records");
          }
          break;
        }

        default:
          logger.info({ type: msg.type, jobId }, "ws_progress_event_ignored");
      }
    } catch (dbErr) {
      logger.error({ err: dbErr, type: msg.type, jobId, whereClause }, "db_update_exception");
    }
  }

  async syncPrinterConfig(deviceId?: string): Promise<void> {
    try {
      let device = null
      
      if (deviceId) {
        // Get config for specific device
        device = await prisma.printDevice.findUnique({ where: { deviceId } })
      } else {
        // Get config from default device
        device = await prisma.printDevice.findFirst({ where: { isDefault: true } })
      }
      
      // Extract role assignments from the device's printers array
      const printers = device?.printers as any
      let photo = null
      let letter = null
      
      if (Array.isArray(printers)) {
        const photoPrinter = printers.find((p: any) => p.role === 'photo')
        const letterPrinter = printers.find((p: any) => p.role === 'letter')
        photo = photoPrinter?.name ?? null
        letter = letterPrinter?.name ?? null
      }

      // Send to specific device if provided, otherwise broadcast to default
      const targetDeviceId = deviceId ?? device?.deviceId
      this.sendToDevice(targetDeviceId, {
        type: "PRINTER_CONFIG_UPDATE",
        config: { photo, letter },
        timestamp: new Date().toISOString(),
      })

      logger.info({ photo, letter, deviceId: targetDeviceId }, "printer_config_synced_on_connect")
    } catch (err) {
      logger.error({ err }, "printer_config_sync_failed")
    }
  }


  async syncPendingJobs(): Promise<void> {
    // Recovery window: 48h for PENDING, 5min+ for SENT (jobs in transit <5min may still be processing)
    const pendingCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const sentCutoff = new Date(Date.now() - 5 * 60 * 1000);

    const jobs = await prisma.printJob.findMany({
      where: {
        OR: [
          { status: "PENDING", createdAt: { gte: pendingCutoff } },
          { status: "SENT", sentAt: { lte: sentCutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    // Also check raw SQL print_jobs table (print-queue.service system)
    let rawJobs: any[] = [];
    try {
      rawJobs = await prisma.$queryRawUnsafe(
        `SELECT id, order_id, customer_name, drive_folder_id, payload, status, created_at
         FROM print_jobs
         WHERE (status = 'pending' AND created_at >= $1)
            OR (status = 'sent' AND updated_at <= $2)
         ORDER BY created_at ASC
         LIMIT 50`,
        pendingCutoff,
        sentCutoff,
      );
    } catch (err) {
      logger.error({ err }, "sync_pending_raw_jobs_query_failed");
    }

    // Merge and deduplicate by id
    const allJobs = [...jobs];
    for (const raw of rawJobs) {
      if (!allJobs.some((j) => j.id === raw.id)) {
        allJobs.push({
          id: raw.id,
          orderId: raw.order_id,
          customerName: raw.customer_name,
          driveFolderId: raw.drive_folder_id,
          filesJson: typeof raw.payload === "string" ? raw.payload : JSON.stringify(raw.payload),
          status: raw.status,
          createdAt: raw.created_at,
        } as any);
      }
    }

    logger.info({ prismaCount: jobs.length, rawCount: rawJobs.length, total: allJobs.length }, "print_sync_pending_jobs");

    if (allJobs.length === 0) return;

    // Sync config to default device
    await this.syncPrinterConfig();

    for (const job of allJobs) {
      try {
        const payload: PrintJobPayload = {
          jobId: job.id,
          orderId: (job as any).orderId ?? job.id,
          customerName: (job as any).customerName ?? "",
          driveFolderId: (job as any).driveFolderId ?? "",
          files: JSON.parse((job as any).filesJson ?? "[]") as PrintJobPayload["files"],
        };

        const sent = this.send({
          type: "PRINT_JOB",
          jobId: payload.jobId,
          job: payload,
          timestamp: new Date().toISOString(),
        });

        if (sent) {
          // Update status in PrintJob table (Prisma) — may fail for raw SQL jobs, that's OK
          await prisma.printJob.update({
            where: { id: job.id },
            data: { status: "SENT", sentAt: new Date() },
          }).catch(() => {
            // Job may be in print_jobs table (raw SQL) — update that instead
            prisma.$executeRawUnsafe(
              `UPDATE print_jobs SET status = 'sent', updated_at = NOW() WHERE id = $1`,
              job.id,
            ).catch((err) => logger.error({ err, jobId: job.id }, "sync_job_update_raw_failed"));
          });
          logger.info({ jobId: job.id }, "job_marked_as_sent");
        } else {
          logger.warn({ jobId: job.id }, "failed_to_send_print_job_to_agent");
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        logger.error({ err, jobId: job.id }, "print_sync_pending_job_error");
      }
    }
  }
}

export const printAgentWSManager = new PrintAgentWSManager();
