import { expect, test } from '../support/fixtures';
import {
  attemptHoldThenCashPurchase,
  pickSeatForTest,
  releaseHoldSafe,
  requireApiHealthy,
  ticketStatus,
  waitForTicketStatus,
} from './_lib/helpers';

test.describe('Inventory API — concurrent sale of same seat', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('Promise.all double purchase path yields exactly one COMPLETED winner', async ({
    request,
    testId,
  }) => {
    const seat = await pickSeatForTest(request, `${testId}-concurrent-sale`);

    const [a, b] = await Promise.all([
      attemptHoldThenCashPurchase(request, {
        label: 'a',
        eventId: seat.eventId,
        offerId: seat.offerId,
        seatId: seat.seatId,
        sessionId: `inv-sale-a-${testId}`,
        testId,
      }),
      attemptHoldThenCashPurchase(request, {
        label: 'b',
        eventId: seat.eventId,
        offerId: seat.offerId,
        seatId: seat.seatId,
        sessionId: `inv-sale-b-${testId}`,
        testId,
      }),
    ]);

    const attempts = [a, b];
    const winners = attempts.filter((attempt) => attempt.won);
    const losers = attempts.filter((attempt) => !attempt.won);

    try {
      expect(
        winners,
        `expected exactly one COMPLETED sale; results=${JSON.stringify(attempts)}`,
      ).toHaveLength(1);
      expect(losers).toHaveLength(1);

      const winner = winners[0];
      if (!winner) throw new Error('Missing winner');
      expect(winner.orderState).toBe('COMPLETED');
      expect(winner.publicId).toBeTruthy();

      await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'SOLD', {
        timeoutMs: 20_000,
      });

      const loser = losers[0];
      if (!loser) throw new Error('Missing loser');
      // Loser must fail at hold (preferred) or at order — never also complete.
      expect(loser.won).toBe(false);
      if (loser.holdStatus >= 200 && loser.holdStatus < 300) {
        expect(loser.orderStatus, 'losing hold must not convert to a second sale').not.toBe(
          undefined,
        );
        expect([400, 409, 422]).toContain(loser.orderStatus);
      } else {
        expect([409, 400]).toContain(loser.holdStatus);
      }

      const finalStatus = await ticketStatus(request, seat.eventId, seat.ticketId);
      expect(finalStatus).toBe('SOLD');
    } finally {
      // Only release holds that did not convert; winners are CONVERTED/SOLD.
      for (const attempt of losers) {
        if (attempt.holdId && attempt.holdStatus >= 200 && attempt.holdStatus < 300) {
          await releaseHoldSafe(request, attempt.holdId);
        }
      }
    }
  });
});
