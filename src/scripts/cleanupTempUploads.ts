import tempUploadService from "../services/tempUploadService";
import logger from "../utils/logger";

async function runCleanup() {
  logger.info(
    "🧹 ========== INICIANDO LIMPEZA DE UPLOADS TEMPORÁRIOS ==========",
  );

  const startTime = Date.now();

  try {
    const result = await tempUploadService.cleanupExpiredUploads();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info("✅ ========== LIMPEZA CONCLUÍDA ==========");
    logger.info(`📊 Arquivos deletados: ${result.deletedCount}`);
    logger.info(
      `📦 Espaço liberado: ${(result.deletedSize / 1024 / 1024).toFixed(2)}MB`,
    );
    logger.info(`⏱️ Tempo decorrido: ${duration}s`);

    if (result.errors.length > 0) {
      logger.warn(`⚠️ ${result.errors.length} erros encontrados:`);
      result.errors.forEach((err) => logger.warn(`  - ${err}`));
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
      duration: `${duration}s`,
    };
  } catch (error) {
    logger.error("❌ ========== ERRO NA LIMPEZA ==========");
    logger.error(error);

    throw error;
  }
}

if (require.main === module) {
  runCleanup()
    .then((result) => {
      console.log("\n✅ Resultado:", JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      logger.error("\n❌ Erro:", error);
      process.exit(1);
    });
}

export default runCleanup;
