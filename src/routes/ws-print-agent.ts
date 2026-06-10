import { IncomingMessage } from "http";
import { URL } from "url";
import crypto from "crypto";
import { EventEmitter } from "events";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import logger from "../utils/logger";
import { printAgentWSManager } from "../services/printAgentWSManager";
import type { PrintJobFile, PrintJobPayload } from "../types/printJob";

export type FileJobStatus = "pending" | "downloading" | "downloaded" | "generating_pdf" | "pdf_generated" | "moving" | "printed" | "failed";

export interface AgentPrinterInfo {
  available: boolean;
  printers: string[];
  selectedPrinter?: string;
}

interface AgentEnvelope {
  type: string;
  jobId?: string;
  fileIndex?: number;
  fileStatus?: FileJobStatus;
  job?: PrintJobPayload & { jobId?: string };
  available?: boolean;
  printers?: string[];
  selectedPrinter?: string;
  error?: string;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface HistoryEntry {
  type: "CONNECTED" | "DISCONNECTED" | "SENT" | "RECEIVED" | "ERROR";
  message: string | AgentEnvelope | Record<string, unknown>;
  timestamp: Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export interface DeviceHandshake {
  deviceId: string;
  deviceName: string;
  ip: string;
}

export interface DevicePrinterInfo {
  name: string;
  status: number; // 0=Idle, 1=Paused, 2=Error, 3=PendingDeletion, 8=PowerSave
  role?: 'photo' | 'letter' | null; // Role assignment for this printer on this device
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  ip: string;
  printers: DevicePrinterInfo[];
  connectedAt: string;
  lastSeenAt: string;
  isDefault: boolean;
  isActive: boolean;
}

interface DeviceConnection extends DeviceInfo {
  socket: WebSocket;
}

const parseAgentEnvelope = (raw: Buffer): AgentEnvelope | null => {
  const parsed: unknown = JSON.parse(raw.toString());
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  const envelope: AgentEnvelope = { type: parsed.type };
  if (typeof parsed.jobId === "string") envelope.jobId = parsed.jobId;
  if (typeof parsed.fileIndex === "number") envelope.fileIndex = parsed.fileIndex;
  if (typeof parsed.fileStatus === "string") envelope.fileStatus = parsed.fileStatus as FileJobStatus;
  if (typeof parsed.error === "string") envelope.error = parsed.error;
  if (typeof parsed.available === "boolean") envelope.available = parsed.available;
  if (typeof parsed.selectedPrinter === "string") envelope.selectedPrinter = parsed.selectedPrinter;
  if (Array.isArray(parsed.printers)) {
    envelope.printers = parsed.printers.filter(
      (printer): printer is string => typeof printer === "string",
    );
  }
  if (isRecord(parsed.job)) {
    const files = Array.isArray(parsed.job.files) ? parsed.job.files : [];
    envelope.job = {
      jobId: typeof parsed.job.jobId === "string" ? parsed.job.jobId : "",
      orderId: typeof parsed.job.orderId === "string" ? parsed.job.orderId : "",
      customerName:
        typeof parsed.job.customerName === "string" ? parsed.job.customerName : "",
      driveFolderId:
        typeof parsed.job.driveFolderId === "string" ? parsed.job.driveFolderId : "",
      files: files
        .filter(isRecord)
        .map((f): PrintJobFile => {
          const sc = f.sizeConfig
          return {
            name: typeof f.name === "string" ? f.name : "",
            driveFileId:
              typeof f.driveFileId === "string" ? f.driveFileId : "",
            subfolderName:
              typeof f.subfolderName === "string" ? f.subfolderName : "",
            type: (f.type === "carta" || f.type === "foto" || f.type === "outro")
              ? f.type
              : "foto",
            sizeConfig: {
              widthMm: isRecord(sc) && typeof sc.widthMm === "number" ? sc.widthMm : 100,
              heightMm: isRecord(sc) && typeof sc.heightMm === "number" ? sc.heightMm : 150,
              label: isRecord(sc) && typeof sc.label === "string" ? sc.label : "A6 / 10x15cm",
            },
            printerRole: (f.printerRole === "photo" || f.printerRole === "letter")
              ? f.printerRole
              : "photo",
          };
        })
        .filter((f) => f.name && f.driveFileId),
    };
  }

  return envelope;
};

export class PrintAgentHub {
  private devices = new Map<string, DeviceConnection>();
  private history: HistoryEntry[] = [];
  private readonly maxHistorySize = 50;
  private ackWaiters = new Map<string, Waiter>();
  private printedWaiters = new Map<string, Waiter>();
  private _printers: AgentPrinterInfo = { available: false, printers: [] };
  private events = new EventEmitter();

  // --- Multi-device management ---

  connectDevice(socket: WebSocket, handshake: DeviceHandshake): void {
    const existing = this.devices.get(handshake.deviceId);
    if (existing) {
      existing.socket = socket;
      existing.isActive = true;
      existing.lastSeenAt = new Date().toISOString();
      existing.ip = handshake.ip || existing.ip;
      existing.deviceName = handshake.deviceName || existing.deviceName;
    } else {
      const isFirst = this.devices.size === 0 || ![...this.devices.values()].some((d) => d.isDefault);
      this.devices.set(handshake.deviceId, {
        deviceId: handshake.deviceId,
        deviceName: handshake.deviceName,
        ip: handshake.ip || "",
        socket,
        connectedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        isDefault: isFirst,
        isActive: true,
        printers: [],
      });
    }
    this.events.emit("device:update", this.getDeviceInfo(handshake.deviceId));
    this.requestPrinterCheckForDevice(handshake.deviceId);

    // Persist to DB (skip legacy devices)
    if (!handshake.deviceId.startsWith("legacy-")) {
      const now = new Date();
      prisma.printDevice.upsert({
        where: { deviceId: handshake.deviceId },
        create: { deviceId: handshake.deviceId, deviceName: handshake.deviceName, ip: handshake.ip || "", connectedAt: now, lastSeenAt: now },
        update: { deviceName: handshake.deviceName, ip: handshake.ip || "", lastSeenAt: now },
      }).catch((err) => logger.error({ err }, "persist_device_failed"));
    }
  }

  disconnectDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.isActive = false;
      device.lastSeenAt = new Date().toISOString();
      this.events.emit("device:update", this.getDeviceInfo(deviceId));
    }
  }

