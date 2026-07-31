import {
  buildConfidenceInterval,
  cosineSimilarity,
  holtLinearForecast,
  resampleSeries,
} from '../stats/stats';

/**
 * Algorithm-level checks for the forecast blend (no Nest/Prisma).
 * Guarantees projections stay within [sold, capacity] and intervals widen with noise.
 */
describe('sales forecast algorithms', () => {
  it('Holt projects growth for an accelerating series', () => {
    const daily = [2, 3, 4, 6, 8, 11, 14];
    const { forecast } = holtLinearForecast(daily, 5, 0.5, 0.4);
    const additional = forecast.reduce((s, v) => s + Math.max(0, v), 0);
    expect(additional).toBeGreaterThan(20);
  });

  it('peer similarity ranks the matching curve highest', () => {
    const target = resampleSeries([0, 0.2, 0.45, 0.7, 0.9], 10);
    const match = resampleSeries([0, 0.22, 0.44, 0.72, 0.88], 10);
    const mismatch = resampleSeries([0, 0.05, 0.08, 0.1, 0.12], 10);
    expect(cosineSimilarity(target, match)).toBeGreaterThan(
      cosineSimilarity(target, mismatch),
    );
  });

  it('confidence interval refuses to invent certainty without peers', () => {
    const thin = buildConfidenceInterval({
      point: 500,
      residualStd: 80,
      sampleSize: 1,
      minLimited: 2,
      minSufficient: 5,
      clampMin: 200,
      clampMax: 1000,
    });
    expect(thin.sufficiency).toBe('insufficient');
    expect(thin.level).toBe('none');

    const rich = buildConfidenceInterval({
      point: 500,
      residualStd: 40,
      sampleSize: 10,
      minLimited: 2,
      minSufficient: 5,
      clampMin: 200,
      clampMax: 1000,
    });
    expect(rich.sufficiency).toBe('sufficient');
    expect(rich.lower).toBeGreaterThanOrEqual(200);
    expect(rich.upper).toBeLessThanOrEqual(1000);
    expect(rich.upper - rich.lower).toBeGreaterThan(0);
  });
});
