export const BOT_CONFIG = {
  dynamicMenuGeneration: {
    enabled: process.env.BOT_DYNAMIC_MENU_ENABLED === "true",
    maxOptions: parseInt(process.env.BOT_DYNAMIC_MENU_MAX_OPTIONS || "4", 10),
    alwaysIncludeMainMenu: true,
    alwaysIncludeEndSupport: true,
    confidenceThreshold: 0.6,
  },
  llmFallback: {
    // LLM completamente desabilitada - usar apenas router determinístico
    enabled: false,
    timeout: parseInt(process.env.BOT_LLM_TIMEOUT_MS || "3000", 10),
  },
  deterministicRouter: {
    minScoreThreshold: 4, // Score mínimo para considerar match válido
    useExpandedSynonyms: true, // Expandir tokens com sinônimos
    logDecisions: process.env.NODE_ENV !== "production", // Log em dev
  },
};
