import path from "path";
import { Router, Request, Response } from "express";
import googleDriveService from "../services/googleDriveService";
import { upload } from "../config/multer";
import crypto from "crypto";
import {
  PrintFileType,
  PrintJobFile,
  PrintJobPayload,
  printAgentHub,
} from "./ws-print-agent";
import {
  PrintStatusEvent,
  printQueueService,
} from "../services/print-queue.service";

const validPrintTypes: PrintFileType[] = ["polaroid", "quadro", "cartao"];

const isPrintFileType = (value: string): value is PrintFileType => {
  return validPrintTypes.includes(value as PrintFileType);
};

const normalizeBodyList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
};

const sanitizeFolderName = (value: string): string => {
  const trimmed = value.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return trimmed || "Cliente sem nome";
};

const makeOrderId = (): string => {
  return `print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const sendSse = (
  res: Response,
  data: { message: string; status?: string; jobId?: string; error?: string; fileIndex?: number; fileStatus?: string },
): void => {
  res.write(`event: status\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const handlePrintSimulatorUpload = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const orderId = makeOrderId();
  let unsubscribe: (() => void) | null = null;
  let unsubFileStatus: (() => void) | null = null;
  let finish: (() => void) = () => { res.end(); };

  try {
    const customerNameRaw =
      typeof req.body.customerName === "string" ? req.body.customerName : "";
    const customerName = sanitizeFolderName(customerNameRaw);
    const files = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[])
      : [];
    const types = normalizeBodyList(req.body.fileTypes);

    if (!customerNameRaw.trim()) {
      throw new Error("Nome do cliente e obrigatorio");
    }

    if (files.length === 0) {
      throw new Error("Envie pelo menos uma imagem JPG ou PNG");
    }

    if (types.length !== files.length || types.some((type) => !isPrintFileType(type))) {
      throw new Error("Selecione um tipo valido para cada arquivo");
    }

    const onStatus = (event: PrintStatusEvent): void => {
      sendSse(res, {
        jobId: event.jobId,
        status: event.status,
        message: event.message,
        error: event.error,
      });

      if (event.status === "printed" || event.status === "failed") {
        unsubFileStatus?.();
        unsubscribe?.();
        res.end();
      }
    };

    const onFileStatus = (event: { jobId: string; fileIndex?: number; status: string; error?: string }): void => {
      if (event.jobId !== orderId) return;
      sendSse(res, {
        jobId: event.jobId,
        status: event.status,
        fileIndex: event.fileIndex,
        fileStatus: event.status,
        message: `Arquivo ${(event.fileIndex ?? 0) + 1}: ${event.status}`,
        error: event.error,
      });
    };

    unsubscribe = printQueueService.onStatus(orderId, onStatus);
    console.log(`[DIAG] onStatus registered orderId=${orderId}`);

    unsubFileStatus = printAgentHub.on("file-status", onFileStatus);

    req.on("close", () => {
      unsubFileStatus?.();
      unsubscribe?.();
    });

    const folderName = `${customerName} - ${orderId}`;
    const driveFolderId = await googleDriveService.createFolder(folderName);
    const typeFolders = new Map<PrintFileType, string>();

    for (const type of validPrintTypes) {
      const folderId = await googleDriveService.createFolder(type, driveFolderId);
      typeFolders.set(type, folderId);
    }

    const uploadedFiles: PrintJobFile[] = [];
    for (const [index, file] of files.entries()) {
      const type = types[index] as PrintFileType;
      const typeFolderId = typeFolders.get(type);
      if (!typeFolderId) {
        throw new Error(`Pasta do tipo ${type} nao criada`);
      }

      const uploaded = await googleDriveService.uploadBuffer(
        file.buffer,
        file.originalname,
        typeFolderId,
        file.mimetype,
      );

      uploadedFiles.push({
        name: uploaded.name || file.originalname,
        driveFileId: uploaded.id,
        type,
      });
    }

    sendSse(res, {
      jobId: orderId,
      status: "pending",
      message: "Arquivos enviados ao Drive",
    });

    const payload: PrintJobPayload = {
      orderId,
      customerName,
      driveFolderId,
      files: uploadedFiles,
    };

    await printQueueService.addPrintJob(payload);
    sendSse(res, {
      jobId: orderId,
      status: "pending",
      message: "Job adicionado a fila",
    });

    let closeTimeout: ReturnType<typeof setTimeout> | null = null;
    let unsubCompleted: (() => void) | null = null;
    let finished = false;
    finish = (): void => {
      if (finished) return;
      finished = true;
      if (closeTimeout) clearTimeout(closeTimeout);
      unsubCompleted?.();
      unsubFileStatus?.();
      unsubscribe?.();
      res.end();
    };

    closeTimeout = setTimeout(() => {
      sendSse(res, {
        jobId: orderId,
        status: "info",
        message: "Acompanhe o status no agente de impressao",
      });
      finish();
    }, 60_000);

    unsubCompleted = printAgentHub.on("job-completed", (event: { jobId: string }) => {
      if (event.jobId === orderId) {
        sendSse(res, {
          jobId: orderId,
          status: "printed",
          message: "Job concluido pelo agente",
        });
        finish();
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendSse(res, {
      jobId: orderId,
      status: "failed",
      message: "Falha na simulacao de pedido",
      error: message,
    });
    finish?.();
  }
};

export function createPrintSimulatorRoutes(router: Router): Router {
  router.get("/admin/print-simulator", (_req: Request, res: Response) => {
    const filePath = path.join(__dirname, "../../public/print-simulator.html");
    res.sendFile(filePath);
  });

  router.get("/api/admin/print/agent-status", (_req: Request, res: Response) => {
    res.json(printAgentHub.getStatus());
  });

  router.post("/api/admin/print/authorize-printer", (req: Request, res: Response) => {
    const { printer } = req.body;
    if (!printer || typeof printer !== "string") {
      res.status(400).json({ error: "Nome da impressora obrigatorio" });
      return;
    }
    const result = printAgentHub.authorizePrinter(printer);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json({ success: true, selectedPrinter: printer });
  });

  router.post(
    "/api/admin/print/request-printer-check",
    (_req: Request, res: Response) => {
      printAgentHub.requestPrinterCheck();
      res.json({ success: true });
    },
  );

  router.get("/api/print/files/:fileId/download-url", (req: Request, res: Response) => {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).json({ error: "fileId obrigatorio" });
    }

    return res.json({
      fileId,
      downloadUrl: googleDriveService.getDirectDownloadUrl(fileId),
    });
  });

  router.post(
    "/api/admin/print-simulator",
    upload.array("files", 20),
    (req: Request, res: Response) => {
      handlePrintSimulatorUpload(req, res).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          res.status(500).json({ error: message });
          return;
        }
        sendSse(res, {
          status: "failed",
          message: "Falha na simulacao de pedido",
          error: message,
        });
        res.end();
      });
    },
  );

  return router;
}
