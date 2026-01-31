import prisma from "../database/prisma";
import logger from "../utils/logger";
import PaymentService from "./paymentService";

/**
 * 🔥 NOVO: Serviço para gerenciar jobs agendados (cron jobs)
 * Executa tarefas periódicas de manutenção e monitoramento
 */

class ScheduledJobsService {
  private webhookReplayInterval: NodeJS.Timeout | null = null;
  private driveRetryInterval: NodeJS.Timeout | null = null;
  private backupCleanupInterval: NodeJS.Timeout | null = null; // 🔥 NOVO

  /**
   * Inicia todos os jobs agendados
   */
  start() {
    logger.info("🕐 Iniciando scheduled jobs...");

    // Job 1: Reprocessar webhooks offline a cada 5 minutos
    this.startWebhookReplayJob();

    // Job 2: Reenviar links do Google Drive pendentes a cada 10 minutos
    this.startDriveRetryJob();

    // 🔥 NOVO: Job 3: Limpar backups antigos a cada 24 horas
    this.startBackupCleanupJob();

    logger.info("✅ Scheduled jobs iniciados");
  }

  /**
   * Para todos os jobs agendados
   */
  stop() {
    logger.info("⏹️ Parando scheduled jobs...");

    if (this.webhookReplayInterval) {
      clearInterval(this.webhookReplayInterval);
      this.webhookReplayInterval = null;
    }

    if (this.driveRetryInterval) {
      clearInterval(this.driveRetryInterval);
      this.driveRetryInterval = null;
    }

    // 🔥 NOVO
    if (this.backupCleanupInterval) {
      clearInterval(this.backupCleanupInterval);
      this.backupCleanupInterval = null;
    }

    logger.info("✅ Scheduled jobs parados");
  }

  /**
   * 🔥 Job 1: Reprocessar webhooks armazenados offline
   * Executa a cada 5 minutos
   */
  private startWebhookReplayJob() {
    const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

    logger.info(
      `🔄 Agendando reprocessamento de webhooks offline (intervalo: ${INTERVAL_MS / 1000}s)`,
    );

    // Executar imediatamente na inicialização
    this.replayOfflineWebhooks();

    // Agendar execução periódica
    this.webhookReplayInterval = setInterval(() => {
      this.replayOfflineWebhooks();
    }, INTERVAL_MS);
  }

  /**
   * Executa reprocessamento de webhooks offline
   */
  private async replayOfflineWebhooks() {
    try {
      logger.debug("🔍 Verificando webhooks offline armazenados...");
      await PaymentService.replayStoredWebhooks();
      logger.debug("✅ Verificação de webhooks offline concluída");
    } catch (error) {
      logger.error("❌ Erro ao reprocessar webhooks offline:", error);
    }
  }

  /**
   * 🔥 Job 2: Reenviar links do Google Drive para pedidos aprovados
   * Executa a cada 10 minutos
   */
  private startDriveRetryJob() {
    const INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

    logger.info(
      `📁 Agendando reenvio de links do Drive pendentes (intervalo: ${INTERVAL_MS / 1000}s)`,
    );

    // Executar após 2 minutos da inicialização (dar tempo para o sistema estabilizar)
    setTimeout(
      () => {
        this.retryPendingDriveLinks();

        // Agendar execução periódica
        this.driveRetryInterval = setInterval(() => {
          this.retryPendingDriveLinks();
        }, INTERVAL_MS);
      },
      2 * 60 * 1000,
    );
  }

