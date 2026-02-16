import logger from "../utils/logger";

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
  

  async sendAlert(data: AlertData): Promise<void> {

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

  }

  

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

  

  private async sendToSlack(data: AlertData): Promise<void> {

  }
}

export default new AlertService();
