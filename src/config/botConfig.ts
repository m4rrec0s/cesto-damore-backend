export const BOT_CONFIG = {
  dynamicMenuGeneration: {
    enabled: process.env.BOT_DYNAMIC_MENU_ENABLED === "true",
    maxOptions: parseInt(process.env.BOT_DYNAMIC_MENU_MAX_OPTIONS || "4", 10),
    alwaysIncludeMainMenu: true,
    alwaysIncludeEndSupport: true,
    confidenceThreshold: 0.6,
  },
};
