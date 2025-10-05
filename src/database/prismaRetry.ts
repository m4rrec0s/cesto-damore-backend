import prisma from "./prisma";

/**
 * Executa uma operação do Prisma com retry automático em caso de falhas de conexão
 * @param operation - Função que executa a operação do Prisma
 * @param maxRetries - Número máximo de tentativas (padrão: 3)
 * @param retryDelay - Delay entre tentativas em ms (padrão: 1000)
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Tenta reconectar se necessário
      await prisma.$connect();

      const result = await operation();
      return result;
    } catch (error: any) {
      lastError = error;

      // Verifica se é um erro de conexão que vale a pena retentar
      const isConnectionError =
        error.message?.includes("database server") ||
        error.message?.includes("Connection") ||
        error.message?.includes("ECONNREFUSED") ||
        error.code === "P1001" || // Can't reach database server
        error.code === "P1002" || // Connection timed out
        error.code === "P1008" || // Operations timed out
        error.code === "P1017"; // Server closed connection

      if (!isConnectionError || attempt >= maxRetries) {
        throw error;
      }

      console.warn(
        `⚠️ Tentativa ${attempt}/${maxRetries} falhou. Tentando novamente em ${retryDelay}ms...`,
        error.message
      );

      // Aguarda antes de tentar novamente (com backoff exponencial)
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }

  throw lastError;
}

/**
 * Verifica se a conexão com o banco de dados está funcionando
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("❌ Erro ao conectar com o banco de dados:", error);
    return false;
  }
}

/**
 * Garante que o Prisma Client está conectado antes de executar operações
 */
export async function ensureConnection(): Promise<void> {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error("❌ Erro ao garantir conexão:", error);
    throw error;
  }
}
