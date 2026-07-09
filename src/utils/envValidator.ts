import logger from "./logger";

export const validateEnv = () => {
  if (!process.env.API_KEY && process.env.AI_AGENT_API_KEY) {
    process.env.API_KEY = process.env.AI_AGENT_API_KEY;
    logger.warn(
      "⚠️ API_KEY não definida; usando temporariamente o valor de AI_AGENT_API_KEY.",
    );
  }

  const requiredEnvVars = [
    "DATABASE_URL",
    "JWT_SECRET",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_PROJECT_ID",
    "GOOGLE_CLIENT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "API_KEY",
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

  // Meta Conversions API (optional — disables tracking if missing)
  const optionalMetaVars = ["META_PIXEL_ID", "META_ACCESS_TOKEN"];
  const missingMeta = optionalMetaVars.filter((v) => !process.env[v]);
  if (missingMeta.length > 0) {
    logger.warn(
      `⚠️ Variáveis Meta não definidas (${missingMeta.join(", ")}). Rastreamento Meta Conversions desabilitado.`,
    );
  } else {
    logger.info("✅ Meta Conversions API configurada.");
  }
};
