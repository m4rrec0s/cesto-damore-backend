import { Request, Response } from "express";
import whatsappService from "../services/whatsappService";

class WhatsAppController {
  /**
   * POST /whatsapp/test
   * Testa o envio de mensagem WhatsApp
   */
  async testMessage(req: Request, res: Response) {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          error: "Mensagem não fornecida",
        });
      }

      if (!whatsappService.isConfigured()) {
        return res.status(503).json({
          error: "WhatsApp não configurado",
          message:
            "Configure as variáveis de ambiente EVOLUTION_API_KEY, EVOLUTION_API_URL, etc.",
        });
      }

      const sent = await whatsappService.sendMessage(message);

      if (sent) {
        return res.json({
          success: true,
          message: "Mensagem enviada com sucesso",
        });
      } else {
        return res.status(500).json({
          success: false,
          error: "Falha ao enviar mensagem",
        });
      }
    } catch (error: any) {
      console.error("Erro ao testar mensagem WhatsApp:", error);
      return res.status(500).json({
        error: "Erro ao testar mensagem",
        message: error.message,
      });
    }
  }

  /**
   * POST /whatsapp/check-stock
   * Verifica estoque e envia alertas se necessário
   */
  async checkStock(req: Request, res: Response) {
    try {
      const threshold = parseInt(req.query.threshold as string) || 5;

      if (!whatsappService.isConfigured()) {
        return res.status(503).json({
          error: "WhatsApp não configurado",
          message:
            "Configure as variáveis de ambiente para habilitar notificações",
        });
      }

      const result = await whatsappService.checkAndNotifyLowStock(threshold);

      return res.json({
        success: result.checked,
        alerts_sent: result.alerts_sent,
        errors: result.errors,
        message: `Verificação concluída. ${result.alerts_sent} alertas enviados.`,
      });
    } catch (error: any) {
      console.error("Erro ao verificar estoque:", error);
      return res.status(500).json({
        error: "Erro ao verificar estoque",
        message: error.message,
      });
    }
  }

  /**
   * POST /whatsapp/stock-summary
   * Envia resumo completo de estoque
   */
  async sendStockSummary(req: Request, res: Response) {
    try {
      if (!whatsappService.isConfigured()) {
        return res.status(503).json({
          error: "WhatsApp não configurado",
          message:
            "Configure as variáveis de ambiente para habilitar notificações",
        });
      }

      const sent = await whatsappService.sendStockSummary();

      if (sent) {
        return res.json({
          success: true,
          message: "Resumo de estoque enviado com sucesso",
        });
      } else {
        return res.status(500).json({
          success: false,
          error: "Falha ao enviar resumo",
        });
      }
    } catch (error: any) {
      console.error("Erro ao enviar resumo:", error);
      return res.status(500).json({
        error: "Erro ao enviar resumo",
        message: error.message,
      });
    }
  }

  /**
   * GET /whatsapp/config
   * Verifica status da configuração
   */
  async getConfig(req: Request, res: Response) {
    try {
      const isConfigured = whatsappService.isConfigured();

      return res.json({
        configured: isConfigured,
        message: isConfigured
          ? "WhatsApp está configurado e pronto para uso"
          : "WhatsApp não configurado. Adicione as variáveis de ambiente necessárias.",
        required_env_vars: [
          "EVOLUTION_API_KEY",
          "EVOLUTION_API_URL",
          "EVOLUTION_INSTANCE",
          "WHATSAPP_GROUP_ID",
        ],
      });
    } catch (error: any) {
      console.error("Erro ao verificar configuração:", error);
      return res.status(500).json({
        error: "Erro ao verificar configuração",
        message: error.message,
      });
    }
  }
}

export default new WhatsAppController();
