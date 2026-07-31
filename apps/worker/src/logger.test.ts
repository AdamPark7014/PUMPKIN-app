import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeFields } from './logger';

describe('sanitizeFields', () => {
  it('strips PII keys and undefined values', () => {
    const out = sanitizeFields({
      correlationId: 'c1',
      email: 'a@b.com',
      userId: 'u1',
      sessionId: 's1',
      released: 3,
      token: 'secret',
      reason: undefined,
    });
    assert.deepEqual(out, { correlationId: 'c1', released: 3 });
  });

  it('redacts PII embedded in permitted strings', () => {
    const out = sanitizeFields({
      reason: 'request for buyer@example.com failed at /x?token=super-secret&safe=1',
    });
    assert.equal(
      out.reason,
      'request for [REDACTED_EMAIL] failed at /x?token=[REDACTED]&safe=1',
    );
  });
});
