import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { metrics } from './metrics';

describe('metrics', () => {
  it('tracks duration success and failure', () => {
    metrics.begin();
    metrics.recordAttempt('release-expired-holds', 2);
    assert.equal(metrics.getInFlight(), 1);
    metrics.recordSuccess('release-expired-holds', 12);
    metrics.end();
    metrics.begin();
    metrics.recordFailure('schedule-tick', 40, true);
    metrics.recordDeadLetter('schedule-tick');
    metrics.end();

    const snap = metrics.snapshot();
    assert.equal(snap.inFlight, 0);
    assert.equal(snap.jobs['release-expired-holds']?.successes, 1);
    assert.equal(snap.jobs['release-expired-holds']?.lastDurationMs, 12);
    assert.equal(snap.jobs['release-expired-holds']?.retries, 1);
    assert.equal(snap.jobs['schedule-tick']?.failures, 1);
    assert.equal(snap.jobs['schedule-tick']?.permanentFailures, 1);
    assert.equal(snap.jobs['schedule-tick']?.deadLetters, 1);
  });
});
