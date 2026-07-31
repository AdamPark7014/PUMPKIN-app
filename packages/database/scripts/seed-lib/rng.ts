/** Deterministic mulberry32 PRNG — reproducible demo datasets. */
export class SeedRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Shuffle copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }

  /** Stable demo id from namespace + key — unique for distinct keys. */
  id(ns: string, key: string | number): string {
    const keyPart = String(key)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .slice(0, 48);
    let h = 2166136261;
    const raw = `${ns}:${key}`;
    for (let i = 0; i < raw.length; i++) {
      h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
    }
    const suffix = (h >>> 0).toString(36);
    return `${ns}_${keyPart}_${suffix}`.slice(0, 64);
  }
}
