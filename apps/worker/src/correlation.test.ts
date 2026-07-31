import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCorrelationId, correlationHeaders } from './correlation';

describe('correlation', () => {
  it('creates uuid-like ids', () => {
    const id = createCorrelationId();
    assert.match(id, /^[0-9a-f-]{36}$/i);
  });

  it('sets correlation and optional secret headers', () => {
    const withSecret = correlationHeaders('cid', 'sec');
    assert.equal(withSecret['X-Correlation-Id'], 'cid');
    assert.equal(withSecret['X-Internal-Secret'], 'sec');

    const without = correlationHeaders('cid', '');
    assert.equal(without['X-Correlation-Id'], 'cid');
    assert.equal(without['X-Internal-Secret'], undefined);

    const idempotent = correlationHeaders('cid', 'sec', 'job:bucket');
    assert.equal(idempotent['Idempotency-Key'], 'job:bucket');
  });
});
