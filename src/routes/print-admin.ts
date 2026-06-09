import type { Router } from "express";
import axios from "axios";
import sharp from "sharp";
import { randomUUID } from "crypto";
import PDFDocument from "pdfkit";
import { printAgentHub } from "./ws-print-agent";
import { printAgentWSManager } from "../services/printAgentWSManager";
import prisma from "../database/prisma";
import { dispatchPrintForOrder } from "../services/printDispatchService";
import { enqueue as enqueuePrintJob } from "../services/printQueueService";
import orderCustomizationService from "../services/orderCustomizationService";
import googleDriveService from "../services/googleDriveService";
import logger from "../utils/logger";
import { authenticateToken, requireAdmin } from "../middleware/security";
import tempFileService from "../services/tempFileService";
import { uploadAny } from "../config/multer";
import { generateCartinhaBuffer } from "../utils/cartinhaGenerator";
import { extractDynamicLayoutSlots } from "../utils/dynamicLayoutSlots";
import { extractPages } from "../types/dynamicLayout";

function generateMockPngBuffer(): Buffer {
  const { deflateSync } = require("zlib");
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const W = 800, H = 800;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const off = y * (1 + W * 3);
    raw[off] = 0;
    for (let x = 0; x < W; x++) {
      const p = off + 1 + x * 3;
      raw[p] = 245; raw[p + 1] = 235; raw[p + 2] = 220;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function safeDriveName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48) || "Cliente";
}

async function imageBufferFromUrl(url: string): Promise<Buffer | null> {
  if (!url) return null;
  if (url.startsWith("data:")) {
    const match = url.match(/^data:[^;]+;base64,(.+)$/);
    return match?.[1] ? Buffer.from(match[1], "base64") : null;
  }
  if (!url.startsWith("http")) return null;

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
  });
  return Buffer.from(response.data);
}

async function composeManualLayoutPng(params: {
  layout: {
    baseImageUrl: string;
    fabricJsonState: unknown;
    width: number;
    height: number;
  };
  filesBySlot: Map<string, Express.Multer.File>;
}): Promise<Buffer> {
  const { layout, filesBySlot } = params;
  const width = Number(layout.width || 1000);
  const height = Number(layout.height || 1500);
  const baseBuffer = await imageBufferFromUrl(layout.baseImageUrl);
  let base = baseBuffer
    ? sharp(baseBuffer).resize(width, height, { fit: "cover", position: "center" })
    : sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      });

  const overlays = extractDynamicLayoutSlots(layout.fabricJsonState)
    .map((slot) => {
      const file = filesBySlot.get(slot.id);
      if (!file) return null;
      return { slot, file };
    })
    .filter((entry): entry is { slot: ReturnType<typeof extractDynamicLayoutSlots>[number]; file: Express.Multer.File } => Boolean(entry));

  const composites = await Promise.all(
    overlays.map(async ({ slot, file }) => {
      const resized = await sharp(file.buffer)
        .resize(Math.max(1, Math.round(slot.position.width)), Math.max(1, Math.round(slot.position.height)), {
          fit: "cover",
          position: "center",
        })
        .rotate(slot.position.rotation || 0, {
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

      return {
        input: resized,
        left: Math.round(slot.position.x),
        top: Math.round(slot.position.y),
      };
    }),
  );

  return base.composite(composites).png({ compressionLevel: 9 }).toBuffer();
}

async function composePagePng(params: {
  canvasState: unknown;
  filesBySlot: Map<string, Express.Multer.File>;
  width: number;
  height: number;
  baseImageUrl: string;
}): Promise<Buffer> {
  const { canvasState, filesBySlot, width, height, baseImageUrl } = params;
  const baseBuffer = await imageBufferFromUrl(baseImageUrl);
  let base = baseBuffer
    ? sharp(baseBuffer).resize(width, height, { fit: "cover", position: "center" })
    : sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      });

  const overlays = extractDynamicLayoutSlots(canvasState)
    .map((slot) => {
      const file = filesBySlot.get(slot.id);
      if (!file) return null;
      return { slot, file };
    })
    .filter((entry): entry is { slot: ReturnType<typeof extractDynamicLayoutSlots>[number]; file: Express.Multer.File } => Boolean(entry));

  const composites = await Promise.all(
    overlays.map(async ({ slot, file }) => {
      const resized = await sharp(file.buffer)
        .resize(Math.max(1, Math.round(slot.position.width)), Math.max(1, Math.round(slot.position.height)), {
          fit: "cover",
          position: "center",
        })
        .rotate(slot.position.rotation || 0, {
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

      return {
        input: resized,
        left: Math.round(slot.position.x),
        top: Math.round(slot.position.y),
      };
    }),
  );

  return base.composite(composites).png({ compressionLevel: 9 }).toBuffer();
}

export async function composeManualLayoutPdf(params: {
  layout: {
    baseImageUrl: string;
    fabricJsonState: unknown;
    width: number;
    height: number;
  };
  filesBySlot: Map<string, Express.Multer.File>;
}): Promise<Buffer> {
  const { layout, filesBySlot } = params;
  const widthPx = Number(layout.width || 1000);
  const heightPx = Number(layout.height || 1500);

  // PR 4x6 = 100x150mm. Orientação baseada no aspect ratio do layout.
  const aspectRatio = widthPx / heightPx;
  const PR_SHORT_MM = 100;
  const PR_LONG_MM = 150;
  const mmToPt = (mm: number) => (mm / 25.4) * 72;

  let pageWidthPt: number, pageHeightPt: number;
  if (aspectRatio >= 1) {
    // Landscape
    pageWidthPt = mmToPt(PR_LONG_MM);
    pageHeightPt = mmToPt(PR_SHORT_MM);
  } else {
    // Portrait
    pageWidthPt = mmToPt(PR_SHORT_MM);
    pageHeightPt = mmToPt(PR_LONG_MM);
  }

  const doc = new PDFDocument({
    size: [pageWidthPt, pageHeightPt],
    autoFirstPage: false,
  });
  const buffers: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => buffers.push(chunk));

  const pages = extractPages(layout.fabricJsonState);

  for (const page of pages) {
    const pngBuffer = await composePagePng({
      canvasState: page.canvasState,
      filesBySlot,
      width: widthPx,
      height: heightPx,
      baseImageUrl: layout.baseImageUrl,
    });
    doc.addPage({ size: [pageWidthPt, pageHeightPt] });
    doc.image(pngBuffer, 0, 0, { width: pageWidthPt, height: pageHeightPt });
  }

  doc.end();

  return new Promise((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(buffers))),
  );
}

