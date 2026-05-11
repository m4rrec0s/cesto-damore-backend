/**
 * ToolCache Service - Cache para resultados de ferramentas com TTL
 * 
 * Reduz chamadas repetidas ao MCP para a mesma query/input
 * com suporte a TTL (time-to-live) configurável por tool
 */

import crypto from "crypto";
import logger from "../utils/logger";
import type { IToolResult } from "../types/tools";

interface CacheEntry<T = any> {
  result: IToolResult<T>;
  expiresAt: number; // timestamp em ms
  createdAt: number;
  hitCount: number;
}

class ToolCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;
  private readonly DEFAULT_TTL = 300; // 5 minutos em segundos
  private cleanupInterval: NodeJS.Timer | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Gera chave de cache: hash(toolName + JSON(input))
   */
  private generateCacheKey(toolName: string, input: Record<string, any>): string {
    const key = `${toolName}:${JSON.stringify(input)}`;
    return crypto.createHash("md5").update(key).digest("hex");
  }

  /**
   * Obtém resultado do cache se existir e não expirou
   */
  get<T = any>(
    toolName: string,
    input: Record<string, any>
  ): IToolResult<T> | null {
    const key = this.generateCacheKey(toolName, input);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Verifica se expirou
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Marca como acessado
    entry.hitCount++;
    logger.debug(
      `[ToolCache] HIT: ${toolName} (hits=${entry.hitCount})`
    );

    // Retorna com flag de cache
    return {
      ...entry.result,
      fromCache: true,
    };
  }

  /**
   * Armazena resultado em cache com TTL
   */
  set<T = any>(
    toolName: string,
    input: Record<string, any>,
    result: IToolResult<T>,
    ttlSeconds?: number
  ): void {
    // Não cachea resultados de erro
    if (!result.success) {
      return;
    }

    const key = this.generateCacheKey(toolName, input);
    const ttl = ttlSeconds ?? this.DEFAULT_TTL;

    // Se cache está cheio, remove oldest com menos hits
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      let oldestKey = "";
      let oldestScore = Infinity;

      for (const [k, v] of this.cache.entries()) {
        const score = v.hitCount > 0 ? v.createdAt : 0;
        if (score < oldestScore) {
          oldestScore = score;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const entry: CacheEntry = {
      result: { ...result, fromCache: false },
      expiresAt: Date.now() + ttl * 1000,
      createdAt: Date.now(),
      hitCount: 0,
    };

    this.cache.set(key, entry);
    logger.debug(
      `[ToolCache] STORE: ${toolName} (ttl=${ttl}s, size=${this.cache.size})`
    );
  }

  /**
   * Limpa cache para uma tool específica
   */
  invalidateTool(toolName: string): number {
    let count = 0;
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(`${toolName}:`)) {
        this.cache.delete(key);
        count++;
      }
    }
    logger.info(`[ToolCache] Invalidated ${count} entries for tool: ${toolName}`);
    return count;
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`[ToolCache] Cleared ${size} entries`);
  }

  /**
   * Remove entradas expiradas (executado periodicamente)
   */
  private cleanup(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug(
        `[ToolCache] Cleanup: removed ${expiredCount} expired entries`
      );
    }
  }

  /**
   * Inicia timer de limpeza periódica
   */
  private startCleanupTimer(): void {
    // Cleanup a cada 60 segundos
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Para o timer de limpeza
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Retorna estatísticas do cache
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    avgTTL: number;
    topHits: Array<{ key: string; hits: number }>;
  } {
    let totalHits = 0;
    let totalTTL = 0;
    const topHits: Array<{ key: string; hits: number }> = [];

    for (const [key, entry] of this.cache.entries()) {
      totalHits += entry.hitCount;
      totalTTL += entry.expiresAt - entry.createdAt;
      topHits.push({ key, hits: entry.hitCount });
    }

    topHits.sort((a, b) => b.hits - a.hits);

    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      avgTTL: this.cache.size > 0 ? totalTTL / this.cache.size / 1000 : 0,
      topHits: topHits.slice(0, 5),
    };
  }
}

// Singleton
const toolCache = new ToolCache();

export default toolCache;
