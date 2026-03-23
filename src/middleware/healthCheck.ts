import { Request, Response, NextFunction } from "express";
import { checkDatabaseConnection } from "../database/prismaRetry";
import logger from "../utils/logger";

export async function databaseHealthCheck(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const isConnected = await checkDatabaseConnection();

    if (!isConnected) {
      logger.warn("⚠️ Banco de dados não está respondendo");
      return res.status(503).json({
        error: "Serviço temporariamente indisponível",
        message:
          "Não foi possível conectar ao banco de dados. Tente novamente em alguns instantes.",
      });
    }

    next();
  } catch (error) {
    logger.error("❌ Erro no healthcheck do banco:", error);
    next();
  }
}

export async function healthCheckEndpoint(req: Request, res: Response) {
  const dbConnected = await checkDatabaseConnection();

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? "healthy" : "unhealthy",
    database: dbConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
}
