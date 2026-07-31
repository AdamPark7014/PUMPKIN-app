import {
  buildConfidenceInterval,
  cosineSimilarity,
  exponentialSmoothing,
  holtLinearForecast,
  linearRegression,
  mean,
  resampleSeries,
  sampleStd,
  sufficiencyFromSample,
  weightedScore,
  zScore,
} from './stats';

describe('ai-engine stats', () => {
  describe('mean / sampleStd', () => {
    it('computes mean and sample std of a known series', () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      expect(mean(values)).toBe(5);
      expect(sampleStd(values)).toBeCloseTo(2.138, 2);
    });

    it('returns 0 std for fewer than 2 samples', () => {
      expect(sampleStd([])).toBe(0);
      expect(sampleStd([3])).toBe(0);
    });
  });

  describe('zScore', () => {
    it('flags a clear outlier', () => {
      const baseline = [10, 11, 9, 10, 12, 10, 11, 9];
      expect(zScore(30, baseline)).toBeGreaterThan(5);
      expect(zScore(10, baseline)).toBeLessThan(1);
    });
  });

  describe('linearRegression', () => {
    it('recovers slope and intercept of a perfect line', () => {
      const xs = [0, 1, 2, 3, 4];
      const ys = xs.map((x) => 2 + 3 * x);
      const fit = linearRegression(xs, ys);
      expect(fit.slope).toBeCloseTo(3, 6);
      expect(fit.intercept).toBeCloseTo(2, 6);
      expect(fit.rSquared).toBeCloseTo(1, 6);
    });
  });

  describe('exponentialSmoothing / holt', () => {
    it('tracks a constant series', () => {
      const values = [5, 5, 5, 5, 5];
      const { level } = exponentialSmoothing(values, 0.5);
      expect(level).toBeCloseTo(5, 6);
    });

    it('projects a linear trend with Holt', () => {
      const values = [1, 2, 3, 4, 5];
      const { forecast, trend } = holtLinearForecast(values, 3, 0.5, 0.5);
      expect(trend).toBeGreaterThan(0.5);
      expect(forecast[0]).toBeGreaterThan(5);
      expect(forecast[2]).toBeGreaterThan(forecast[0]!);
    });
  });

  describe('cosineSimilarity / resampleSeries', () => {
    it('returns 1 for identical vectors', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    });

    it('resamples to fixed bins preserving endpoints', () => {
      const out = resampleSeries([0, 1], 5);
      expect(out).toHaveLength(5);
      expect(out[0]).toBeCloseTo(0, 6);
      expect(out[4]).toBeCloseTo(1, 6);
    });
  });

  describe('buildConfidenceInterval', () => {
    it('marks insufficient data when sample is tiny', () => {
      const ci = buildConfidenceInterval({
        point: 100,
        residualStd: 10,
        sampleSize: 1,
        minLimited: 3,
        minSufficient: 8,
      });
      expect(ci.sufficiency).toBe('insufficient');
      expect(ci.level).toBe('none');
    });

    it('produces a finite interval with enough peers', () => {
      const ci = buildConfidenceInterval({
        point: 100,
        residualStd: 10,
        sampleSize: 12,
        coverage: 0.8,
        clampMin: 0,
        clampMax: 200,
      });
      expect(ci.sufficiency).toBe('sufficient');
      expect(ci.lower).toBeLessThan(ci.point);
      expect(ci.upper).toBeGreaterThan(ci.point);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(200);
    });
  });

  describe('sufficiency / weightedScore', () => {
    it('classifies sample sizes', () => {
      expect(sufficiencyFromSample(1, 3, 8)).toBe('insufficient');
      expect(sufficiencyFromSample(5, 3, 8)).toBe('limited');
      expect(sufficiencyFromSample(10, 3, 8)).toBe('sufficient');
    });

    it('sums active weights and clamps', () => {
      expect(
        weightedScore(
          [
            { weight: 40, active: true },
            { weight: 30, active: true },
            { weight: 50, active: false },
          ],
          10,
        ),
      ).toBe(80);
      expect(weightedScore([{ weight: 200, active: true }], 10)).toBe(100);
    });
  });
});
