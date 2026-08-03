import { Router, Request, Response } from "express";
import path from "path";
import { generateOrderPrintSummaryBuffer } from "../utils/orderPrintSummaryGenerator";

export function createPrintSummaryTestRoutes(router: Router): Router {
  router.get("/api/print-summary-test", (_req: Request, res: Response) => {
    const filePath = path.join(__dirname, "../public/print-summary-test.html");
    res.sendFile(filePath);
  });

  router.post("/api/print-summary-test/generate", async (_req: Request, res: Response) => {
    try {
      const input = {
        orderId: "TEST-20260802-001",
        createdAt: new Date("2026-08-02T10:30:00Z"),
        customer: {
          name: "Maria Silva",
          email: "maria@example.com",
          phone: "+55 11 99999-0001",
          document: "123.456.789-00",
        },
        delivery: {
          method: "delivery",
          address: "Rua das Flores, 123",
          complement: "Apto 45",
          city: "São Paulo",
          state: "SP",
          zipCode: "01001-000",
          recipientPhone: "+55 11 99999-0001",
          date: new Date("2026-08-05"),
        },
        payment: {
          orderMethod: "pix",
          confirmedMethod: "pix",
        },
        amounts: {
          items: 150.0,
          shipping: 15.0,
          discount: 10.0,
          total: 155.0,
        },
        items: [
          {
            name: "Quadro Decorativo - Paisagem",
            quantity: 1,
            unitPrice: 120.0,
            additionals: [
              { name: "Moldura Premium", quantity: 1, price: 30.0 },
            ],
            customizations: [
              {
                type: "DYNAMIC_LAYOUT",
                text: undefined,
                label: "Layout Paisagem Horizontal",
                previewUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            ],
          },
          {
            name: "Cartão de Mensagem",
            quantity: 2,
            unitPrice: 15.0,
            additionals: [],
            customizations: [
              {
                type: "TEXT",
                text: "Feliz aniversário! 🎉\nDesejamos todo o amor do mundo para você.\nCom carinho, Família Silva",
                label: "Cartão Certinho",
                previewUrl: undefined,
              },
            ],
          },
        ],
      };

      const buffer = await generateOrderPrintSummaryBuffer(input as any);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", 'attachment; filename="Resumo_Pedido_TEST.docx"');
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  return router;
}
