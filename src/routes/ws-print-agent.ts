import { IncomingMessage } from "http";
import { URL } from "url";
import { EventEmitter } from "events";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import logger from "../utils/logger";

export type PrintFileType = "polaroid" | "quadro" | "cartao";
export type FileJobStatus = "pending" | "downloading" | "downloaded" | "generating_pdf" | "pdf_generated" | "moving" | "printed" | "failed";

export interface PrintJobFile {
  name: string;
  driveFileId: string;
  type: PrintFileType;
}

export interface PrintJobPayload {
  orderId: string;
  customerName: string;
  driveFolderId: string;
  files: PrintJobFile[];
}

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
      jobId: typeof parsed.job.jobId === "string" ? parsed.job.jobId : undefined,
      orderId: typeof parsed.job.orderId === "string" ? parsed.job.orderId : "",
      customerName:
        typeof parsed.job.customerName === "string" ? parsed.job.customerName : "",
      driveFolderId:
        typeof parsed.job.driveFolderId === "string" ? parsed.job.driveFolderId : "",
      files: files
        .filter(isRecord)
        .map((file): PrintJobFile => {
          const type: PrintFileType =
            file.type === "quadro" || file.type === "cartao"
              ? file.type
              : "polaroid";
          return {
            name: typeof file.name === "string" ? file.name : "",
            driveFileId:
              typeof file.driveFileId === "string" ? file.driveFileId : "",
            type,
          };
        })
        .filter((file) => file.name && file.driveFileId),
    };
  }

  return envelope;
};

export class PrintAgentHub {
  private agentSocket: WebSocket | null = null;
  private connectedAt: Date | null = null;

  getCurrentSocket(): WebSocket | null {
    return this.agentSocket;
  }
  private history: HistoryEntry[] = [];
  private readonly maxHistorySize = 50;
  private ackWaiters = new Map<string, Waiter>();
  private printedWaiters = new Map<string, Waiter>();
  private _printers: AgentPrinterInfo = { available: false, printers: [] };
  private events = new EventEmitter();

  setAgentSocket(socket: WebSocket | null): void {
    const wasConnected = this.isConnected();
    this.agentSocket = socket;
    this.connectedAt = socket ? new Date() : null;

    if (socket && !wasConnected) {
      this.requestPrinterCheck();
    }
    if (!socket && wasConnected) {
      this._printers = { available: false, printers: [] };
      this.events.emit("printers-updated", this._printers);
    }
  }

  isConnected(): boolean {
    return this.agentSocket?.readyState === WebSocket.OPEN;
  }

  getStatus(): {
    isConnected: boolean;
    connectedAt: Date | null;
    totalMessages: number;
    printers: AgentPrinterInfo;
  } {
    return {
      isConnected: this.isConnected(),
      connectedAt: this.connectedAt,
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
    return () => {
      this.events.off("printers-updated", listener);
    };
  }

  on(event: string, listener: (...args: any[]) => void): () => void {
    this.events.on(event, listener);
    return () => {
      this.events.off(event, listener);
    };
  }

  sendRaw(message: Record<string, unknown>): { success: boolean; message?: string; error?: string } {
    if (!this.isConnected() || !this.agentSocket) {
      return { success: false, error: "Agente não conectado" };
    }

    try {
      this.agentSocket.send(JSON.stringify(message));
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

  authorizePrinter(printerName: string): { success: boolean; error?: string } {
    if (!this.isConnected()) {
      return { success: false, error: "Agente não conectado" };
    }
    const result = this.sendRaw({
      type: "AUTHORIZE_PRINTER",
      selectedPrinter: printerName,
    });
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
    const printed = this.createWaiter(
      this.printedWaiters,
      jobId,
      "PRINTED",
      printedTimeoutMs,
    );

    const result = this.sendRaw({
      type: "PRINT_JOB",
      jobId,
      job: {
        ...payload,
        jobId,
      },
    });

    if (!result.success) {
      this.rejectWaiter(this.ackWaiters, jobId, new Error(result.error));
      this.rejectWaiter(this.printedWaiters, jobId, new Error(result.error));
    }

    return { ack, printed };
  }

  handleAgentMessage(message: AgentEnvelope): void {
    this.addToHistory({ type: "RECEIVED", message, timestamp: new Date() });

    if (message.type === "PRINTER_STATUS") {
      this._printers = {
        available: message.available ?? false,
        printers: message.printers ?? [],
        selectedPrinter: this._printers.selectedPrinter,
      };
      this.events.emit("printers-updated", this._printers);

      if (!this._printers.available && !this._printers.selectedPrinter) {
        logger.info("[PrintAgent] Nenhuma impressora disponivel, autorizando pdf_fallback");
        this.authorizePrinter("pdf_fallback");
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

    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    logger.info(`[PrintAgent] Agente conectado: ${clientIp}`);

    printAgentHub.setAgentSocket(ws);

    let isAlive = true;
    const heartbeatInterval = setInterval(() => {
      if (!isAlive) {
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
    }, 30000);

    ws.on("pong", () => {
      isAlive = true;
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const message = parseAgentEnvelope(raw);
        if (!message) {
          logger.warn("[PrintAgent] Mensagem ignorada: payload invalido");
          return;
        }
        printAgentHub.handleAgentMessage(message);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.error(`[PrintAgent] Erro ao processar mensagem: ${messageText}`);
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeatInterval);
      logger.info("[PrintAgent] Agente desconectado");
      if (printAgentHub.isConnected() && printAgentHub.getCurrentSocket() === ws) {
        printAgentHub.setAgentSocket(null);
      }
    });

    ws.on("error", (error: Error) => {
      logger.error(`[PrintAgent] Erro no WebSocket: ${error.message}`);
    });
  });

  logger.info("[PrintAgent] WebSocket ativo em /ws/print-agent");
  return wss;
}
