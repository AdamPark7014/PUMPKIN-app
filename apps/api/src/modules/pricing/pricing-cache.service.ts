import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Short-TTL in-process cache for pricing aggregates / recommendations.
 * Complexity: O(1) get/set; lazy eviction on read.
 */
@Injectable()
export class PricingCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  /** Default TTL for recommendation snapshots (seconds). */
  static readonly DEFAULT_TTL_SECONDS = 30;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds = PricingCacheService.DEFAULT_TTL_SECONDS): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  wrapKey(parts: Array<string | number | undefined | null>): string {
    return parts.map((p) => (p == null ? '_' : String(p))).join('|');
  }
}
