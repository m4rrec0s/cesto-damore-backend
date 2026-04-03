import { Request, Response } from "express";
import { PaymentService } from "../services/paymentService";
import prisma from "../database/prisma";
import logger from "../utils/logger";

/**
 * Controlador para simular pagamentos em ambiente de testes/desenvolvimento
 * ⚠️ NÃO USAR EM PRODUÇÃO!
 */
export class TestPaymentController {
  /**
   * Simula a aprovação de um pagamento PIX
   * POST /test/payment/:paymentId/approve
   */
  static async simulateApproval(req: Request, res: Response) {
    try {
      const { paymentId } = req.params;
      const mercadoPagoId = req.body?.mercadoPagoId; // Opcional

      if (!paymentId) {
        return res.status(400).json({
          error: "paymentId é obrigatório",
        });
      }

      // Busca o pagamento no banco (aceita UUID ou mercado_pago_id)
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { id: paymentId },
            { mercado_pago_id: paymentId },
            ...(mercadoPagoId ? [{ mercado_pago_id: mercadoPagoId }] : []),
          ],
        },
        include: {
          order: true,
        },
      });

      if (!payment) {
        return res.status(404).json({
          error: "Pagamento não encontrado",
          searched: { paymentId, mercadoPagoId },
        });
      }

      logger.info("🧪 [TEST] Simulando aprovação de pagamento", {
        paymentId: payment.id,
        mercadoPagoId: payment.mercado_pago_id,
        currentStatus: payment.status,
      });

      // Simula a notificação do webhook com status approved
      const mockPaymentData = {
        id: payment.mercado_pago_id || "SIMULATED_" + Date.now(),
        status: "approved",
        status_detail: "accredited",
        transaction_amount: payment.transaction_amount,
        date_approved: new Date().toISOString(),
        date_created: payment.created_at.toISOString(),
        payment_method_id: payment.payment_method || "pix",
        payment_type_id: payment.payment_type || "bank_transfer",
        payer: {
          email: "test@test.com",
          identification: {
            type: "CPF",
            number: "12345678900",
          },
        },
      };

      // Processa a notificação usando o serviço real
      await PaymentService.processPaymentNotification(
        payment.mercado_pago_id || mockPaymentData.id,
        mockPaymentData,
      );

      // Busca o pagamento atualizado
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
        include: {
          order: {
            include: {
              items: true,
            },
          },
        },
      });

      logger.info("✅ [TEST] Pagamento aprovado com sucesso", {
        paymentId: updatedPayment?.id,
        newStatus: updatedPayment?.status,
        orderStatus: updatedPayment?.order.status,
      });

      return res.json({
        success: true,
        message: "Pagamento aprovado (simulação)",
        data: {
          payment: {
            id: updatedPayment?.id,
            mercado_pago_id: updatedPayment?.mercado_pago_id,
            status: updatedPayment?.status,
            approved_at: updatedPayment?.approved_at,
          },
          order: {
            id: updatedPayment?.order.id,
            status: updatedPayment?.order.status,
            total: updatedPayment?.order.grand_total,
          },
        },
      });
    } catch (error) {
      logger.error("❌ [TEST] Erro ao simular aprovação:", error);
      return res.status(500).json({
        error: "Erro ao simular aprovação",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Simula a rejeição de um pagamento
   * POST /test/payment/:paymentId/reject
   */
  static async simulateRejection(req: Request, res: Response) {
    try {
      const { paymentId } = req.params;

      const payment = await prisma.payment.findFirst({
        where: {
          OR: [{ id: paymentId }, { mercado_pago_id: paymentId }],
        },
        include: {
          order: true,
        },
      });

      if (!payment) {
        return res.status(404).json({
          error: "Pagamento não encontrado",
        });
      }

      logger.info("🧪 [TEST] Simulando rejeição de pagamento", {
        paymentId: payment.id,
        mercadoPagoId: payment.mercado_pago_id,
      });

      const mockPaymentData = {
        id: payment.mercado_pago_id || "SIMULATED_" + Date.now(),
        status: "rejected",
        status_detail: "cc_rejected_other_reason",
        transaction_amount: payment.transaction_amount,
        date_created: payment.created_at.toISOString(),
        payment_method_id: payment.payment_method || "pix",
        payment_type_id: payment.payment_type || "bank_transfer",
      };

      await PaymentService.processPaymentNotification(
        payment.mercado_pago_id || mockPaymentData.id,
        mockPaymentData,
      );

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
        include: {
          order: true,
        },
      });

      return res.json({
        success: true,
        message: "Pagamento rejeitado (simulação)",
        data: {
          payment: {
            id: updatedPayment?.id,
            status: updatedPayment?.status,
          },
          order: {
            id: updatedPayment?.order.id,
            status: updatedPayment?.order.status,
          },
        },
      });
    } catch (error) {
      logger.error("❌ [TEST] Erro ao simular rejeição:", error);
      return res.status(500).json({
        error: "Erro ao simular rejeição",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Lista pagamentos pendentes para testes
   * GET /test/payment/pending
   */
  static async listPending(req: Request, res: Response) {
    try {
      const pendingPayments = await prisma.payment.findMany({
        where: {
          status: "PENDING",
        },
        include: {
          order: {
            select: {
              id: true,
              total: true,
              grand_total: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: {
          created_at: "desc",
        },
        take: 20,
      });

      return res.json({
        success: true,
        count: pendingPayments.length,
        data: pendingPayments.map((p) => ({
          id: p.id,
          mercado_pago_id: p.mercado_pago_id,
          amount: p.transaction_amount,
          method: p.payment_method,
          created_at: p.created_at,
          order: {
            id: p.order.id,
            total: p.order.grand_total,
            user: p.order.user.name,
          },
        })),
      });
    } catch (error) {
      logger.error("❌ [TEST] Erro ao listar pagamentos:", error);
      return res.status(500).json({
        error: "Erro ao listar pagamentos",
      });
    }
  }
}
