import type { Router } from "express";
import { printAgentHub } from "./ws-print-agent";
import { printAgentWSManager } from "../services/printAgentWSManager";
import prisma from "../database/prisma";
import { dispatchPrintForOrder } from "../services/printDispatchService";
import orderCustomizationService from "../services/orderCustomizationService";
import logger from "../utils/logger";
import { authenticateToken, requireAdmin } from "../middleware/security";
import tempFileService from "../services/tempFileService";

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
    const job = await prisma.printJob.findUnique({
      where: { orderId },
      select: { id: true, status: true, lastError: true, updatedAt: true },
    });
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    res.json(job);
  });

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
