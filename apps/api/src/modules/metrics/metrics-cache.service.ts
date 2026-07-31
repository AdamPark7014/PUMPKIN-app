import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Short-TTL in-process cache for expensive metrics aggregates.
 * Avoids N+1 and repeated groupBy/queryRaw within the TTL window.
 * Complexity: O(1) get/set; periodic lazy eviction on access.
 */
@Injectable()
export class MetricsCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  /** Default TTL for costly aggregates (seconds). */
  static readonly DEFAULT_TTL_SECONDS = 45;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds = MetricsCacheService.DEFAULT_TTL_SECONDS): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  wrapKey(parts: Array<string | number | undefined | null>): string {
    return parts.map((p) => (p == null ? '_' : String(p))).join('|');
  }
}
