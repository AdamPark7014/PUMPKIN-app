import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeBackoffMs, createJitterBackoffStrategy } from './backoff';

describe('computeBackoffMs', () => {
  it('stays within [0, ceiling] with full jitter', () => {
    const samples = Array.from({ length: 50 }, (_, i) =>
      computeBackoffMs(3, 1000, 60_000, () => i / 49),
    );
    for (const s of samples) {
      assert.ok(s >= 0);
      assert.ok(s <= 8000);
    }
    assert.equal(samples[0], 0);
    assert.equal(samples[samples.length - 1], 8000);
  });

  it('respects maxMs ceiling', () => {
    const v = computeBackoffMs(20, 2000, 5000, () => 1);
    assert.equal(v, 5000);
  });

  it('exposes bull-compatible jitter strategy', () => {
    const strategy = createJitterBackoffStrategy(100, 1000);
    const delay = strategy(2, new Error('x'));
    assert.ok(delay >= 0);
    assert.ok(delay <= 400);
  });
});
