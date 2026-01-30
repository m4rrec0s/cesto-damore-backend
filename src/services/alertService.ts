import logger from "../utils/logger";

/**
 * 🔥 NOVO: Sistema de alertas para monitoramento e notificações
 * Centraliza alertas críticos do sistema
 */

export enum AlertSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

export enum AlertCategory {
  BASE64_RESIDUAL = "base64_residual",
  PAYMENT_PROCESSING = "payment_processing",
  STOCK_CRITICAL = "stock_critical",
  DRIVE_UPLOAD_FAILED = "drive_upload_failed",
  WEBHOOK_FAILURE = "webhook_failure",
}

interface AlertData {
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

class AlertService {
  /**
   * Envia um alerta (pode ser expandido para Slack, Email, SMS, etc.)
   */
  async sendAlert(data: AlertData): Promise<void> {
    // Log sempre
    const logMessage = `[${data.severity.toUpperCase()}] ${data.category}: ${data.title} - ${data.message}`;

    switch (data.severity) {
      case AlertSeverity.CRITICAL:
      case AlertSeverity.ERROR:
        logger.error(logMessage, data.metadata);
        break;
      case AlertSeverity.WARNING:
        logger.warn(logMessage, data.metadata);
        break;
      case AlertSeverity.INFO:
        logger.info(logMessage, data.metadata);
        break;
    }

    // 🔥 TODO: Integrar com Slack, Discord, ou Email
    // Exemplo:
    // if (data.severity === AlertSeverity.CRITICAL) {
    //   await this.sendToSlack(data);
    // }

    // 🔥 TODO: Salvar no banco para dashboard de alertas
    // await prisma.systemAlert.create({ data: ... });
  }

  /**
   * 🔥 NOVO: Alerta específico para base64 residual
   */
  async alertBase64Residual(
    orderId: string,
    customizationIds: string[],
    uploadedFiles: number,
  ): Promise<void> {
    await this.sendAlert({
      category: AlertCategory.BASE64_RESIDUAL,
      severity: AlertSeverity.WARNING,
      title: "Base64 Residual Detectado",
      message: `Pedido ${orderId} finalizado mas contém ${customizationIds.length} customização(ões) com dados base64 não removidos`,
      metadata: {
        orderId,
        customizationIds,
        uploadedFiles,
        affectedCount: customizationIds.length,
      },
      timestamp: new Date(),
    });

    // 🔥 Alerta CRÍTICO se muitos arquivos afetados
    if (customizationIds.length > 3) {
      await this.sendAlert({
        category: AlertCategory.BASE64_RESIDUAL,
        severity: AlertSeverity.CRITICAL,
        title: "CRÍTICO: Múltiplos Base64 Residuais",
        message: `Pedido ${orderId} tem ${customizationIds.length} customizações com base64 residual. Ação manual necessária!`,
        metadata: {
          orderId,
          customizationIds,
          requiresManualIntervention: true,
        },
        timestamp: new Date(),
      });
    }
  }

  /**
   * 🔥 NOVO: Alerta para falha no upload ao Drive
   */
  async alertDriveUploadFailed(
    orderId: string,
    error: string,
    retryCount: number,
  ): Promise<void> {
    await this.sendAlert({
      category: AlertCategory.DRIVE_UPLOAD_FAILED,
      severity: retryCount > 2 ? AlertSeverity.CRITICAL : AlertSeverity.ERROR,
      title: "Falha no Upload Google Drive",
      message: `Pedido ${orderId} - Upload para Drive falhou após ${retryCount} tentativa(s)`,
      metadata: {
        orderId,
        error,
        retryCount,
      },
      timestamp: new Date(),
    });
  }

  /**
   * 🔥 NOVO: Alerta para webhook que falhou após múltiplas tentativas
   */
  async alertWebhookFailure(
    paymentId: string,
    attempts: number,
    lastError: string,
  ): Promise<void> {
    await this.sendAlert({
      category: AlertCategory.WEBHOOK_FAILURE,
      severity: attempts > 5 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
      title: "Webhook Falhando Persistentemente",
      message: `Webhook para pagamento ${paymentId} falhou ${attempts}x`,
      metadata: {
        paymentId,
        attempts,
        lastError,
      },
      timestamp: new Date(),
    });
  }

  /**
   * 🔥 NOVO: Alerta para estoque crítico
   */
  async alertCriticalStock(
    itemId: string,
    itemName: string,
    currentStock: number,
    threshold: number,
  ): Promise<void> {
    await this.sendAlert({
      category: AlertCategory.STOCK_CRITICAL,
      severity:
        currentStock === 0 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
      title: "Estoque Crítico",
      message: `Item "${itemName}" com estoque baixo: ${currentStock} (mínimo: ${threshold})`,
      metadata: {
        itemId,
        itemName,
        currentStock,
        threshold,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Envia alerta para Slack (exemplo de integração futura)
   */
  private async sendToSlack(data: AlertData): Promise<void> {
    // 🔥 TODO: Implementar quando tiver webhook do Slack configurado
    // const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    // if (!webhookUrl) return;
    //
    // const color = {
    //   [AlertSeverity.CRITICAL]: 'danger',
    //   [AlertSeverity.ERROR]: 'danger',
    //   [AlertSeverity.WARNING]: 'warning',
    //   [AlertSeverity.INFO]: 'good',
    // }[data.severity];
    //
    // await fetch(webhookUrl, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     attachments: [{
    //       color,
    //       title: data.title,
    //       text: data.message,
    //       fields: Object.entries(data.metadata || {}).map(([key, value]) => ({
    //         title: key,
    //         value: String(value),
    //         short: true,
    //       })),
    //       ts: Math.floor(data.timestamp.getTime() / 1000),
    //     }],
    //   }),
    // });
  }
}

export default new AlertService();
