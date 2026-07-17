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
    // Skip noisy ghost messages from unknown clients
    if ((msg as any).type !== "PRINTER_STATUS_UPDATE") {
      logger.info({ type: msg.type, jobId }, "ws_inbound_received");
    }

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
      
      const deviceInfo = deviceId ? printAgentHub.getDeviceInfo(deviceId) : null

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

      // Extract print settings
      const printSettings = (device?.printSettings as any) || {}
      const photoSettings = printSettings.photo || undefined
      const letterSettings = printSettings.letter || undefined

      // Send to specific device if provided, otherwise broadcast to default
      const targetDeviceId = deviceId ?? device?.deviceId
      this.sendToDevice(targetDeviceId, {
        type: "PRINTER_CONFIG_UPDATE",
        config: { photo, letter, photoSettings, letterSettings },
        isDefault: device?.isDefault ?? deviceInfo?.isDefault ?? false,
        timestamp: new Date().toISOString(),
      })

      logger.info(
        {
          photo,
          letter,
          photoSettings,
          letterSettings,
          isDefault: device?.isDefault ?? deviceInfo?.isDefault ?? false,
          deviceId: targetDeviceId,
        },
        "printer_config_synced_on_connect",
      )
    } catch (err) {
      logger.error({ err }, "printer_config_sync_failed")
    }
  }


  async syncPendingJobs(): Promise<void> {
    // Recovery windows:
    //  - PENDING: 48h (old, manual review)
    //  - SENT: 5min, no ACK → never reached app → FAILED
    //  - RECEIVED/PRINTING: 10min, no terminal status → app crashed/errored → FAILED
    const pendingCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const sentCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const printingCutoff = new Date(Date.now() - 10 * 60 * 1000);

    const jobs = await prisma.printJob.findMany({
      where: {
        OR: [
          { status: "PENDING", createdAt: { gte: pendingCutoff } },
          { status: "SENT", sentAt: { lte: sentCutoff } },
          { status: { in: ["RECEIVED", "PRINTING"] }, updatedAt: { lte: printingCutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    // Also check raw SQL print_jobs table
    let rawJobs: any[] = [];
    try {
      rawJobs = await prisma.$queryRawUnsafe(
        `SELECT id, order_id, customer_name, drive_folder_id, payload, status, created_at
         FROM print_jobs
         WHERE (status = 'pending' AND created_at >= $1)
            OR (status = 'sent' AND updated_at <= $2)
            OR (status IN ('received', 'printing') AND updated_at <= $3)
         ORDER BY created_at ASC
         LIMIT 50`,
        pendingCutoff,
        sentCutoff,
        printingCutoff,
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

    // SENT/RECEIVED/PRINTING jobs stuck (no terminal status) → FAILED.
    // PENDING jobs stuck >48h → PENDING_REVIEW for manual dispatch from manager.
    for (const job of allJobs) {
      const rawStatus = String((job as any).status ?? "").toUpperCase();
      const isPending = rawStatus === "PENDING";
      try {
        const targetStatus = isPending ? "PENDING_REVIEW" : "FAILED";
        const failedErr = rawStatus === "SENT"
          ? "Job enviado não recebeu ACK do app (timeout)"
          : "Job travado em impressão sem status final (app crashou/erro)";
        await prisma.printJob.update({
          where: { id: job.id },
          data: isPending
            ? { status: "PENDING_REVIEW" }
            : { status: "FAILED", lastError: failedErr },
        }).catch(() => {
          prisma.$executeRawUnsafe(
            `UPDATE print_jobs SET status = $2, updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'sent', 'received', 'printing')`,
            job.id,
            isPending ? "pending_review" : "failed",
          ).catch((err) => logger.error({ err, jobId: job.id }, "sync_job_review_update_raw_failed"));
        });
        logger.info({ jobId: job.id, orderId: (job as any).orderId, status: targetStatus }, "job_marked_stuck");
      } catch (err) {
        logger.error({ err, jobId: job.id }, "print_sync_review_mark_error");
      }
    }

    // Notify admin about pending jobs needing review
    try {
      const { adminNotificationService } = await import("./adminNotificationService");
      await adminNotificationService.notifyPendingPrintJobs(allJobs.length);
    } catch (err) {
      logger.error({ err }, "notify_pending_print_jobs_failed");
    }
  }

  /** Dispatch a single job that was in PENDING_REVIEW */
  async dispatchReviewJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    const job = await prisma.printJob.findUnique({ where: { id: jobId } });
    if (!job) return { success: false, error: "Job não encontrado" };
    if (job.status !== "PENDING_REVIEW") return { success: false, error: `Job está com status ${job.status}` };

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

    if (!sent) return { success: false, error: "Agente não conectado" };

    await prisma.printJob.update({
      where: { id: jobId },
      data: { status: "SENT", sentAt: new Date() },
    });

    logger.info({ jobId }, "review_job_dispatched");
    return { success: true };
  }

  /** Reject/cancel a single job */
  async rejectReviewJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    const job = await prisma.printJob.findUnique({ where: { id: jobId } });
    if (!job) return { success: false, error: "Job não encontrado" };
    if (job.status !== "PENDING_REVIEW") return { success: false, error: `Job está com status ${job.status}` };

    await prisma.printJob.update({
      where: { id: jobId },
      data: { status: "FAILED", lastError: "Rejeitado pelo operador" },
    });

    logger.info({ jobId }, "review_job_rejected");
    return { success: true };
  }
}

export const printAgentWSManager = new PrintAgentWSManager();
