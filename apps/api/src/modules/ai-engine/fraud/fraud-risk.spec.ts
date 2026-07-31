import { clamp, weightedScore } from '../stats/stats';

describe('fraud risk scoring algorithms', () => {
  it('assigns higher scores when multiple signals fire', () => {
    const quiet = weightedScore(
      [
        { weight: 22, active: false },
        { weight: 25, active: false },
        { weight: 15, active: false },
      ],
      5,
    );
    const noisy = weightedScore(
      [
        { weight: 22, active: true },
        { weight: 25, active: true },
        { weight: 15, active: true },
      ],
      5,
    );
    expect(quiet).toBe(5);
    expect(noisy).toBe(67);
    expect(noisy).toBeGreaterThan(quiet);
  });

  it('never exceeds the 0–100 band', () => {
    expect(clamp(weightedScore([{ weight: 200, active: true }], 50), 0, 100)).toBe(100);
  });

  it('is deterministic for the same factor set', () => {
    const factors = [
      { weight: 22, active: true },
      { weight: 18, active: true },
      { weight: 10, active: false },
    ];
    expect(weightedScore(factors, 5)).toBe(weightedScore(factors, 5));
  });
});
