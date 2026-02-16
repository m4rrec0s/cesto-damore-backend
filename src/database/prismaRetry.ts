import prisma from "./prisma";

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {

      await prisma.$connect();

      const result = await operation();
      return result;
    } catch (error: any) {
      lastError = error;

      const isConnectionError =
        error.message?.includes("database server") ||
        error.message?.includes("Connection") ||
        error.message?.includes("ECONNREFUSED") ||
        error.code === "P1001" ||
        error.code === "P1002" ||
        error.code === "P1008" ||
        error.code === "P1017";

      if (!isConnectionError || attempt >= maxRetries) {
        throw error;
      }

      console.warn(
        `⚠️ Tentativa ${attempt}/${maxRetries} falhou. Tentando novamente em ${retryDelay}ms...`,
        error.message
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }

  throw lastError;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("❌ Erro ao conectar com o banco de dados:", error);
    return false;
  }
}

export async function ensureConnection(): Promise<void> {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error("❌ Erro ao garantir conexão:", error);
    throw error;
  }
}