  /**
   * Busca pedidos aprovados sem link do Drive e tenta finalizar novamente
   */
  private async retryPendingDriveLinks() {
    try {
      logger.debug("🔍 Buscando pedidos aprovados sem link do Drive...");

      // Buscar pedidos PAID sem google_drive_folder_url
      // criados nas últimas 48 horas (evitar reprocessar muito antigos)
      const twoDaysAgo = new Date();
      twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);

      const ordersWithoutDriveLink = await prisma.order.findMany({
        where: {
          status: "PAID",
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
        take: 10, // Processar no máximo 10 por vez para não sobrecarregar
        orderBy: {
          created_at: "asc", // Mais antigos primeiro
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
          // Verificar se ordem tem customizações que precisam de Drive
          const hasCustomizations = order.items.some(
            (item) => item.customizations.length > 0,
          );

          if (!hasCustomizations) {
            logger.debug(
              `⏭️ Pedido ${order.id} não tem customizações, pulando`,
            );

            // Marcar como processado para não ficar verificando sempre
            await prisma.order.update({
              where: { id: order.id },
              data: { customizations_drive_processed: true },
            });

            continue;
          }

          logger.info(
            `🔄 Tentando finalizar customizações do pedido ${order.id}...`,
          );

          // Importar dinamicamente para evitar dependência circular
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

            // Enviar notificação ao cliente com o link
            if (order.user?.phone) {
              const whatsappService = (await import("./whatsappService"))
                .default;

              await whatsappService.sendDirectMessage(
                order.user.phone,
                `🎉 *Suas personalizações estão prontas!*\n\n` +
                  `Pedido: #${order.id.substring(0, 8).toUpperCase()}\n\n` +
                  `📁 Acesse suas fotos:\n${result.folderUrl}\n\n` +
                  `_Obrigado pela preferência!_\n` +
                  `Equipe Cesto d'Amore ❤️`,
              );

              logger.info(
                `📱 Notificação WhatsApp enviada para ${order.user.name}`,
              );
            }
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
          // Continuar com próximo pedido mesmo em caso de erro
        }
      }

      logger.info(
        `✅ Processamento de links do Drive concluído (${ordersWithoutDriveLink.length} pedidos)`,
      );
    } catch (error) {
      logger.error("❌ Erro ao reprocessar links do Drive:", error);
    }
  }

  /**
   * 🔥 NOVO: Job manual para forçar reenvio de link específico
   * Útil para casos de suporte/emergência
   */
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

      // Importar dinamicamente para evitar dependência circular
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

      // Enviar notificação
      if (order.user?.phone) {
        const whatsappService = (await import("./whatsappService")).default;

        await whatsappService.sendDirectMessage(
          order.user.phone,
          `🎉 *Suas personalizações estão prontas!*\n\n` +
            `Pedido: #${orderId.substring(0, 8).toUpperCase()}\n\n` +
            `📁 Acesse suas fotos:\n${result.folderUrl}\n\n` +
            `_Obrigado pela preferência!_\n` +
            `Equipe Cesto d'Amore ❤️`,
        );
      }

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

  /**
   * Status dos jobs agendados
   */
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

  /**
   * 🔥 NOVO: Job 3: Limpar backups antigos
   * Executa a cada 24 horas, mantém backups por 7 dias
   */
  private startBackupCleanupJob() {
    const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas

    logger.info(
      `🗑️ Agendando limpeza de backups antigos (intervalo: ${INTERVAL_MS / 1000 / 60 / 60}h)`,
    );

    // Executar após 1 hora da inicialização
    setTimeout(
      () => {
        this.cleanupOldBackups();

        // Agendar execução periódica
        this.backupCleanupInterval = setInterval(() => {
          this.cleanupOldBackups();
        }, INTERVAL_MS);
      },
      60 * 60 * 1000,
    );
  }

  /**
   * Remove backups com mais de 7 dias
   */
  private async cleanupOldBackups() {
    try {
      logger.debug("🔍 Verificando backups antigos...");

      const fs = await import("fs");
      const path = await import("path");

      const baseStorageDir = path.join(process.cwd(), "storage");

      const backupDir = path.join(baseStorageDir, "backup");

      // Verificar se diretório existe
      if (!fs.existsSync(backupDir)) {
        logger.debug("📁 Diretório de backup não existe, nada a limpar");
        return;
      }

      const files = fs.readdirSync(backupDir);
      // ✅ NOVO: Aumentado para 30 dias (customizações finais devem persistir por mais tempo)
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      let deletedCount = 0;
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);

        // Verificar se arquivo é antigo o suficiente (30 dias)
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

// Exportar singleton
export default new ScheduledJobsService();
