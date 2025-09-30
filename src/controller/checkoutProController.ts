import { Request, Response } from "express";
import { checkoutProService } from "../services/checkoutProService";

export class CheckoutProController {
  async createPreference(req: Request, res: Response) {
    try {
      console.log("🛒 Criando preferência Checkout Pro:", req.body);

      const { items, payer, back_urls, auto_return } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "Items são obrigatórios",
          message: "Informe ao menos um item para o checkout",
        });
      }

      // Validar estrutura dos items
      for (const item of items) {
        if (!item.title || !item.unit_price || !item.quantity) {
          return res.status(400).json({
            error: "Item inválido",
            message: "Cada item deve ter title, unit_price e quantity",
          });
        }
      }

      const preference = await checkoutProService.createPreference({
        items,
        payer,
        back_urls,
        auto_return,
      });

      console.log("✅ Preferência criada:", preference.id);

      res.status(201).json({
        success: true,
        data: preference,
        message: "Preferência criada com sucesso",
      });
    } catch (error: any) {
      console.error("❌ Erro ao criar preferência:", error);

      res.status(500).json({
        success: false,
        error: "Erro interno do servidor",
        message: error.message,
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  async handlePaymentWebhook(req: Request, res: Response) {
    try {
      console.log("🔔 Webhook de pagamento recebido:", {
        type: req.body.type,
        action: req.body.action,
        data: req.body.data,
      });

      // Aqui você pode implementar a lógica para processar o webhook
      // Por exemplo, atualizar o status do pedido no banco de dados

      if (req.body.type === "payment" && req.body.data?.id) {
        console.log("💰 Pagamento processado:", req.body.data.id);

        // TODO: Buscar detalhes do pagamento e atualizar pedido
        // const paymentId = req.body.data.id;
        // await this.updateOrderStatus(paymentId);
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("❌ Erro no webhook:", error);
      res.status(500).json({ error: "Erro ao processar webhook" });
    }
  }

  async getPaymentStatus(req: Request, res: Response) {
    try {
      const { payment_id, collection_id, collection_status } = req.query;

      console.log("📊 Consultando status do pagamento:", {
        payment_id,
        collection_id,
        collection_status,
      });

      // Por enquanto, retornar status baseado nos parâmetros
      const status = collection_status || "pending";

      res.json({
        success: true,
        data: {
          payment_id: payment_id || collection_id,
          status,
          message: this.getStatusMessage(status as string),
        },
      });
    } catch (error: any) {
      console.error("❌ Erro ao consultar status:", error);
      res.status(500).json({
        success: false,
        error: "Erro ao consultar status do pagamento",
      });
    }
  }

  private getStatusMessage(status: string): string {
    const messages: Record<string, string> = {
      approved: "Pagamento aprovado",
      pending: "Pagamento pendente",
      rejected: "Pagamento rejeitado",
      cancelled: "Pagamento cancelado",
      in_process: "Pagamento em processamento",
    };

    return messages[status] || "Status desconhecido";
  }
}

export const checkoutProController = new CheckoutProController();
export default checkoutProController;