export function createPrintAdminRoutes(router: Router): void {
  // GET /api/print/agent-status - returns agent connection status
  router.get("/api/print/agent-status", (_req, res) => {
    res.json({
      connected: printAgentWSManager.isConnected(),
    });
  });

  // GET /api/print/available-printers - queries agent for printer list
  router.get("/api/print/available-printers", async (_req, res) => {
    const connected = printAgentWSManager.isConnected();
    if (!connected) {
      res.json({ printers: [], agentConnected: false });
      return;
    }
    const printers = await printAgentHub.requestPrinterList();
    res.json({ printers, agentConnected: true });
  });

  // GET /api/print/jobs/:orderId/status - gets print job status by order ID
  router.get("/api/print/jobs/:orderId/status", async (req, res) => {
    const { orderId } = req.params;
    const job = await prisma.printJob.findFirst({
      where: {
        OR: [{ orderId }, { id: orderId }],
      },
      select: { id: true, orderId: true, status: true, lastError: true, updatedAt: true },
    });
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    res.json(job);
  });

  router.post("/api/print/jobs/:printJobId/retry", authenticateToken, requireAdmin, async (req, res) => {
    const { printJobId } = req.params;
    const job = await prisma.printJob.findFirst({
      where: { OR: [{ id: printJobId }, { orderId: printJobId }] },
    });

    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }

    try {
      await enqueuePrintJob({
        jobId: job.id,
        orderId: job.orderId,
        customerName: job.customerName,
        driveFolderId: job.driveFolderId,
        files: JSON.parse(job.filesJson),
      });

      res.json({ ok: true, printJobId: job.id, orderId: job.orderId });
    } catch (err: any) {
      logger.error({ err, printJobId }, "print_job_retry_failed");
      res.status(500).json({ error: err.message || "Erro ao reenfileirar impressão" });
    }
  });

  router.post(
    "/api/impressao/manual",
    authenticateToken,
    requireAdmin,
    uploadAny.any(),
    async (req, res) => {
      const customerName = String(req.body.customerName || "").trim();
      const layoutId = String(req.body.layoutId || "").trim();
      const giftMessageMaxLength = Number(req.body.maxLength) || 500;
      const giftMessage = String(req.body.giftMessage || "").trim().slice(0, giftMessageMaxLength);

      if (!customerName || !layoutId) {
        res.status(400).json({ error: "customerName e layoutId são obrigatórios" });
        return;
      }

      try {
        const layout = await prisma.dynamicLayout.findUnique({
          where: { id: layoutId },
          select: {
            id: true,
            name: true,
            baseImageUrl: true,
            fabricJsonState: true,
            width: true,
            height: true,
          },
        });

        if (!layout) {
          res.status(404).json({ error: "Layout não encontrado" });
          return;
        }

        const adminUser = await prisma.user.findFirst({
          where: { role: { in: ["admin", "ADMIN"] } },
          select: { id: true },
        });

        if (!adminUser) {
          res.status(500).json({ error: "Nenhum admin encontrado para registrar o pedido manual" });
          return;
        }

        const order = await prisma.order.create({
          data: {
            user_id: adminUser.id,
            total: 0,
            grand_total: 0,
            status: "PENDING",
            payment_method: "manual_whatsapp",
            source: "manual_print",
          },
        });

        const shortId = order.id.slice(0, 8);
        const datePart = new Date().toISOString().split("T")[0];
        const mainFolderName = `Pedido_${safeDriveName(customerName)}_${datePart}_${shortId}`;
        const mainFolderId = await googleDriveService.createFolder(mainFolderName);
        await googleDriveService.makeFolderPublic(mainFolderId);

        const layoutFolderId = await googleDriveService.createFolder(layout.name, mainFolderId);
        await googleDriveService.makeFolderPublic(layoutFolderId);

        const uploadedFiles = Array.isArray(req.files)
          ? (req.files as Express.Multer.File[])
          : [];
        const filesBySlot = new Map<string, Express.Multer.File>();

        for (const file of uploadedFiles) {
          const field = file.fieldname || "";
          if (field === "composedImage") continue;
          const slotId =
            field.match(/^slots?\.(.+)$/)?.[1] ||
            field.match(/^slots?\[(.+)\]$/)?.[1] ||
            field.match(/^slot:(.+)$/)?.[1] ||
            field.match(/^slot_(.+)$/)?.[1] ||
            field;

          if (slotId) filesBySlot.set(slotId, file);
        }

        const slots = extractDynamicLayoutSlots(layout.fabricJsonState);
        const missing = slots.filter((slot) => slot.required && !filesBySlot.has(slot.id));
        if (missing.length > 0) {
          res.status(400).json({
            error: "Preencha todos os slots obrigatórios",
            missingSlots: missing.map((slot) => ({ id: slot.id, label: slot.label })),
          });
          return;
        }

        // Sempre gerar PDF com tamanho PR 4x6 (100x150mm) e orientação correta
        const designBuffer = await composeManualLayoutPdf({ layout, filesBySlot });
        const designFileName = `${safeDriveName(layout.name)}_${shortId}.pdf`;
        const designMimeType = "application/pdf";

        const designUpload = await googleDriveService.uploadBuffer(
          designBuffer,
          designFileName,
          layoutFolderId,
          designMimeType,
        );

        const dispatchFiles = [
          {
            driveFileId: designUpload.id,
            fileName: designFileName,
            subfolderName: layout.name,
          },
        ];

        if (giftMessage) {
          const cartinhaFolderId = await googleDriveService.createFolder("Cartinha", mainFolderId);
          const cartinhaFileName = `Cartinha_${shortId}.docx`;
          const cartinhaBuffer = await generateCartinhaBuffer({ message: giftMessage, maxLength: giftMessageMaxLength });
          const cartinhaUpload = await googleDriveService.uploadBuffer(
            cartinhaBuffer,
            cartinhaFileName,
            cartinhaFolderId,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
          await googleDriveService.makeFolderPublic(cartinhaFolderId);
          dispatchFiles.push({
            driveFileId: cartinhaUpload.id,
            fileName: cartinhaFileName,
            subfolderName: "Cartinha",
          });
          logger.info({
            orderId: order.id,
            fileId: cartinhaUpload.id,
            totalFiles: dispatchFiles.length,
          }, "manual_cartinha_added_to_dispatch");
        }

        const folderUrl = googleDriveService.getFolderUrl(mainFolderId);
        await prisma.order.update({
          where: { id: order.id },
          data: {
            google_drive_folder_id: mainFolderId,
            google_drive_folder_url: folderUrl,
            customizations_drive_processed: true,
            customizations_drive_processed_at: new Date(),
          },
        });

        await dispatchPrintForOrder(order.id, mainFolderId, customerName, dispatchFiles);
        const job = await prisma.printJob.findUnique({
          where: { orderId: order.id },
          select: { id: true, status: true },
        });

        res.json({
          ok: true,
          orderId: order.id,
          printJobId: job?.id,
          status: job?.status,
          folderUrl,
        });
      } catch (err: any) {
        logger.error({ err }, "manual_print_order_failed");
        res.status(500).json({ error: err.message || "Erro ao gerar pedido manual" });
      }
    },
  );

  // POST /api/simulator/simulate-print - simulates print flow bypassing payment
  router.post("/api/simulator/simulate-print", authenticateToken, requireAdmin, async (req, res) => {
    const { orderId, giftMessage } = req.body as {
      orderId?: string;
      giftMessage?: string;
    };

    if (!orderId) {
      res.status(400).json({ error: "orderId é obrigatório" });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { name: true } },
        items: {
          include: {
            product: true,
            customizations: true,
          },
        },
      },
    });

    if (!order) {
      res.status(404).json({ error: "Pedido não encontrado" });
      return;
    }

    if (!order.google_drive_folder_id) {
      res.status(400).json({ error: "Pedido não possui pasta no Google Drive" });
      return;
    }

    // If giftMessage provided, temporarily inject into TEXT customizations
    if (giftMessage?.trim()) {
      const textCusts = await prisma.orderItemCustomization.findMany({
        where: {
          orderItem: { order_id: orderId },
          customization: { type: "TEXT" },
        },
      });
      for (const cust of textCusts) {
        try {
          const val = JSON.parse(cust.value as string);
          if (typeof val === "object" && val !== null) {
            val.text = giftMessage.trim();
            await prisma.orderItemCustomization.update({
              where: { id: cust.id },
              data: { value: JSON.stringify(val) },
            });
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    try {
      await dispatchPrintForOrder(
        orderId,
        order.google_drive_folder_id,
        order.user?.name || "Cliente",
      );

      const job = await prisma.printJob.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });

      res.json({ ok: true, printJobId: job?.id, status: job?.status });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err.message || "Erro ao simular impressão",
      });
    }
  });

  // ========================================
  // 🧪 PROTÓTIPO - Simulador de Pedido (sem pedidos reais)
  // ========================================

  // GET /api/simulator/simulate-products - returns up to 6 products with customizations
  router.get("/api/simulator/simulate-products", authenticateToken, requireAdmin, async (_req, res) => {
    try {
      const products = await prisma.product.findMany({
        take: 6,
        orderBy: { created_at: "desc" },
        include: {
          components: {
            include: {
              item: {
                include: { customizations: true },
              },
            },
          },
          additionals: {
            include: {
              additional: {
                include: { customizations: true },
              },
            },
          },
          categories: { include: { category: true } },
          type: true,
        },
      });
      res.json({ products });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/simulator/simulate-prototype - creates prototype order and processes it
  router.post("/api/simulator/simulate-prototype", authenticateToken, requireAdmin, async (req, res) => {
    const { items, giftMessage } = req.body as {
      items?: Array<{
        productId: string;
        quantity?: number;
        customizations?: Array<{
          itemId: string;
          customizationId: string;
          type: string;
          value: string;
        }>;
      }>;
      giftMessage?: string;
    };

    if (!items || items.length === 0) {
      res.status(400).json({ error: "Selecione ao menos um produto" });
      return;
    }

    try {
      // Find first admin user to own the prototype order
      const adminUser = await prisma.user.findFirst({
        where: { role: { in: ["admin", "ADMIN"] } },
        select: { id: true, name: true },
      });
      if (!adminUser) {
        res.status(500).json({ error: "Nenhum admin encontrado" });
        return;
      }

      // Create prototype order
      const order = await prisma.order.create({
        data: {
          user_id: adminUser.id,
          total: 0,
          status: "PENDING",
          payment_method: "pix",
          source: "print_simulator",
        },
      });

      // Create order items and customizations
      for (const item of items) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, price: true },
        });
        if (!product) continue;

        const orderItem = await prisma.orderItem.create({
          data: {
            order_id: order.id,
            product_id: product.id,
            quantity: item.quantity ?? 1,
            price: product.price,
          },
        });

        // Create customizations for each component of the product
        if (item.customizations) {
          for (const cust of item.customizations) {
            let finalValue = cust.value;

            if (cust.type === "TEXT" && !cust.value.startsWith("{")) {
              finalValue = JSON.stringify({ customization_type: "TEXT", text: cust.value });
            } else if (cust.type === "TEXT" && cust.value.startsWith("{")) {
              const parsed = JSON.parse(cust.value);
              if (!parsed.customization_type) {
                parsed.customization_type = "TEXT";
                finalValue = JSON.stringify(parsed);
              }
            }

            if (cust.type === "DYNAMIC_LAYOUT" && cust.value) {
              let layoutName = cust.value;
              let slotImages: Record<string, string> = {};

              try {
                const parsed = JSON.parse(cust.value);
                if (parsed.layoutName) {
                  layoutName = parsed.layoutName;
                  slotImages = parsed.slotImages || {};
                }
              } catch {}

              const layout = await prisma.dynamicLayout.findFirst({
                where: { name: layoutName },
                select: { id: true, name: true },
              });

              const firstSlotUrl = Object.values(slotImages).find(Boolean) || await (async () => {
                const pngBuffer = generateMockPngBuffer();
                const saved = await tempFileService.saveFile(pngBuffer, "mock-layout.png");
                return saved.url;
              })();

              if (layout) {
                finalValue = JSON.stringify({
                  customization_type: "DYNAMIC_LAYOUT",
                  selected_item_label: layout.name,
                  layout_id: layout.id,
                  text: firstSlotUrl,
                  image: { preview_url: firstSlotUrl },
                  slotImages: Object.keys(slotImages).length > 0 ? slotImages : undefined,
                });
              } else {
                finalValue = JSON.stringify({
                  customization_type: "DYNAMIC_LAYOUT",
                  selected_item_label: layoutName,
                });
              }
            }

            await prisma.orderItemCustomization.create({
              data: {
                order_item_id: orderItem.id,
                customization_id: cust.customizationId,
                value: finalValue,
              },
            });
          }
        }
      }

      // Inject giftMessage into TEXT customizations
      if (giftMessage?.trim()) {
        const textCusts = await prisma.orderItemCustomization.findMany({
          where: {
            orderItem: { order_id: order.id },
            customization: { type: "TEXT" },
          },
        });
        for (const cust of textCusts) {
          try {
            const val = JSON.parse(cust.value as string);
            if (typeof val === "object" && val !== null) {
              val.text = giftMessage.trim();
              await prisma.orderItemCustomization.update({
                where: { id: cust.id },
                data: { value: JSON.stringify(val) },
              });
            }
          } catch {
            // ignore
          }
        }
      }

      // Finalize customizations (generate Drive files)
      const finalizeRes = await orderCustomizationService.finalizeOrderCustomizations(
        order.id,
      );

      if (!finalizeRes.folderId) {
        res.status(500).json({ error: "Falha ao criar pasta no Google Drive" });
        return;
      }

      // Dispatch print job
      await dispatchPrintForOrder(
        order.id,
        finalizeRes.folderId,
        "Simulador",
      );

      const job = await prisma.printJob.findUnique({
        where: { orderId: order.id },
        select: { id: true, status: true },
      });

      res.json({
        ok: true,
        orderId: order.id,
        printJobId: job?.id,
        status: job?.status,
      });
    } catch (err: any) {
      logger.error({ err }, "simulate_prototype_error");
      res.status(500).json({
        ok: false,
        error: err.message || "Erro ao criar protótipo",
      });
    }
  });
}
