import prisma from "../database/prisma";
import logger from "../utils/logger";
import PaymentService from "./paymentService";
import trendStatsService from "./trendStatsService";

class ScheduledJobsService {
  private webhookReplayInterval: NodeJS.Timeout | null = null;
  private pixReconcileInterval: NodeJS.Timeout | null = null;
  private driveRetryInterval: NodeJS.Timeout | null = null;
  private backupCleanupInterval: NodeJS.Timeout | null = null;
  private trendStatsInterval: NodeJS.Timeout | null = null;

  

  start() {
    logger.info("🕐 Iniciando scheduled jobs...");

    this.startWebhookReplayJob();
    this.startPendingPixReconcileJob();

    this.startDriveRetryJob();

    this.startBackupCleanupJob();

    this.startTrendStatsJob();

    logger.info("✅ Scheduled jobs iniciados");
  }

  

  stop() {
    logger.info("⏹️ Parando scheduled jobs...");

    if (this.webhookReplayInterval) {
      clearInterval(this.webhookReplayInterval);
      this.webhookReplayInterval = null;
    }

    if (this.pixReconcileInterval) {
      clearInterval(this.pixReconcileInterval);
      this.pixReconcileInterval = null;
    }

    if (this.driveRetryInterval) {
      clearInterval(this.driveRetryInterval);
      this.driveRetryInterval = null;
    }

    if (this.backupCleanupInterval) {
      clearInterval(this.backupCleanupInterval);
      this.backupCleanupInterval = null;
    }

    if (this.trendStatsInterval) {
      clearInterval(this.trendStatsInterval);
      this.trendStatsInterval = null;
    }

    logger.info("✅ Scheduled jobs parados");
  }

  

  private startWebhookReplayJob() {
    const INTERVAL_MS = 5 * 60 * 1000;

    logger.info(
      `🔄 Agendando reprocessamento de webhooks offline (intervalo: ${INTERVAL_MS / 1000}s)`,
    );

    this.replayOfflineWebhooks();

    this.webhookReplayInterval = setInterval(() => {
      this.replayOfflineWebhooks();
    }, INTERVAL_MS);
  }

  

  private async replayOfflineWebhooks() {
    try {
      logger.debug("🔍 Verificando webhooks offline armazenados...");
      await PaymentService.replayStoredWebhooks();
      logger.debug("✅ Verificação de webhooks offline concluída");
    } catch (error) {
      logger.error("❌ Erro ao reprocessar webhooks offline:", error);
    }
  }

  private startPendingPixReconcileJob() {
    const INTERVAL_MS = 60 * 1000;

    logger.info(
      `💳 Agendando reconciliação PIX pendente (intervalo: ${INTERVAL_MS / 1000}s)`,
    );

    this.reconcilePendingPixPayments();

    this.pixReconcileInterval = setInterval(() => {
      this.reconcilePendingPixPayments();
    }, INTERVAL_MS);
  }

  private async reconcilePendingPixPayments() {
    try {
      const result = await PaymentService.reconcilePendingPixPayments({
        limit: 30,
        maxAgeHours: 72,
      });

      if (result.reprocessed > 0) {
        logger.info(
          `✅ Reconciliação PIX: ${result.reprocessed}/${result.scanned} pagamento(s) atualizado(s)`,
        );
      } else {
        logger.debug(
          `🔍 Reconciliação PIX executada sem mudanças (${result.scanned} verificados)`,
        );
      }
    } catch (error) {
      logger.error("❌ Erro na reconciliação PIX pendente:", error);
    }
  }

  

  private startDriveRetryJob() {
    const INTERVAL_MS = 10 * 60 * 1000;

    logger.info(
      `📁 Agendando reenvio de links do Drive pendentes (intervalo: ${INTERVAL_MS / 1000}s)`,
    );

    setTimeout(
      () => {
        this.retryPendingDriveLinks();

        this.driveRetryInterval = setInterval(() => {
          this.retryPendingDriveLinks();
        }, INTERVAL_MS);
      },
      2 * 60 * 1000,
    );
  }

  

