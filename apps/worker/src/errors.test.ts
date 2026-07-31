import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PermanentError,
  TransientError,
  classifyHttpStatus,
  isPermanentError,
  toWorkerError,
} from './errors';

describe('error classification', () => {
  it('classifies HTTP statuses', () => {
    assert.equal(classifyHttpStatus(400), 'permanent');
    assert.equal(classifyHttpStatus(404), 'permanent');
    assert.equal(classifyHttpStatus(429), 'transient');
    assert.equal(classifyHttpStatus(503), 'transient');
    assert.equal(classifyHttpStatus(408), 'transient');
  });

  it('detects permanent errors', () => {
    assert.equal(isPermanentError(new PermanentError('no')), true);
    assert.equal(isPermanentError(new TransientError('retry')), false);
    assert.equal(isPermanentError(new Error('x')), false);
  });

  it('maps network and prisma codes', () => {
    const net = toWorkerError({ code: 'ECONNREFUSED', message: 'down' });
    assert.ok(net instanceof TransientError);
    assert.equal(net.code, 'ECONNREFUSED');

    const conflict = toWorkerError({ code: 'P2002', message: 'unique' });
    assert.ok(conflict instanceof PermanentError);
  });
});
