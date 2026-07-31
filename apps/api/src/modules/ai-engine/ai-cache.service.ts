import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Short-TTL in-process cache for expensive AI engine aggregates.
 * Complexity: O(1) get/set; lazy eviction on read.
 */
@Injectable()
export class AiCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  static readonly DEFAULT_TTL_SECONDS = 60;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds = AiCacheService.DEFAULT_TTL_SECONDS): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  wrapKey(parts: Array<string | number | undefined | null>): string {
    return parts.map((p) => (p == null ? '_' : String(p))).join('|');
  }

  async wrap<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    this.set(key, value, ttlSeconds);
    return value;
  }
}