  private async retryPendingDriveLinks() {
    try {
      logger.debug("🔍 Buscando pedidos aprovados sem link do Drive...");

      const twoDaysAgo = new Date();
      twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);

      const ordersWithoutDriveLink = await prisma.order.findMany({
        where: {
          status: { in: ["PAID", "PAID_STOCK_FAILED"] },
          google_drive_folder_url: null,
          created_at: {
            gte: twoDaysAgo,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          payment: {
            select: {
              id: true,
              status: true,
              mercado_pago_id: true,
            },
          },
          items: {
            include: {
              customizations: {
                select: {
                  id: true,
                  value: true,
                },
              },
            },
          },
        },
        take: 10,
        orderBy: {
          created_at: "asc",
        },
      });

      if (ordersWithoutDriveLink.length === 0) {
        logger.debug("✅ Nenhum pedido pendente de link do Drive");
        return;
      }

      logger.info(
        `📁 Encontrados ${ordersWithoutDriveLink.length} pedido(s) sem link do Drive`,
      );

      for (const order of ordersWithoutDriveLink) {
        try {

          const hasCustomizations = order.items.some(
            (item) => item.customizations.length > 0,
          );

          if (!hasCustomizations) {
            logger.debug(
              `⏭️ Pedido ${order.id} não tem customizações, pulando`,
            );

            await prisma.order.update({
              where: { id: order.id },
              data: { customizations_drive_processed: true },
            });

            continue;
          }

          logger.info(
            `🔄 Tentando finalizar customizações do pedido ${order.id}...`,
          );

          const { default: orderCustomizationService } =
            await import("./orderCustomizationService");

          const result =
            await orderCustomizationService.finalizeOrderCustomizations(
              order.id,
            );

          if (result.folderUrl) {
            logger.info(
              `✅ Link do Drive gerado para pedido ${order.id}: ${result.folderUrl}`,
            );
            await PaymentService.sendCustomizationReadyNotificationOnce(
              order.id,
              result.folderUrl,
            );
          } else {
            logger.warn(
              `⚠️ Finalização do pedido ${order.id} não gerou link do Drive`,
            );
          }
        } catch (error) {
          logger.error(
            `❌ Erro ao processar pedido ${order.id}:`,
            error instanceof Error ? error.message : error,
          );

        }
      }

      logger.info(
        `✅ Processamento de links do Drive concluído (${ordersWithoutDriveLink.length} pedidos)`,
      );
    } catch (error) {
      logger.error("❌ Erro ao reprocessar links do Drive:", error);
    }
  }

  

  private startTrendStatsJob() {
    const INTERVAL_MS = 24 * 60 * 60 * 1000;

    logger.info(
      `📊 Agendando atualizacao de tendencias (intervalo: ${INTERVAL_MS / 1000}s)`,
    );

    trendStatsService.refreshRollingTrends();

    this.trendStatsInterval = setInterval(() => {
      trendStatsService.refreshRollingTrends();
    }, INTERVAL_MS);
  }

  

  async forceRetryOrder(orderId: string): Promise<{
    success: boolean;
    message: string;
    driveUrl?: string;
  }> {
    try {
      logger.info(`🔧 Forçando retry manual do pedido ${orderId}...`);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            select: {
              phone: true,
              name: true,
            },
          },
        },
      });

      if (!order) {
        return {
          success: false,
          message: "Pedido não encontrado",
        };
      }

      const { default: orderCustomizationService } =
        await import("./orderCustomizationService");

      const result =
        await orderCustomizationService.finalizeOrderCustomizations(orderId);

      if (!result.folderUrl) {
        return {
          success: false,
          message: "Finalização não gerou link do Drive",
        };
      }

      await PaymentService.sendCustomizationReadyNotificationOnce(
        orderId,
        result.folderUrl,
      );

      return {
        success: true,
        message: "Link gerado e enviado com sucesso",
        driveUrl: result.folderUrl,
      };
    } catch (error) {
      logger.error(`❌ Erro no retry manual do pedido ${orderId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Erro desconhecido",
      };
    }
  }

  

  getStatus() {
    return {
      webhookReplayJob: {
        running: this.webhookReplayInterval !== null,
        interval: "5 minutes",
      },
      driveRetryJob: {
        running: this.driveRetryInterval !== null,
        interval: "10 minutes",
      },
      backupCleanupJob: {
        running: this.backupCleanupInterval !== null,
        interval: "24 hours",
      },
    };
  }

  

  private startBackupCleanupJob() {
    const INTERVAL_MS = 24 * 60 * 60 * 1000;

    logger.info(
      `🗑️ Agendando limpeza de backups antigos (intervalo: ${INTERVAL_MS / 1000 / 60 / 60}h)`,
    );

    setTimeout(
      () => {
        this.cleanupOldBackups();

        this.backupCleanupInterval = setInterval(() => {
          this.cleanupOldBackups();
        }, INTERVAL_MS);
      },
      60 * 60 * 1000,
    );
  }

  

  private async cleanupOldBackups() {
    try {
      logger.debug("🔍 Verificando backups antigos...");

      const fs = await import("fs");
      const path = await import("path");

      const baseStorageDir = path.join(process.cwd(), "storage");

      const backupDir = path.join(baseStorageDir, "backup");

      if (!fs.existsSync(backupDir)) {
        logger.debug("📁 Diretório de backup não existe, nada a limpar");
        return;
      }

      const files = fs.readdirSync(backupDir);

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      let deletedCount = 0;
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtimeMs < thirtyDaysAgo) {
          try {
            totalSize += stats.size;
            fs.unlinkSync(filePath);
            deletedCount++;
            logger.debug(`🗑️ Backup deletado: ${file}`);
          } catch (err) {
            logger.warn(`⚠️ Erro ao deletar backup ${file}:`, err);
          }
        }
      }

      if (deletedCount > 0) {
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        logger.info(
          `✅ Limpeza de backups concluída: ${deletedCount} arquivo(s) deletado(s), ${sizeMB} MB liberados`,
        );
      } else {
        logger.debug("✅ Nenhum backup antigo para deletar");
      }
    } catch (error) {
      logger.error("❌ Erro ao limpar backups antigos:", error);
    }
  }
}

export default new ScheduledJobsService();
