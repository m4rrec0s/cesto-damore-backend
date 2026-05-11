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
  expiresAt: number;
  createdAt: number;
  hitCount: number;
}

class ToolCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;
  private readonly DEFAULT_TTL = 300;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Gera chave de cache: hash(toolName + JSON(input))
   */
  private generateKey(toolName: string, input: any): string {
    const combined = `${toolName}:${JSON.stringify(input)}`;
    return crypto.createHash("md5").update(combined).digest("hex");
  }

  /**
   * Busca resultado em cache
   */
  get<T = any>(toolName: string, input: any): IToolResult<T> | null {
    const key = this.generateKey(toolName, input);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    return entry.result as IToolResult<T>;
  }

  /**
   * Armazena resultado em cache com TTL
   */
  set<T = any>(
    toolName: string,
    input: any,
    result: IToolResult<T>,
    ttlSeconds: number = this.DEFAULT_TTL
  ): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    const key = this.generateKey(toolName, input);
    const now = Date.now();
    
    this.cache.set(key, {
      result,
      expiresAt: now + ttlSeconds * 1000,
      createdAt: now,
      hitCount: 0,
    });
  }

  /**
   * Remove entrada expirada
   */
  invalidate(toolName: string, input: any): void {
    const key = this.generateKey(toolName, input);
    this.cache.delete(key);
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove entrada mais antiga (LRU)
   */
  private evictOldest(): void {
    let oldest: [string, CacheEntry] | null = null;

    for (const [key, entry] of this.cache) {
      if (!oldest || entry.createdAt < oldest[1].createdAt) {
        oldest = [key, entry];
      }
    }

    if (oldest) {
      this.cache.delete(oldest[0]);
    }
  }

  /**
   * Inicia timer de limpeza periódica (a cada 60s)
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of Array.from(this.cache.entries())) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
        }
      }
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
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
    };
  }
}

export const toolCacheService = new ToolCache();
export default toolCacheService;
