import { mean, sampleStd, zScore } from '../stats/stats';

describe('anomaly detection algorithms', () => {
  it('does not flag in-distribution points', () => {
    const baseline = [20, 22, 19, 21, 20, 23, 18, 21, 19, 22, 20, 21, 19, 20];
    const z = zScore(21, baseline);
    expect(Math.abs(z)).toBeLessThan(2.5);
  });

  it('flags a sharp drop in approval rate', () => {
    const baseline = [92, 94, 91, 93, 95, 92, 90, 94, 93, 91, 92, 94, 93, 92];
    const z = zScore(40, baseline);
    expect(z).toBeLessThan(-2.5);
    expect(mean(baseline)).toBeGreaterThan(90);
    expect(sampleStd(baseline)).toBeLessThan(5);
  });

  it('is stable for constant series (no false positives from zero std)', () => {
    const baseline = Array.from({ length: 14 }, () => 10);
    // All equal → std 0; equal observation → z 0
    expect(zScore(10, baseline)).toBe(0);
  });
});
