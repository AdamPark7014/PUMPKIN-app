import { expect, test } from '../support/fixtures';
import {
  attemptSeatHold,
  pickSeatForTest,
  releaseHoldSafe,
  requireApiHealthy,
  waitForTicketStatus,
} from './_lib/helpers';

test.describe('Inventory API — concurrent hold on same seat', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('Promise.all double-hold of one seat yields exactly one winner', async ({
    request,
    testId,
  }) => {
    const seat = await pickSeatForTest(request, `${testId}-concurrent-hold`);

    const [a, b] = await Promise.all([
      attemptSeatHold(request, {
        eventId: seat.eventId,
        seatId: seat.seatId,
        offerId: seat.offerId,
        sessionId: `inv-race-a-${testId}`,
      }),
      attemptSeatHold(request, {
        eventId: seat.eventId,
        seatId: seat.seatId,
        offerId: seat.offerId,
        sessionId: `inv-race-b-${testId}`,
      }),
    ]);

    const attempts = [a, b];
    const winners = attempts.filter((attempt) => attempt.ok && Boolean(attempt.holdId));
    const losers = attempts.filter((attempt) => !attempt.ok);

    try {
      expect(
        winners,
        `expected exactly one successful hold; got statuses=[${attempts
          .map((attempt) => attempt.status)
          .join(',')}] bodies=${JSON.stringify(attempts.map((attempt) => attempt.body))}`,
      ).toHaveLength(1);
      expect(losers, 'losing concurrent hold must fail').toHaveLength(1);

      const winner = winners[0];
      const loser = losers[0];
      if (!winner || !loser) {
        throw new Error('Race result incomplete');
      }

      expect([200, 201]).toContain(winner.status);
      expect([409, 400], await loser.response.text()).toContain(loser.status);

      await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'HELD', {
        timeoutMs: 15_000,
      });
    } finally {
      for (const attempt of winners) {
        await releaseHoldSafe(request, attempt.holdId);
      }
    }
  });
});
