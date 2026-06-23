import { Request, Response } from "express";
import { payment, mercadoPagoConfig } from "../config/mercadopago";
import { PaymentRefund } from "mercadopago";
import prisma from "../database/prisma";
import logger from "../utils/logger";
import { v4 as uuid } from "uuid";

const refundClient = new PaymentRefund(mercadoPagoConfig.client);

class AdminPaymentController {
  async getPaymentDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const dbPayment = await prisma.payment.findUnique({
        where: { id },
        include: { order: { select: { id: true, status: true, user: { select: { name: true, email: true } } } } },
      });
      if (!dbPayment || !dbPayment.mercado_pago_id) {
        return res.status(404).json({ error: "Pagamento não encontrado" });
      }

      const mpPayment = await payment.get({ id: dbPayment.mercado_pago_id });

      res.json({
        id: dbPayment.id,
        mercado_pago_id: dbPayment.mercado_pago_id,
        status: dbPayment.status,
        transaction_amount: mpPayment.transaction_amount,
        net_received_amount: mpPayment.transaction_details?.net_received_amount,
        payment_method: mpPayment.payment_method_id,
        payment_type: mpPayment.payment_type_id,
        installments: mpPayment.installments,
        date_approved: mpPayment.date_approved,
        date_created: mpPayment.date_created,
        payer_email: mpPayment.payer?.email,
        status_detail: mpPayment.status_detail,
        refunds: mpPayment.refunds || [],
        order: dbPayment.order,
      });
    } catch (error: any) {
      logger.error("Erro ao buscar detalhes do pagamento:", error);
      res.status(500).json({ error: "Erro ao buscar detalhes do pagamento" });
    }
  }

  async refundPayment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { amount } = req.body; // undefined = total, number = parcial

      const dbPayment = await prisma.payment.findUnique({ where: { id } });
      if (!dbPayment || !dbPayment.mercado_pago_id) {
        return res.status(404).json({ error: "Pagamento não encontrado" });
      }
      if (dbPayment.status !== "APPROVED") {
        return res.status(400).json({ error: `Só é possível reembolsar pagamentos aprovados. Status atual: ${dbPayment.status}` });
      }

      const refundBody: any = {};
      if (typeof amount === "number" && amount > 0) {
        refundBody.amount = amount;
      }

      const refund = await refundClient.create({
        payment_id: Number(dbPayment.mercado_pago_id),
        body: refundBody,
        requestOptions: { idempotencyKey: uuid() },
      });

      // Atualizar status local
      const newStatus = amount ? "APPROVED" : "REFUNDED"; // parcial mantém approved
      await prisma.payment.update({
        where: { id },
        data: { status: newStatus },
      });

      if (!amount) {
        await prisma.order.update({
          where: { id: dbPayment.order_id },
          data: { status: "CANCELED" },
        });
      }

      logger.info(`💰 Reembolso realizado: payment=${id}, mp_id=${dbPayment.mercado_pago_id}, amount=${amount || "total"}`);

      res.json({
        success: true,
        refund_id: refund.id,
        amount: refund.amount,
        status: refund.status,
      });
    } catch (error: any) {
      logger.error("Erro ao reembolsar pagamento:", error);
      const msg = error?.cause?.message || error?.message || "Erro ao reembolsar";
      res.status(500).json({ error: msg });
    }
  }

  async cancelPayment(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const dbPayment = await prisma.payment.findUnique({ where: { id } });
      if (!dbPayment || !dbPayment.mercado_pago_id) {
        return res.status(404).json({ error: "Pagamento não encontrado" });
      }
      if (!["PENDING", "IN_PROCESS"].includes(dbPayment.status)) {
        return res.status(400).json({ error: `Só é possível cancelar pagamentos pendentes. Status atual: ${dbPayment.status}` });
      }

      await payment.cancel({ id: dbPayment.mercado_pago_id });

      await prisma.payment.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      await prisma.order.update({
        where: { id: dbPayment.order_id },
        data: { status: "CANCELED" },
      });

      logger.info(`❌ Pagamento cancelado: payment=${id}, mp_id=${dbPayment.mercado_pago_id}`);

      res.json({ success: true, status: "cancelled" });
    } catch (error: any) {
      logger.error("Erro ao cancelar pagamento:", error);
      const msg = error?.cause?.message || error?.message || "Erro ao cancelar";
      res.status(500).json({ error: msg });
    }
  }
}

export default new AdminPaymentController();
