/**
 * Pure statistical primitives for the AI engine.
 * No NestJS / Prisma / I/O — unit-testable and deterministic.
 */

import type {
  AiConfidenceInterval,
  AiConfidenceLevel,
  AiDataSufficiency,
} from '@boletera/shared';

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (Bessel's correction, n-1). Returns 0 for n < 2. */
export function sampleStd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (values.length - 1));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Z-score of `value` against a baseline sample.
 * Returns 0 when std is ~0 (no dispersion → no anomaly signal).
 */
export function zScore(value: number, baseline: readonly number[]): number {
  if (baseline.length < 2) return 0;
  const m = mean(baseline);
  const s = sampleStd(baseline);
  if (s < 1e-9) return value === m ? 0 : value > m ? Infinity : -Infinity;
  return (value - m) / s;
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  /** Coefficient of determination; null when variance of y is 0. */
  rSquared: number | null;
  n: number;
}

/**
 * Ordinary least squares for y ~ a + b*x.
 * Complexity: O(n).
 */
export function linearRegression(
  xs: readonly number[],
  ys: readonly number[],
): LinearRegressionResult {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) {
    return { slope: 0, intercept: 0, rSquared: null, n: 0 };
  }
  if (n === 1) {
    return { slope: 0, intercept: ys[0] ?? 0, rSquared: null, n: 1 };
  }
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = Math.abs(denom) < 1e-12 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const y = ys[i]!;
    const pred = intercept + slope * xs[i]!;
    ssTot += (y - yMean) * (y - yMean);
    ssRes += (y - pred) * (y - pred);
  }
  const rSquared = ssTot < 1e-12 ? null : 1 - ssRes / ssTot;
  return { slope, intercept, rSquared, n };
}

/**
 * Simple exponential smoothing forecast one step ahead.
 * alpha in (0, 1]; higher = more weight on recent observations.
 */
export function exponentialSmoothing(
  values: readonly number[],
  alpha = 0.35,
): { level: number; fitted: number[] } {
  if (values.length === 0) return { level: 0, fitted: [] };
  const a = clamp(alpha, 0.01, 1);
  let level = values[0]!;
  const fitted: number[] = [level];
  for (let i = 1; i < values.length; i++) {
    level = a * values[i]! + (1 - a) * level;
    fitted.push(level);
  }
  return { level, fitted };
}

/**
 * Holt linear (double) exponential smoothing — level + trend.
 * Returns forecast `horizon` steps ahead from the last observation.
 */
export function holtLinearForecast(
  values: readonly number[],
  horizon: number,
  alpha = 0.4,
  beta = 0.2,
): { level: number; trend: number; forecast: number[] } {
  if (values.length === 0) {
    return { level: 0, trend: 0, forecast: Array.from({ length: Math.max(0, horizon) }, () => 0) };
  }
  if (values.length === 1) {
    const v = values[0]!;
    return {
      level: v,
      trend: 0,
      forecast: Array.from({ length: Math.max(0, horizon) }, () => v),
    };
  }
  const a = clamp(alpha, 0.01, 1);
  const b = clamp(beta, 0.01, 1);
  let level = values[0]!;
  let trend = values[1]! - values[0]!;
  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = a * values[i]! + (1 - a) * (prevLevel + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
  }
  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    forecast.push(level + h * trend);
  }
  return { level, trend, forecast };
}

/**
 * Cosine similarity of equal-length non-negative vectors.
 * Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Resample a cumulative pace curve (0–1 occupancy over sale window) to `bins` points.
 */
export function resampleSeries(
  values: readonly number[],
  bins: number,
): number[] {
  if (bins <= 0) return [];
  if (values.length === 0) return Array.from({ length: bins }, () => 0);
  if (values.length === 1) return Array.from({ length: bins }, () => values[0]!);
  const out: number[] = [];
  for (let i = 0; i < bins; i++) {
    const t = bins === 1 ? 0 : i / (bins - 1);
    const pos = t * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const frac = pos - lo;
    out.push(values[lo]! * (1 - frac) + values[hi]! * frac);
  }
  return out;
}

export function sufficiencyFromSample(
  sampleSize: number,
  minLimited: number,
  minSufficient: number,
): AiDataSufficiency {
  if (sampleSize < minLimited) return 'insufficient';
  if (sampleSize < minSufficient) return 'limited';
  return 'sufficient';
}

export function confidenceLevelFrom(
  sampleSize: number,
  residualCv: number,
  sufficiency: AiDataSufficiency,
): AiConfidenceLevel {
  if (sufficiency === 'insufficient') return 'none';
  if (sufficiency === 'limited') return 'low';
  if (sampleSize >= 20 && residualCv < 0.25) return 'high';
  if (sampleSize >= 8 && residualCv < 0.45) return 'medium';
  return 'low';
}

/**
 * Build a symmetric confidence interval around `point` using residual std.
 * Uses a normal-approximation z for the nominal coverage (default 80% → z≈1.2816).
 */
export function buildConfidenceInterval(params: {
  point: number;
  residualStd: number;
  sampleSize: number;
  coverage?: number;
  minLimited?: number;
  minSufficient?: number;
  clampMin?: number;
  clampMax?: number;
}): AiConfidenceInterval {
  const coverage = params.coverage ?? 0.8;
  const minLimited = params.minLimited ?? 3;
  const minSufficient = params.minSufficient ?? 8;
  const sufficiency = sufficiencyFromSample(
    params.sampleSize,
    minLimited,
    minSufficient,
  );
  const z = coverageToZ(coverage);
  const half =
    sufficiency === 'insufficient'
      ? 0
      : z * params.residualStd * Math.sqrt(1 + 1 / Math.max(1, params.sampleSize));
  let lower = params.point - half;
  let upper = params.point + half;
  if (params.clampMin != null) {
    lower = Math.max(params.clampMin, lower);
    upper = Math.max(params.clampMin, upper);
  }
  if (params.clampMax != null) {
    lower = Math.min(params.clampMax, lower);
    upper = Math.min(params.clampMax, upper);
  }
  const residualCv =
    Math.abs(params.point) < 1e-9
      ? params.residualStd
      : params.residualStd / Math.abs(params.point);
  const level = confidenceLevelFrom(params.sampleSize, residualCv, sufficiency);
  return {
    point: round(params.point),
    lower: round(lower),
    upper: round(upper),
    coverage,
    level,
    sampleSize: params.sampleSize,
    sufficiency,
  };
}

/** Approximate two-tailed normal z for common coverages. */
export function coverageToZ(coverage: number): number {
  const c = clamp(coverage, 0.5, 0.999);
  if (c >= 0.99) return 2.5758;
  if (c >= 0.95) return 1.96;
  if (c >= 0.9) return 1.6449;
  if (c >= 0.8) return 1.2816;
  return 1.0;
}

/** Logistic (sigmoid) mapping used by fraud / churn scores. */
export function logistic(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Weighted sum of factors clamped to [0, 100]. */
export function weightedScore(
  factors: ReadonlyArray<{ weight: number; active: boolean }>,
  base = 5,
): number {
  let score = base;
  for (const f of factors) {
    if (f.active) score += f.weight;
  }
  return round(clamp(score, 0, 100), 1);
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
