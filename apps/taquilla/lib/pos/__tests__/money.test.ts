import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cashVarianceCentavos,
  centavosToPesosNumber,
  centavosToPesosString,
  pesosToCentavos,
} from '../money';

describe('pesosToCentavos roundtrip', () => {
  it('converts decimal strings without float drift', () => {
    assert.equal(pesosToCentavos('10.10'), 1010n);
    assert.equal(pesosToCentavos('0.01'), 1n);
    assert.equal(pesosToCentavos('100'), 10000n);
    assert.equal(centavosToPesosString(pesosToCentavos('19.99')), '19.99');
    assert.equal(centavosToPesosNumber(pesosToCentavos('19.99')), 19.99);
  });

  it('handles classic float-sensitive values via toFixed(2)', () => {
    assert.equal(pesosToCentavos(0.1 + 0.2), 30n);
    // Number(1.005) is 1.0049… in IEEE-754, so toFixed(2) yields 1.00.
    assert.equal(centavosToPesosString(pesosToCentavos(1.005)), '1.00');
    // Prefer decimal strings for exact half-up rounding.
    assert.equal(centavosToPesosString(pesosToCentavos('1.005')), '1.01');
    assert.equal(pesosToCentavos('1.015'), 102n);
  });
});

describe('cashVarianceCentavos', () => {
  it('returns counted − expected in centavos', () => {
    assert.equal(cashVarianceCentavos('100.00', '99.50'), 50n);
    assert.equal(cashVarianceCentavos('99.50', '100.00'), -50n);
    assert.equal(cashVarianceCentavos(250, 250), 0n);
  });
});
