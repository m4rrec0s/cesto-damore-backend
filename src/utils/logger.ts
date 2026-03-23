import chalk from "chalk";

const isDebugEnabled =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_LOGS === "true";

const showInfoLogs = process.env.INFO_LOGS === "true";

const BRAZIL_TIMEZONE = "America/Sao_Paulo";
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "idtoken",
  "client_secret",
  "apikey",
  "api_key",
  "x-api-key",
  "headers",
  "request",
  "response",
  "config",
  "req",
  "res",
  "stack",
]);

type ColorFunction = (text: string) => string;

interface LoggerContext {
  service?: string;
  context?: string;
  color?:
    | ColorFunction
    | "red"
    | "green"
    | "blue"
    | "yellow"
    | "cyan"
    | "magenta"
    | "white"
    | "gray"
    | "bold";
}

const formatTimestamp = (): string => {
  const now = new Date();
  return new Intl.DateTimeFormat("pt-BR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: BRAZIL_TIMEZONE,
  }).format(now);
};

const formatLogMessage = (
  level: string,
  context: string | undefined,
  message: any,
): string => {
  const timestamp = formatTimestamp();
  const contextStr = context ? chalk.cyan(`[${context}]`) : "";

  const levelColor =
    {
      DEBUG: chalk.blue,
      INFO: chalk.green,
      LOG: chalk.green,
      WARN: chalk.yellow,
      ERROR: chalk.red,
    }[level.toUpperCase()] || chalk.white;

  const levelStr = levelColor(`${level.toUpperCase()}`);
  const typeStr = chalk.gray(
    `[${typeof message === "object" ? "object" : typeof message}]`,
  );

  return `${chalk.dim(timestamp)}  ${levelStr}  ${contextStr}  ${typeStr}`;
};

const isLoggerContext = (arg: any): arg is LoggerContext => {
  return (
    arg &&
    typeof arg === "object" &&
    ("service" in arg || "context" in arg || "color" in arg)
  );
};

const parseColorArg = (
  arg: any,
): { ctx?: LoggerContext; color?: string; isColorArg: boolean } => {
  const validColors = [
    "red",
    "green",
    "blue",
    "yellow",
    "cyan",
    "magenta",
    "white",
    "gray",
    "bold",
  ];

  if (typeof arg === "string" && validColors.includes(arg)) {
    return { color: arg, isColorArg: true };
  }
  if (isLoggerContext(arg)) {
    return { ctx: arg, isColorArg: true };
  }
  return { isColorArg: false };
};

const applyMessageColor = (
  message: any,
  colorOption?: ColorFunction | string,
): string => {
  const messageStr = formatLogValue(message);

  if (!colorOption) return messageStr;

  if (typeof colorOption === "function") {
    return colorOption(messageStr);
  }

  const colorMap: { [key: string]: ColorFunction } = {
    red: chalk.red,
    green: chalk.green,
    blue: chalk.blue,
    yellow: chalk.yellow,
    cyan: chalk.cyan,
    magenta: chalk.magenta,
    white: chalk.white,
    gray: chalk.gray,
    bold: chalk.bold,
  };

  return (colorMap[colorOption] || chalk.white)(messageStr);
};

const formatLogValue = (value: any): string => {
  const seen = new WeakSet<object>();

  const sanitize = (input: any): any => {
    if (input instanceof Error) {
      return {
        name: input.name,
        message: input.message,
        ...(isDebugEnabled && input.stack ? { stack: input.stack } : {}),
      };
    }

    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input !== "object") {
      return input;
    }

    if (seen.has(input)) {
      return "[Circular]";
    }

    seen.add(input);

    if (Array.isArray(input)) {
      return input.map((item) => sanitize(item));
    }

    const out: Record<string, any> = {};
    for (const [key, nestedValue] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
        continue;
      }

      out[key] = sanitize(nestedValue);
    }

    return out;
  };

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(sanitize(value), null, 2);
  } catch {
    return String(value);
  }
};

const logger = {
  debug: (...args: any[]) => {
    if (isDebugEnabled) {
      const message = args[0];
      const ctx = isLoggerContext(args[1]) ? args[1] : undefined;
      const otherArgs = isLoggerContext(args[1])
        ? args.slice(2)
        : args.slice(1);

      const prefix = formatLogMessage(
        "DEBUG",
        ctx?.service || ctx?.context,
        message,
      );
      const coloredMessage = applyMessageColor(message, ctx?.color);
      console.log(
        prefix,
        coloredMessage,
        ...otherArgs.map((arg) => (typeof arg === "string" ? arg : formatLogValue(arg))),
      );
    }
  },
  info: (...args: any[]) => {
    if (showInfoLogs) {
      const message = args[0];
      const ctx = isLoggerContext(args[1]) ? args[1] : undefined;
      const otherArgs = isLoggerContext(args[1])
        ? args.slice(2)
        : args.slice(1);

      const prefix = formatLogMessage(
        "INFO",
        ctx?.service || ctx?.context,
        message,
      );
      const coloredMessage = applyMessageColor(message, ctx?.color || "blue");
      console.log(
        prefix,
        coloredMessage,
        ...otherArgs.map((arg) => (typeof arg === "string" ? arg : formatLogValue(arg))),
      );
    }
  },
  log: (...args: any[]) => {
    const message = args[0];
    const ctx = isLoggerContext(args[1]) ? args[1] : undefined;
    const otherArgs = isLoggerContext(args[1]) ? args.slice(2) : args.slice(1);

    const prefix = formatLogMessage(
      "LOG",
      ctx?.service || ctx?.context,
      message,
    );
    const coloredMessage = applyMessageColor(message, ctx?.color);
    console.log(
      prefix,
      coloredMessage,
      ...otherArgs.map((arg) => (typeof arg === "string" ? arg : formatLogValue(arg))),
    );
  },
  warn: (...args: any[]) => {
    const message = args[0];
    const ctx = isLoggerContext(args[1]) ? args[1] : undefined;
    const otherArgs = isLoggerContext(args[1]) ? args.slice(2) : args.slice(1);

    const prefix = formatLogMessage(
      "WARN",
      ctx?.service || ctx?.context,
      message,
    );
    const coloredMessage = applyMessageColor(message, ctx?.color || "yellow");
    console.warn(
      prefix,
      coloredMessage,
      ...otherArgs.map((arg) => (typeof arg === "string" ? arg : formatLogValue(arg))),
    );
  },
  error: (...args: any[]) => {
    const message = args[0];
    const ctx = isLoggerContext(args[1]) ? args[1] : undefined;
    const otherArgs = isLoggerContext(args[1]) ? args.slice(2) : args.slice(1);

    const prefix = formatLogMessage(
      "ERROR",
      ctx?.service || ctx?.context,
      message,
    );
    const coloredMessage = applyMessageColor(message, ctx?.color || "red");
    console.error(
      prefix,
      coloredMessage,
      ...otherArgs.map((arg) => (typeof arg === "string" ? arg : formatLogValue(arg))),
    );
  },
  status: (...args: any[]) => {
    const message = args[0];
    const colorArg = parseColorArg(args[1]);
    const ctx = colorArg.ctx;
    const color = colorArg.color || ctx?.color;
    const otherArgs = colorArg.isColorArg ? args.slice(2) : args.slice(1);

    const prefix = formatLogMessage(
      "STATUS",
      ctx?.service || ctx?.context,
      message,
    );
    const coloredMessage = applyMessageColor(message, color);
    console.log(
      prefix,
      coloredMessage,
      ...otherArgs.map((arg) => (typeof arg === "string" ? arg : formatLogValue(arg))),
    );
  },
};

export default logger;
