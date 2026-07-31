/**
 * Exponential backoff with full jitter.
 * delay = random(0, min(maxMs, baseMs * 2^attempt)) inclusive.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exp = Math.max(0, attempt);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exp);
  const unit = Math.min(1, Math.max(0, random()));
  return Math.min(ceiling, Math.floor(unit * (ceiling + 1)));
}

export function createJitterBackoffStrategy(baseMs: number, maxMs: number) {
  return (attemptsMade: number, _err: Error): number =>
    computeBackoffMs(attemptsMade, baseMs, maxMs);
}
