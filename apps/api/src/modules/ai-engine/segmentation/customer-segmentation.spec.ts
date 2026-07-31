import { logistic, percentile } from '../stats/stats';

describe('customer segmentation algorithms', () => {
  it('logistic churn rises with recency and falls with frequency', () => {
    const stale = logistic(0.045 * 120 - 0.35 * Math.log1p(1));
    const active = logistic(0.045 * 7 - 0.35 * Math.log1p(8));
    expect(stale).toBeGreaterThan(active);
    expect(stale).toBeGreaterThan(0.5);
    expect(active).toBeLessThan(0.5);
  });

  it('percentile cuts are stable and ordered', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p20 = percentile(values, 0.2);
    const p80 = percentile(values, 0.8);
    expect(p20).toBeLessThan(p80);
    expect(p20).toBeCloseTo(2.8, 5);
  });
});
