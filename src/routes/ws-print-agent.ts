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
  printerDetails?: { Name: string; PrinterStatus: number }[];
  selectedPrinter?: string;
  isDefault?: boolean;
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
  isClosing?: boolean; // true while replacing old socket — suppress disconnect event
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
  if (typeof parsed.isDefault === "boolean") envelope.isDefault = parsed.isDefault;
  if (Array.isArray(parsed.printers)) {
    envelope.printers = parsed.printers.filter(
      (printer): printer is string => typeof printer === "string",
    );
  }
  if (Array.isArray(parsed.printerDetails)) {
    envelope.printerDetails = parsed.printerDetails
      .filter(isRecord)
      .map((p) => ({
        Name: typeof p.Name === "string" ? p.Name : typeof p.name === "string" ? p.name : "",
        PrinterStatus: typeof p.PrinterStatus === "number" ? p.PrinterStatus : typeof p.status === "number" ? p.status : 0,
      }));
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
  /** Per-device printer status — keyed by deviceId */
  private _printersByDevice = new Map<string, AgentPrinterInfo>();
  /** Paper sizes response waiters — keyed by printerName */
  private _paperSizesWaiters = new Map<string, { resolve: (data: any[]) => void; timer: NodeJS.Timeout }>();
  private events = new EventEmitter();

  // --- Multi-device management ---

  connectDevice(socket: WebSocket, handshake: DeviceHandshake): void {
    const existing = this.devices.get(handshake.deviceId);
    if (existing) {
      // Clean up old socket before replacing — prevents ghost disconnects and stale message processing
      const oldSocket = existing.socket;
      if (oldSocket && oldSocket !== socket) {
        existing.isClosing = true;
        try {
          oldSocket.removeAllListeners();
          oldSocket.close(1000, "replaced");
        } catch { /* socket may already be dead */ }
        existing.isClosing = false;
      }
      existing.socket = socket;
      existing.isActive = true;
      existing.lastSeenAt = new Date().toISOString();
      existing.ip = handshake.ip || existing.ip;
      existing.deviceName = handshake.deviceName || existing.deviceName;
    } else {
      this.devices.set(handshake.deviceId, {
        deviceId: handshake.deviceId,
        deviceName: handshake.deviceName,
        ip: handshake.ip || "",
        socket,
        connectedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        isDefault: false, // Will be corrected from DB below
        isActive: true,
        printers: [],
      });
    }
    this.events.emit("device:update", this.getDeviceInfo(handshake.deviceId));
    this.requestPrinterCheckForDevice(handshake.deviceId);

    // Persist to DB and sync isDefault from DB (skip legacy devices)
    if (!handshake.deviceId.startsWith("legacy-")) {
      const now = new Date();
      prisma.printDevice.findUnique({ where: { deviceId: handshake.deviceId } })
        .then((existingDb) => {
          return prisma.printDevice.upsert({
            where: { deviceId: handshake.deviceId },
            create: { deviceId: handshake.deviceId, deviceName: handshake.deviceName, ip: handshake.ip || "", connectedAt: now, lastSeenAt: now },
            update: {
              deviceName: handshake.deviceName,
              ip: handshake.ip || "",
              lastSeenAt: now,
              ...(existingDb ? { isDefault: existingDb.isDefault } : {}),
            },
          });
        })
        .then((persisted) => {
          // Sync in-memory isDefault with DB state
          const device = this.devices.get(handshake.deviceId);
          if (device) {
            const shouldBeDefault = persisted.isDefault;
            if (shouldBeDefault && !device.isDefault) {
              // This device is the DB default — clear others
              for (const [, d] of this.devices) {
                if (d.deviceId !== handshake.deviceId) d.isDefault = false;
              }
              device.isDefault = true;
            } else if (!shouldBeDefault) {
              device.isDefault = false;
            }
            this.events.emit("device:update", this.getDeviceInfo(handshake.deviceId));
            this.notifyDeviceRole(handshake.deviceId);
          }
        })
        .catch((err) => logger.error({ err }, "persist_device_failed"));
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

  /** Internal use: get raw DeviceConnection (includes socket + isClosing) */
  getDeviceById(deviceId: string): DeviceConnection | undefined {
    return this.devices.get(deviceId);
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
    // Enforce single default: clear all, set target
    for (const [, device] of this.devices) {
      device.isDefault = device.deviceId === deviceId;
    }
    this.events.emit("device:update", this.getDeviceInfo(deviceId));
    this.notifyAllDeviceRoles();

    // Persist to DB — works even if device is offline (not in memory)
    prisma.$transaction([
      prisma.printDevice.updateMany({ data: { isDefault: false } }),
      prisma.printDevice.upsert({
        where: { deviceId },
        create: { deviceId, deviceName: "Dispositivo", isDefault: true, connectedAt: new Date(), lastSeenAt: new Date() },
        update: { isDefault: true },
      }),
    ]).catch((err) => logger.error({ err, deviceId }, "set_default_persist_failed"));

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
    return [...this.devices.values()].some((d) => d.isActive && d.socket?.readyState === WebSocket.OPEN);
  }

  getStatus(): {
    isConnected: boolean;
    connectedAt: Date | null;
    totalMessages: number;
    printers: AgentPrinterInfo;
  } {
    const target = this.getDefaultActiveDevice();
    const printers = target ? (this._printersByDevice.get(target.deviceId) ?? { available: false, printers: [] }) : { available: false, printers: [] };
    return {
      isConnected: !!target,
      connectedAt: target ? new Date(target.connectedAt) : null,
      totalMessages: this.history.length,
      printers,
    };
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  /** @deprecated Use getPrintersForDevice(deviceId) instead */
  get printers(): AgentPrinterInfo {
    const target = this.getDefaultActiveDevice();
    return target ? (this._printersByDevice.get(target.deviceId) ?? { available: false, printers: [] }) : { available: false, printers: [] };
  }

  getPrintersForDevice(deviceId: string): AgentPrinterInfo {
    return this._printersByDevice.get(deviceId) ?? { available: false, printers: [] };
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

  requestPrinterList(deviceId?: string): Promise<string[]> {
    const targetDeviceId = deviceId ?? this.getDefaultActiveDevice()?.deviceId;
    if (!targetDeviceId) return Promise.resolve([]);
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
      this.sendRaw({ type: "CHECK_PRINTER" }, targetDeviceId);
    });
  }

  authorizePrinter(printerName: string, deviceId?: string): { success: boolean; error?: string } {
    const targetDeviceId = deviceId ?? this.getDefaultActiveDevice()?.deviceId;
    if (!targetDeviceId) {
      return { success: false, error: "Agente não conectado" };
    }
    const result = this.sendRaw({ type: "AUTHORIZE_PRINTER", selectedPrinter: printerName }, targetDeviceId);
    if (result.success) {
      const existing = this._printersByDevice.get(targetDeviceId) ?? { available: false, printers: [] };
      this._printersByDevice.set(targetDeviceId, { ...existing, selectedPrinter: printerName });
      this.events.emit("printers-updated", this._printersByDevice.get(targetDeviceId));
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

  requestPaperSizes(printerName: string, deviceId?: string): Promise<any[]> {
    const targetDeviceId = deviceId ?? this.getDefaultActiveDevice()?.deviceId;
    if (!targetDeviceId) return Promise.resolve([]);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._paperSizesWaiters.delete(printerName);
        resolve([]);
      }, 15_000);
      this._paperSizesWaiters.set(printerName, { resolve, timer: timeout });
      this.sendRaw({ type: "GET_PAPER_SIZES", printerName }, targetDeviceId);
    });
  }

  handleAgentMessage(message: AgentEnvelope, deviceId?: string): void {
    this.addToHistory({ type: "RECEIVED", message, timestamp: new Date() });

    if (message.type === "PRINTER_STATUS") {
      const printerInfo: AgentPrinterInfo = {
        available: message.available ?? false,
        printers: message.printers ?? [],
        selectedPrinter: undefined,
      };

      if (deviceId) {
        // Preserve existing selectedPrinter for this device
        const existing = this._printersByDevice.get(deviceId);
        printerInfo.selectedPrinter = existing?.selectedPrinter;
        this._printersByDevice.set(deviceId, printerInfo);

        // Use PrinterDetails if available (has real status), fallback to name-only with status=0
        const printerInfos: DevicePrinterInfo[] = message.printerDetails && message.printerDetails.length > 0
          ? message.printerDetails.map((p) => ({ name: p.Name, status: p.PrinterStatus }))
          : (message.printers ?? []).map((name) => ({ name, status: 0 }));
        this.updateDevicePrinters(deviceId, printerInfos);
      } else {
        // Legacy fallback: store under default device
        const target = this.getDefaultActiveDevice();
        if (target) {
          const existing = this._printersByDevice.get(target.deviceId);
          printerInfo.selectedPrinter = existing?.selectedPrinter;
          this._printersByDevice.set(target.deviceId, printerInfo);
        }
      }

      this.events.emit("printers-updated", deviceId ? this._printersByDevice.get(deviceId) : printerInfo);

      if (!printerInfo.available && !printerInfo.selectedPrinter) {
        logger.info("[PrintAgent] Nenhuma impressora disponivel, autorizando pdf_fallback");
        this.authorizePrinter("pdf_fallback", deviceId);
      }
      return;
    }

    if (message.type === "PRINTER_STATUS_UPDATE" && deviceId) {
      const raw = (message as any).printers;
      // Only update if we actually received printer data — skip empty/missing to avoid clearing
      if (Array.isArray(raw) && raw.length > 0) {
        const printerInfos: DevicePrinterInfo[] = raw.map((p: any) => ({
          name: p.Name || p.name,
          status: p.PrinterStatus ?? p.status ?? 0,
        }));
        this.updateDevicePrinters(deviceId, printerInfos);
      }
      return;
    }

    if (message.type === "SYNC_PRINTER_CONFIG") {
      logger.info({ deviceId }, "[PrintAgent] App solicitou sincronização de config de impressoras");
      printAgentWSManager.syncPrinterConfig(deviceId).catch((err) => {
        logger.error({ err, deviceId }, "sync_printer_config_from_app_failed");
      });
      return;
    }

    if (message.type === "PAPER_SIZES_RESPONSE") {
      const printerName = (message as any).printerName;
      const paperSizes = (message as any).paperSizes ?? [];
      const waiter = this._paperSizesWaiters.get(printerName);
      if (waiter) {
        clearTimeout(waiter.timer);
        this._paperSizesWaiters.delete(printerName);
        waiter.resolve(paperSizes);
      }
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
    const defaultDevice = [...this.devices.values()].find((d) => d.isDefault && d.isActive && d.socket?.readyState === WebSocket.OPEN);
    if (defaultDevice) return defaultDevice;
    // Fallback: no device flagged default — use first active+open so prints still dispatch
    return [...this.devices.values()].find((d) => d.isActive && d.socket?.readyState === WebSocket.OPEN);
  }

  private notifyDeviceRole(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device || !device.isActive || device.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      device.socket.send(
        JSON.stringify({
          type: "DEVICE_ROLE_UPDATE",
          isDefault: device.isDefault,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (err) {
      logger.warn({ err, deviceId }, "notify_device_role_failed");
    }
  }

  private notifyAllDeviceRoles(): void {
    for (const [deviceId] of this.devices) {
      this.notifyDeviceRole(deviceId);
    }
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
          // Normalize legacy fallback ID to match non-HANDSHAKE path
          const currentDeviceId: string = parsed.deviceId || `legacy-${clientIp.replace(/[^a-zA-Z0-9]/g, "-")}`;
          deviceId = currentDeviceId;
          printAgentHub.connectDevice(ws, {
            deviceId: currentDeviceId,
            deviceName: parsed.deviceName || "Dispositivo",
            ip: parsed.ip || clientIp,
          });
          // Resolve isDefault from DB (connectDevice persists async) before ACK
          prisma.printDevice.findUnique({ where: { deviceId: currentDeviceId } })
            .then((dbDevice) => {
              const isDefault = dbDevice?.isDefault ?? printAgentHub.getDeviceInfo(currentDeviceId)?.isDefault ?? false;
              ws.send(
                JSON.stringify({
                  type: "HANDSHAKE_ACK",
                  ok: true,
                  isDefault,
                }),
              );
            })
            .catch(() => {
              ws.send(
                JSON.stringify({
                  type: "HANDSHAKE_ACK",
                  ok: true,
                  isDefault: printAgentHub.getDeviceInfo(currentDeviceId)?.isDefault ?? false,
                }),
              );
            });
          logger.info(`[PrintAgent] Handshake concluido: ${deviceId} (${parsed.deviceName})`);

          // Sync printer config for this device
          printAgentWSManager.syncPrinterConfig(currentDeviceId).catch((err) => {
            logger.error({ err, deviceId: currentDeviceId }, "printer_config_sync_on_connect_failed");
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
        const device = printAgentHub.getDeviceById(deviceId);
        // Skip disconnect if this socket is being replaced (isClosing) or if it's not the current socket
        if (device?.isClosing || device?.socket !== ws) {
          logger.debug(`[PrintAgent] Ignoring close from stale socket: ${deviceId}`);
          return;
        }
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
        // Merge role assignments from DB into live printers
        let printers: DevicePrinterInfo[];
        if (live?.printers) {
          const dbPrinters = (db.printers as any ?? []) as { name: string; role?: string }[];
          const roleMap = new Map<string, string>();
          for (const dp of dbPrinters) {
            if (dp.role && dp.name) roleMap.set(dp.name, dp.role);
          }
          printers = live.printers.map((p) => ({
            ...p,
            role: (roleMap.get(p.name) as 'photo' | 'letter' | null | undefined) ?? p.role ?? null,
          }));
        } else {
          printers = (db.printers as any ?? []) as DevicePrinterInfo[];
        }
        return {
          deviceId: db.deviceId,
          deviceName: live?.deviceName ?? db.deviceName,
          ip: live?.ip ?? db.ip,
          printers,
          connectedAt: live?.connectedAt ?? db.connectedAt.toISOString(),
          lastSeenAt: live?.lastSeenAt ?? db.lastSeenAt.toISOString(),
          // DB is source of truth for isDefault — live memory may be stale
          isDefault: db.isDefault,
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
      // Check device exists in DB (can be offline)
      const exists = await prisma.printDevice.findUnique({ where: { deviceId: id } });
      if (!exists) {
        res.status(404).json({ error: "Dispositivo não encontrado" });
        return;
      }
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

  // GET /api/print-agent/devices/:id/paper-sizes — query printer paper sizes from device
  router.get("/print-agent/devices/:id/paper-sizes", async (req: Request, res: Response) => {
    const { id } = req.params;
    const printerName = req.query.printerName as string;
    if (!printerName) {
      res.status(400).json({ error: "printerName é obrigatório" });
      return;
    }
    try {
      const device = printAgentHub.getDeviceInfo(id);
      if (!device?.isActive) {
        res.status(503).json({ error: "Dispositivo offline" });
        return;
      }
      const paperSizes = await printAgentHub.requestPaperSizes(printerName, id);
      res.json({ printerName, paperSizes });
    } catch (error: any) {
      logger.error({ error, deviceId: id }, "get_paper_sizes_failed");
      res.status(500).json({ error: error.message });
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

    // Keepalive ping every 25s to prevent proxy/browser timeout
    const keepaliveInterval = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 25_000);

    const off = printAgentHub.on("device:update", send);
    req.on("close", () => {
      clearInterval(keepaliveInterval);
      off();
    });
  });
}
