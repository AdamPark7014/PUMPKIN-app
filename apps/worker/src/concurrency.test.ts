import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConcurrencyGate } from './concurrency';
import { TransientError } from './errors';

describe('ConcurrencyGate', () => {
  it('limits concurrent acquisitions', async () => {
    const gate = new ConcurrencyGate(2);
    await gate.acquire();
    await gate.acquire();
    assert.equal(gate.getActive(), 2);
    assert.equal(gate.tryAcquire(), false);

    let released = false;
    const waiting = gate.acquire().then(() => {
      released = true;
    });
    assert.equal(released, false);
    gate.release();
    await waiting;
    assert.equal(released, true);
    assert.equal(gate.getActive(), 2);
    gate.release();
    gate.release();
    assert.equal(gate.getActive(), 0);
  });

  it('assertCapacity throws BACKPRESSURE', () => {
    const gate = new ConcurrencyGate(1);
    assert.equal(gate.tryAcquire(), true);
    assert.throws(() => gate.assertCapacity(), (err: unknown) => {
      assert.ok(err instanceof TransientError);
      assert.equal(err.code, 'BACKPRESSURE');
      return true;
    });
  });
});
