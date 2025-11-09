import { Request, Response } from "express";
import PaymentService from "../services/paymentService";
import prisma from "../database/prisma";

export class PaymentController {
  /**
   * Cria uma preferência de pagamento para Checkout Pro
   */
  static async createPreference(req: Request, res: Response) {
    try {
      const { orderId, payerEmail, payerName, payerPhone } = req.body;
      const userId = (req as any).user?.id; // Assumindo middleware de autenticação

      if (!orderId || !payerEmail || !userId) {
        return res.status(400).json({
          error: "Dados obrigatórios não fornecidos",
          required: ["orderId", "payerEmail"],
        });
      }

      const preference = await PaymentService.createPreference({
        orderId,
        userId,
        payerEmail,
        payerName,
        payerPhone,
      });

      res.status(201).json({
        success: true,
        data: preference,
      });
    } catch (error) {
      console.error("Erro ao criar preferência:", error);
      res.status(500).json({
        error: "Falha ao criar preferência de pagamento",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Cria um pagamento direto (Checkout API)
   */
  static async createPayment(req: Request, res: Response) {
    try {
      const {
        orderId,
        amount,
        description,
        payerEmail,
        payerName,
        payerPhone,
        paymentMethodId,
        installments,
        token,
      } = req.body;

      const userId = (req as any).user?.id;

      if (!orderId || !payerEmail || !userId) {
        return res.status(400).json({
          error: "Dados obrigatórios não fornecidos",
          required: ["orderId", "payerEmail"],
        });
      }

      const payment = await PaymentService.createPayment({
        orderId,
        userId,
        amount:
          amount !== undefined && amount !== null ? Number(amount) : undefined,
        description,
        payerEmail,
        payerName,
        payerPhone,
        paymentMethodId,
        installments:
          installments !== undefined && installments !== null
            ? Number(installments)
            : undefined,
        token,
      });

      res.status(201).json({
        success: true,
        data: payment,
      });
    } catch (error) {
      console.error("Erro ao criar pagamento:", error);
      res.status(500).json({
        error: "Falha ao criar pagamento",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Processa pagamento via Checkout Transparente
   * Endpoint para processar pagamentos diretamente na aplicação
   */
  static async processTransparentCheckout(req: Request, res: Response) {
    try {
      const {
        orderId,
        payerEmail,
        payerName,
        payerDocument,
        payerDocumentType,
        paymentMethodId,
        cardToken,
        cardholderName,
        installments,
        issuer_id,
        payment_method_id,
      } = req.body;

      const userId = (req as any).user?.id;

      if (!orderId || !payerEmail || !payerName || !userId) {
        return res.status(400).json({
          error: "Dados obrigatórios não fornecidos",
          required: ["orderId", "payerEmail", "payerName"],
        });
      }

      if (!payerDocument || !payerDocumentType) {
        return res.status(400).json({
          error: "Documento do pagador é obrigatório",
          required: ["payerDocument", "payerDocumentType"],
        });
      }

      if (
        !paymentMethodId ||
        !["pix", "credit_card", "debit_card"].includes(paymentMethodId)
      ) {
        return res.status(400).json({
          error: "Método de pagamento inválido",
          allowed: ["pix", "credit_card", "debit_card"],
        });
      }

      // Se for cartão, exigir token
      if (
        (paymentMethodId === "credit_card" ||
          paymentMethodId === "debit_card") &&
        !cardToken
      ) {
        return res.status(400).json({
          error: "Token do cartão é obrigatório para pagamentos com cartão",
          required: ["cardToken"],
        });
      }

      const payment = await PaymentService.processTransparentCheckout({
        orderId,
        userId,
        payerEmail,
        payerName,
        payerDocument,
        payerDocumentType,
        paymentMethodId,
        cardToken,
        cardholderName,
        installments: installments ? Number(installments) : 1,
        issuer_id,
        payment_method_id,
      });

      res.status(201).json({
        success: true,
        data: payment,
        message:
          paymentMethodId === "pix"
            ? "Pagamento PIX gerado. Escaneie o QR Code para pagar."
            : "Pagamento processado com sucesso!",
      });
    } catch (error) {
      console.error("Erro ao processar checkout transparente:", error);
      res.status(500).json({
        error: "Falha ao processar pagamento",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Consulta status de um pagamento
   */
  static async getPaymentStatus(req: Request, res: Response) {
    try {
      const { paymentId } = req.params;
      const userId = (req as any).user?.id;

      if (!paymentId) {
        return res.status(400).json({
          error: "ID do pagamento é obrigatório",
        });
      }

      // Buscar pagamento no banco local
      const dbPayment = await prisma.payment.findFirst({
        where: {
          OR: [{ id: paymentId }, { mercado_pago_id: paymentId }],
        },
        include: {
          order: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!dbPayment) {
        return res.status(404).json({
          error: "Pagamento não encontrado",
        });
      }

      // Verificar se o usuário tem permissão para ver este pagamento
      if (dbPayment.order.user_id !== userId) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      // Buscar dados atualizados no Mercado Pago se necessário
      let mercadoPagoData = null;
      if (dbPayment.mercado_pago_id) {
        try {
          mercadoPagoData = await PaymentService.getPayment(
            dbPayment.mercado_pago_id
          );
        } catch (error) {
          console.warn("Não foi possível buscar dados do Mercado Pago:", error);
        }
      }

      res.json({
        success: true,
        data: {
          id: dbPayment.id,
          mercado_pago_id: dbPayment.mercado_pago_id,
          status: dbPayment.status,
          amount: dbPayment.transaction_amount,
          payment_method: dbPayment.payment_method,
          payment_type: dbPayment.payment_type,
          created_at: dbPayment.created_at,
          approved_at: dbPayment.approved_at,
          order: {
            id: dbPayment.order.id,
            total: dbPayment.order.total,
            shipping_price: dbPayment.order.shipping_price,
            discount: dbPayment.order.discount,
            grand_total: dbPayment.order.grand_total,
            payment_method: dbPayment.order.payment_method,
            status: dbPayment.order.status,
          },
          mercado_pago_data: mercadoPagoData,
        },
      });
    } catch (error) {
      console.error("Erro ao consultar status do pagamento:", error);
      res.status(500).json({
        error: "Falha ao consultar status do pagamento",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  static async handleWebhook(req: Request, res: Response) {
    try {
      const webhookData = req.body;
      const headers = req.headers;

      await PaymentService.processWebhookNotification(webhookData, headers);

      res.status(200).json({ received: true });
    } catch (error) {
      console.error("Erro ao processar webhook:", error);
      res.status(500).json({
        error: "Falha ao processar webhook",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  static async cancelPayment(req: Request, res: Response) {
    try {
      const { paymentId } = req.params;
      const { reason } = req.body;
      const userId = (req as any).user?.id;

      if (!paymentId) {
        return res.status(400).json({
          error: "ID do pagamento é obrigatório",
        });
      }

      const dbPayment = await prisma.payment.findFirst({
        where: {
          OR: [{ id: paymentId }, { mercado_pago_id: paymentId }],
        },
        include: {
          order: true,
        },
      });

      if (!dbPayment) {
        return res.status(404).json({
          error: "Pagamento não encontrado",
        });
      }

      if (dbPayment.order.user_id !== userId) {
        return res.status(403).json({
          error: "Acesso negado",
        });
      }

      if (!dbPayment.mercado_pago_id) {
        return res.status(400).json({
          error: "Pagamento não pode ser cancelado",
        });
      }

      const cancelResult = await PaymentService.cancelPayment(
        dbPayment.mercado_pago_id,
        reason
      );

      res.json({
        success: true,
        data: cancelResult,
      });
    } catch (error) {
      console.error("Erro ao cancelar pagamento:", error);
      res.status(500).json({
        error: "Falha ao cancelar pagamento",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  static async getUserPayments(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { page = "1", limit = "10", status } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {
        order: {
          user_id: userId,
        },
      };

      if (status) {
        where.status = status;
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          include: {
            order: {
              include: {
                items: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
          orderBy: {
            created_at: "desc",
          },
          skip,
          take: limitNum,
        }),
        prisma.payment.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          payments,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        },
      });
    } catch (error) {
      console.error("Erro ao buscar pagamentos do usuário:", error);
      res.status(500).json({
        error: "Falha ao buscar pagamentos",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Busca resumo financeiro (admin apenas)
   */
  static async getFinancialSummary(req: Request, res: Response) {
    try {
      const { startDate, endDate, period = "daily" } = req.query;

      // Verificar se é admin (implementar verificação de role)
      const isAdmin = (req as any).user?.role === "admin"; // Assumindo role no user
      if (!isAdmin) {
        return res.status(403).json({
          error: "Acesso negado - apenas administradores",
        });
      }

      let start = new Date();
      let end = new Date();

      if (startDate && endDate) {
        start = new Date(startDate as string);
        end = new Date(endDate as string);
      } else {
        // Default: últimos 30 dias
        start.setDate(start.getDate() - 30);
      }

      const summary = await prisma.financialSummary.findMany({
        where: {
          date: {
            gte: start,
            lte: end,
          },
        },
        orderBy: {
          date: "desc",
        },
      });

      // Calcular totais
      const totals = summary.reduce(
        (acc, day) => ({
          total_sales: acc.total_sales + day.total_sales,
          total_net_revenue: acc.total_net_revenue + day.total_net_revenue,
          total_fees: acc.total_fees + day.total_fees,
          total_orders: acc.total_orders + day.total_orders,
          approved_orders: acc.approved_orders + day.approved_orders,
          canceled_orders: acc.canceled_orders + day.canceled_orders,
          pending_orders: acc.pending_orders + day.pending_orders,
          total_products_sold:
            acc.total_products_sold + day.total_products_sold,
          total_additionals_sold:
            acc.total_additionals_sold + day.total_additionals_sold,
        }),
        {
          total_sales: 0,
          total_net_revenue: 0,
          total_fees: 0,
          total_orders: 0,
          approved_orders: 0,
          canceled_orders: 0,
          pending_orders: 0,
          total_products_sold: 0,
          total_additionals_sold: 0,
        }
      );

      res.json({
        success: true,
        data: {
          period: {
            start,
            end,
          },
          daily_summary: summary,
          totals,
        },
      });
    } catch (error) {
      console.error("Erro ao buscar resumo financeiro:", error);
      res.status(500).json({
        error: "Falha ao buscar resumo financeiro",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  /**
   * Páginas de retorno do checkout
   */
  static async paymentSuccess(req: Request, res: Response) {
    try {
      const { payment_id, status, external_reference } = req.query;

      res.send(`
        <html>
          <head>
            <title>Pagamento Aprovado - Cesto d'Amore</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .success { color: #28a745; }
            </style>
          </head>
          <body>
            <h1 class="success">✅ Pagamento Aprovado!</h1>
            <p>Seu pagamento foi processado com sucesso.</p>
            <p><strong>ID do Pagamento:</strong> ${payment_id}</p>
            <p><strong>Status:</strong> ${status}</p>
            <p><strong>Referência:</strong> ${external_reference}</p>
            <button onclick="window.close()">Fechar</button>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).send("Erro ao processar retorno do pagamento");
    }
  }

  static async paymentFailure(req: Request, res: Response) {
    try {
      const { payment_id, status, external_reference } = req.query;

      res.send(`
        <html>
          <head>
            <title>Pagamento Falhou - Cesto d'Amore</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <h1 class="error">❌ Pagamento Não Autorizado</h1>
            <p>Não foi possível processar seu pagamento.</p>
            <p><strong>ID do Pagamento:</strong> ${payment_id}</p>
            <p><strong>Status:</strong> ${status}</p>
            <p><strong>Referência:</strong> ${external_reference}</p>
            <button onclick="window.close()">Fechar</button>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).send("Erro ao processar retorno do pagamento");
    }
  }

  static async paymentPending(req: Request, res: Response) {
    try {
      const { payment_id, status, external_reference } = req.query;

      res.send(`
        <html>
          <head>
            <title>Pagamento Pendente - Cesto d'Amore</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .pending { color: #ffc107; }
            </style>
          </head>
          <body>
            <h1 class="pending">⏳ Pagamento Pendente</h1>
            <p>Seu pagamento está sendo processado.</p>
            <p><strong>ID do Pagamento:</strong> ${payment_id}</p>
            <p><strong>Status:</strong> ${status}</p>
            <p><strong>Referência:</strong> ${external_reference}</p>
            <button onclick="window.close()">Fechar</button>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).send("Erro ao processar retorno do pagamento");
    }
  }

  /**
   * Health check da integração com Mercado Pago
   */
  static async healthCheck(req: Request, res: Response) {
    try {
      const healthResult = await PaymentService.healthCheck();

      res.json({
        success: true,
        data: healthResult,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
      });
    } catch (error) {
      console.error("Erro no health check:", error);
      res.status(500).json({
        success: false,
        error: "Falha no health check",
        details: error instanceof Error ? error.message : "Erro desconhecido",
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export default PaymentController;
