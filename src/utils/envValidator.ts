import logger from "./logger";

export const validateEnv = () => {
  const requiredEnvVars = [
    "DATABASE_URL",
    "JWT_SECRET",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_PROJECT_ID",
    "GOOGLE_CLIENT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "AI_AGENT_API_KEY",
    "BASE_URL",
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    logger.error("❌ ERRO CRÍTICO EM VARIÁVEIS DE AMBIENTE:");
    missingVars.forEach((v) => {
      logger.error(`   - ${v} não está definido.`);
    });

    if (process.env.NODE_ENV === "production") {
      logger.error(
        "🛑 O servidor não pode iniciar em produção sem estas variáveis.",
      );
      process.exit(1);
    } else {
      logger.warn(
        "⚠️ O servidor iniciará em modo desenvolvimento, mas algumas funcionalidades podem falhar.",
      );
    }
  } else {
    logger.info("✅ Variáveis de ambiente validadas com sucesso.");
  }
};
