import type { Router } from "express";
import { printAgentHub } from "./ws-print-agent";
import { printAgentWSManager } from "../services/printAgentWSManager";
import prisma from "../database/prisma";
import { dispatchPrintForOrder } from "../services/printDispatchService";

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

  // POST /api/dev/simulate-print - simulates print flow bypassing payment
  router.post("/api/dev/simulate-print", async (req, res) => {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.ALLOW_PRINT_SIMULATOR
    ) {
      res.status(403).json({ error: "Simulador desabilitado em produção" });
      return;
    }

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
}
