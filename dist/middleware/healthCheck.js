"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseHealthCheck = databaseHealthCheck;
exports.healthCheckEndpoint = healthCheckEndpoint;
const prismaRetry_1 = require("../database/prismaRetry");
/**
 * Middleware para verificar a saúde da conexão com o banco de dados
 */
async function databaseHealthCheck(req, res, next) {
    try {
        const isConnected = await (0, prismaRetry_1.checkDatabaseConnection)();
        if (!isConnected) {
            console.warn("⚠️ Banco de dados não está respondendo");
            return res.status(503).json({
                error: "Serviço temporariamente indisponível",
                message: "Não foi possível conectar ao banco de dados. Tente novamente em alguns instantes.",
            });
        }
        next();
    }
    catch (error) {
        console.error("❌ Erro no healthcheck do banco:", error);
        next();
    }
}
/**
 * Endpoint para verificar status da API e conexão com banco
 */
async function healthCheckEndpoint(req, res) {
    const dbConnected = await (0, prismaRetry_1.checkDatabaseConnection)();
    res.status(dbConnected ? 200 : 503).json({
        status: dbConnected ? "healthy" : "unhealthy",
        database: dbConnected ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
    });
}