  disconnectBySocket(socket: WebSocket): void {
    for (const [deviceId, device] of this.devices) {
      if (device.socket === socket) {
        this.disconnectDevice(deviceId);
        return;
      }
    }
  }

  getDeviceIdBySocket(socket: WebSocket): string | undefined {
    for (const [deviceId, device] of this.devices) {
      if (device.socket === socket) return deviceId;
    }
    return undefined;
  }

  getDeviceInfo(deviceId: string): DeviceInfo | undefined {
    const d = this.devices.get(deviceId);
    if (!d) return undefined;
    return {
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      ip: d.ip,
      printers: d.printers,
      connectedAt: d.connectedAt,
      lastSeenAt: d.lastSeenAt,
      isDefault: d.isDefault,
      isActive: d.isActive,
    };
  }

  getAllDevices(): DeviceInfo[] {
    return [...this.devices.values()].map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      ip: d.ip,
      printers: d.printers,
      connectedAt: d.connectedAt,
      lastSeenAt: d.lastSeenAt,
      isDefault: d.isDefault,
      isActive: d.isActive,
    }));
  }

  setDefault(deviceId: string): boolean {
    if (!this.devices.has(deviceId)) return false;
    for (const [id, device] of this.devices) {
      device.isDefault = id === deviceId;
    }
    this.events.emit("device:update", this.getDeviceInfo(deviceId));
    return true;
  }

  removeDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    if (device.isActive && device.socket?.readyState === WebSocket.OPEN) {
      device.socket.close();
    }
    this.devices.delete(deviceId);
    return true;
  }

  updateDevicePrinters(deviceId: string, printers: DevicePrinterInfo[]): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.printers = printers;
    device.lastSeenAt = new Date().toISOString();
    this.events.emit("device:update", this.getDeviceInfo(deviceId));
  }

  // --- Backward compatibility (legacy single-device API) ---

  /** @deprecated Use connectDevice instead */
  setAgentSocket(socket: WebSocket | null): void {
    if (socket) {
      this.connectDevice(socket, { deviceId: `legacy-${crypto.randomUUID()}`, deviceName: "Dispositivo legado", ip: "" });
    }
  }

  getCurrentSocket(): WebSocket | null {
    const target = this.getDefaultActiveDevice();
    return target?.socket ?? null;
  }

  isConnected(): boolean {
    return this.getDefaultActiveDevice() !== undefined;
  }

  getStatus(): {
    isConnected: boolean;
    connectedAt: Date | null;
    totalMessages: number;
    printers: AgentPrinterInfo;
  } {
    const target = this.getDefaultActiveDevice();
    return {
      isConnected: !!target,
      connectedAt: target ? new Date(target.connectedAt) : null,
      totalMessages: this.history.length,
      printers: this._printers,
    };
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  get printers(): AgentPrinterInfo {
    return this._printers;
  }

  onPrintersUpdated(listener: (info: AgentPrinterInfo) => void): () => void {
    this.events.on("printers-updated", listener);
    return () => { this.events.off("printers-updated", listener); };
  }

  on(event: string, listener: (...args: any[]) => void): () => void {
    this.events.on(event, listener);
    return () => { this.events.off(event, listener); };
  }

  sendRaw(message: Record<string, unknown>, deviceId?: string): { success: boolean; message?: string; error?: string } {
    const target = deviceId ? this.devices.get(deviceId) : this.getDefaultActiveDevice();
    if (!target || !target.isActive || target.socket?.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Agente não conectado" };
    }
    try {
      target.socket.send(JSON.stringify(message));
      this.addToHistory({ type: "SENT", message, timestamp: new Date() });
      return { success: true, message: "Evento disparado com sucesso" };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error(`[PrintAgent] Erro ao enviar mensagem: ${messageText}`);
      return { success: false, error: messageText };
    }
  }

  requestPrinterCheck(): void {
    this.sendRaw({ type: "CHECK_PRINTER" });
  }

  private requestPrinterCheckForDevice(deviceId: string): void {
    this.sendRaw({ type: "CHECK_PRINTER" }, deviceId);
  }

  requestPrinterList(): Promise<string[]> {
    if (!this.isConnected()) return Promise.resolve([]);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.events.off("printers-updated", onUpdate);
        resolve([]);
      }, 10_000);
      const onUpdate = (info: AgentPrinterInfo) => {
        clearTimeout(timeout);
        this.events.off("printers-updated", onUpdate);
        resolve(info.printers);
      };
      this.events.on("printers-updated", onUpdate);
      this.sendRaw({ type: "CHECK_PRINTER" });
    });
  }

  authorizePrinter(printerName: string): { success: boolean; error?: string } {
    if (!this.isConnected()) {
      return { success: false, error: "Agente não conectado" };
    }
    const result = this.sendRaw({ type: "AUTHORIZE_PRINTER", selectedPrinter: printerName });
    if (result.success) {
      this._printers = { ...this._printers, selectedPrinter: printerName };
      this.events.emit("printers-updated", this._printers);
    }
    return result;
  }

  dispatchPrintJob(
    jobId: string,
    payload: PrintJobPayload,
    ackTimeoutMs: number,
    printedTimeoutMs: number,
  ): { ack: Promise<void>; printed: Promise<void> } {
    const ack = this.createWaiter(this.ackWaiters, jobId, "ACK", ackTimeoutMs);
    const printed = this.createWaiter(this.printedWaiters, jobId, "PRINTED", printedTimeoutMs);

    const result = this.sendRaw({ type: "PRINT_JOB", jobId, job: { ...payload, jobId } });
    if (!result.success) {
      this.rejectWaiter(this.ackWaiters, jobId, new Error(result.error));
      this.rejectWaiter(this.printedWaiters, jobId, new Error(result.error));
    }

    return { ack, printed };
  }

  handleAgentMessage(message: AgentEnvelope, deviceId?: string): void {
    this.addToHistory({ type: "RECEIVED", message, timestamp: new Date() });

    if (message.type === "PRINTER_STATUS") {
      this._printers = {
        available: message.available ?? false,
        printers: message.printers ?? [],
        selectedPrinter: this._printers.selectedPrinter,
      };
      this.events.emit("printers-updated", this._printers);

      if (deviceId) {
        const printerInfos: DevicePrinterInfo[] = (message.printers ?? []).map((name) => ({ name, status: 0 }));
        this.updateDevicePrinters(deviceId, printerInfos);
      }

      if (!this._printers.available && !this._printers.selectedPrinter) {
        logger.info("[PrintAgent] Nenhuma impressora disponivel, autorizando pdf_fallback");
        this.authorizePrinter("pdf_fallback");
      }
      return;
    }

    if (message.type === "PRINTER_STATUS_UPDATE" && deviceId) {
      const printerInfos: DevicePrinterInfo[] = Array.isArray((message as any).printers)
        ? (message as any).printers.map((p: any) => ({ name: p.Name || p.name, status: p.PrinterStatus ?? p.status ?? 0 }))
        : [];
      this.updateDevicePrinters(deviceId, printerInfos);
      return;
    }

    if (message.type === "SYNC_PRINTER_CONFIG") {
      logger.info("[PrintAgent] App solicitou sincronização de config de impressoras");
      printAgentWSManager.syncPrinterConfig().catch((err) => {
        logger.error({ err }, "sync_printer_config_from_app_failed");
      });
      return;
    }

    const jobId = message.jobId ?? message.job?.jobId;

    if (message.type === "ACK" && jobId) {
      logger.info(`[PrintAgent] ACK recebido para job ${jobId}`);
      this.resolveWaiter(this.ackWaiters, jobId);
      return;
    }

    if (message.type === "DOWNLOADING" && jobId) {
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "downloading" });
      return;
    }

    if (message.type === "DOWNLOADED" && jobId) {
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "downloaded" });
      return;
    }

    if (message.type === "GENERATING_PDF" && jobId) {
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "generating_pdf" });
      return;
    }

    if (message.type === "PDF_GENERATED" && jobId) {
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "pdf_generated" });
      return;
    }

    if (message.type === "PRINTING" && jobId) {
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "printing" });
      return;
    }

    if (message.type === "FILE_PRINTED" && jobId) {
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "printed" });
      return;
    }

    if (message.type === "PRINTED" && jobId) {
      logger.info(`[PrintAgent] PRINTED recebido para job ${jobId}`);
      this.resolveWaiter(this.printedWaiters, jobId);
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "printed" });
      return;
    }

    if (message.type === "COMPLETED" && jobId) {
      logger.info(`[PrintAgent] COMPLETED recebido para job ${jobId}`);
      this.resolveWaiter(this.printedWaiters, jobId);
      this.events.emit("job-completed", { jobId, status: "printed", message: message.error || "Job concluido" });
      return;
    }

    if (message.type === "FAILED" && jobId) {
      logger.warn(`[PrintAgent] FAILED recebido para job ${jobId}: ${message.error}`);
      const error = new Error(message.error || "Agente reportou falha de impressão");
      this.rejectWaiter(this.ackWaiters, jobId, error);
      this.rejectWaiter(this.printedWaiters, jobId, error);
      this.events.emit("file-status", { jobId, fileIndex: message.fileIndex, status: "failed", error: message.error });
    }
  }

  // --- Private helpers ---

  getDefaultActiveDevice(): DeviceConnection | undefined {
    return (
      [...this.devices.values()].find((d) => d.isDefault && d.isActive && d.socket?.readyState === WebSocket.OPEN) ??
      [...this.devices.values()].find((d) => d.isActive && d.socket?.readyState === WebSocket.OPEN)
    );
  }

  private addToHistory(entry: HistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  private createWaiter(
    registry: Map<string, Waiter>,
    jobId: string,
    label: string,
    timeoutMs: number,
  ): Promise<void> {
    this.rejectWaiter(registry, jobId, new Error(`${label} anterior substituido`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        registry.delete(jobId);
        reject(new Error(`Timeout aguardando ${label} do agente para job ${jobId}`));
      }, timeoutMs);
      registry.set(jobId, { resolve, reject, timer });
    });
  }

  private resolveWaiter(registry: Map<string, Waiter>, jobId: string): void {
    const waiter = registry.get(jobId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    registry.delete(jobId);
    waiter.resolve();
  }

  private rejectWaiter(registry: Map<string, Waiter>, jobId: string, error: Error): void {
    const waiter = registry.get(jobId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    registry.delete(jobId);
    waiter.reject(error);
  }
}

export const printAgentHub = new PrintAgentHub();

const getProvidedAgentKey = (req: IncomingMessage): string => {
  const headerKey = req.headers["x-agent-key"] ?? req.headers["x-api-key"];
  if (Array.isArray(headerKey)) return headerKey[0] ?? "";
  if (headerKey) return headerKey;

  const url = new URL(req.url || "/ws/print-agent", "http://localhost");
  return url.searchParams.get("agentKey") || "";
};

const isAgentAuthorized = (req: IncomingMessage): boolean => {
  const expectedKey = process.env.PRINT_AGENT_KEY || process.env.AGENT_KEY;
  if (!expectedKey) return true;
  return getProvidedAgentKey(req) === expectedKey;
};

export function setupPrintAgentWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: "/ws/print-agent",
    perMessageDeflate: false,
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!isAgentAuthorized(req)) {
      logger.warn("[PrintAgent] Conexao recusada: agent key invalida");
      ws.close(1008, "unauthorized");
      return;
    }

    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";
    logger.info(`[PrintAgent] Agente conectado: ${clientIp}`);

    let deviceId: string | undefined;
    let handshakeReceived = false;

    // syncPrinterConfig will be called after HANDSHAKE with deviceId
    printAgentWSManager.syncPendingJobs().catch((err) => {
      logger.error({ err }, "sync_pending_jobs_failed");
    });

    let isAlive = true;
    const heartbeatInterval = setInterval(() => {
      if (!isAlive) { ws.terminate(); return; }
      isAlive = false;
      ws.ping();
    }, 30000);

    ws.on("pong", () => { isAlive = true; });

    ws.on("message", (raw: Buffer) => {
      try {
        const parsed = JSON.parse(raw.toString());

        // Handle HANDSHAKE as first message
        if (!handshakeReceived && parsed?.type === "HANDSHAKE") {
          handshakeReceived = true;
          deviceId = parsed.deviceId || `legacy-${clientIp}`;
          printAgentHub.connectDevice(ws, {
            deviceId: deviceId!,
            deviceName: parsed.deviceName || "Dispositivo",
            ip: parsed.ip || clientIp,
          });
          ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", ok: true }));
          logger.info(`[PrintAgent] Handshake concluido: ${deviceId} (${parsed.deviceName})`);

          // Sync printer config for this device
          printAgentWSManager.syncPrinterConfig(deviceId).catch((err) => {
            logger.error({ err, deviceId }, "printer_config_sync_on_connect_failed");
          });
          return;
        }

        // Legacy device: first non-HANDSHAKE message
        if (!handshakeReceived) {
          handshakeReceived = true;
          // Use fixed legacy ID based on IP so reconnections reuse the same slot
          deviceId = `legacy-${clientIp.replace(/[^a-zA-Z0-9]/g, "-")}`;
          printAgentHub.connectDevice(ws, { deviceId, deviceName: "Dispositivo legado", ip: clientIp });
          logger.info(`[PrintAgent] Device legado registrado: ${deviceId}`);

          // Sync printer config for legacy device
          printAgentWSManager.syncPrinterConfig(deviceId).catch((err) => {
            logger.error({ err, deviceId }, "printer_config_sync_legacy_failed");
          });
        }

        const message = parseAgentEnvelope(raw);
        if (!message) {
          logger.warn("[PrintAgent] Mensagem ignorada: payload invalido");
          return;
        }
        printAgentHub.handleAgentMessage(message, deviceId);
        printAgentWSManager.handleInbound(raw.toString()).catch((err) => {
          logger.error({ err }, "print_agent_db_update_failed");
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.error(`[PrintAgent] Erro ao processar mensagem: ${messageText}`);
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeatInterval);
      if (deviceId) {
        printAgentHub.disconnectDevice(deviceId);
        logger.info(`[PrintAgent] Agente desconectado: ${deviceId}`);
      } else {
        printAgentHub.disconnectBySocket(ws);
        logger.info("[PrintAgent] Agente desconectado (sem deviceId)");
      }
    });

    ws.on("error", (error: Error) => {
      logger.error(`[PrintAgent] Erro no WebSocket: ${error.message}`);
    });
  });

  logger.info("[PrintAgent] WebSocket ativo em /ws/print-agent");
  return wss;
}

