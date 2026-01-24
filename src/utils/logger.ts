const isDebugEnabled =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_LOGS === "true";

const showInfoLogs = process.env.INFO_LOGS === "true";

const logger = {
  debug: (...args: any[]) => {
    if (isDebugEnabled) {
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    showInfoLogs ? console.info(...args) : null;
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  },
};

export default logger;