import { Router, Request, Response } from "express";
import prisma from "../database/prisma";

export function createPrintDeviceRoutes(router: Router): void {
  // GET /api/print-agent/devices — list all devices
  router.get("/print-agent/devices", async (_req: Request, res: Response) => {
    try {
      const dbDevices = await prisma.printDevice.findMany({ orderBy: { lastSeenAt: "desc" } });
      const liveDevices = printAgentHub.getAllDevices();
      const merged = dbDevices.map((db) => {
        const live = liveDevices.find((d) => d.deviceId === db.deviceId);
        return {
          deviceId: db.deviceId,
          deviceName: live?.deviceName ?? db.deviceName,
          ip: live?.ip ?? db.ip,
          printers: live?.printers ?? db.printers,
          connectedAt: live?.connectedAt ?? db.connectedAt.toISOString(),
          lastSeenAt: live?.lastSeenAt ?? db.lastSeenAt.toISOString(),
          isDefault: live?.isDefault ?? db.isDefault,
          isActive: live?.isActive ?? false,
        };
      });
      // Add live devices not yet persisted
      for (const live of liveDevices) {
        if (!merged.some((m) => m.deviceId === live.deviceId)) {
          merged.push(live);
        }
      }
      res.json(merged);
    } catch (error) {
      logger.error({ error }, "get_devices_failed");
      res.status(500).json({ error: "Falha ao listar dispositivos" });
    }
  });

  // PUT/PATCH /print-agent/devices/:id/default — set device as default
  const setDefaultHandler = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await prisma.$transaction([
        prisma.printDevice.updateMany({ data: { isDefault: false } }),
        prisma.printDevice.upsert({
          where: { deviceId: id },
          create: { deviceId: id, deviceName: "Dispositivo", isDefault: true, connectedAt: new Date(), lastSeenAt: new Date() },
          update: { isDefault: true },
        }),
      ]);
      printAgentHub.setDefault(id);
      res.status(204).end();
    } catch (error) {
      logger.error({ error }, "set_default_device_failed");
      res.status(500).json({ error: "Falha ao definir dispositivo padrão" });
    }
  };
  router.patch("/print-agent/devices/:id/default", setDefaultHandler);
  router.put("/print-agent/devices/:id/default", setDefaultHandler);

  // PATCH /print-agent/devices/:id — update device name
  router.patch("/print-agent/devices/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deviceName } = req.body;
    try {
      const updated = await prisma.printDevice.update({
        where: { deviceId: id },
        data: { ...(deviceName ? { deviceName } : {}) },
      });
      res.json(updated);
    } catch (error) {
      logger.error({ error }, "update_device_failed");
      res.status(500).json({ error: "Falha ao atualizar dispositivo" });
    }
  });

  // DELETE /api/print-agent/devices/:id — remove device
  router.delete("/print-agent/devices/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      printAgentHub.removeDevice(id);
      await prisma.printDevice.delete({ where: { deviceId: id } }).catch(() => {});
      res.status(204).end();
    } catch (error) {
      logger.error({ error }, "delete_device_failed");
      res.status(500).json({ error: "Falha ao remover dispositivo" });
    }
  });

  // GET /api/print-agent/devices/stream — SSE for real-time device updates
  router.get("/print-agent/devices/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const off = printAgentHub.on("device:update", send);
    req.on("close", off);
  });
}
