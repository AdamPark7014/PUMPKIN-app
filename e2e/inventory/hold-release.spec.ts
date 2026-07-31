import { expect, test } from '../support/fixtures';
import {
  attemptSeatHold,
  pickSeatForTest,
  releaseHoldSafe,
  requireApiHealthy,
  waitForTicketStatus,
} from './_lib/helpers';

test.describe('Inventory API — hold release frees seat', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('DELETE hold liberates inventory (poll until AVAILABLE) and seat can be re-held', async ({
    request,
    testId,
  }) => {
    const seat = await pickSeatForTest(request, `${testId}-release`);
    const sessionId = `inv-release-${testId}`;
    let holdId: string | undefined;

    try {
      const created = await attemptSeatHold(request, {
        eventId: seat.eventId,
        seatId: seat.seatId,
        offerId: seat.offerId,
        sessionId,
      });
      expect(
        [200, 201],
        `create hold failed: ${created.status} ${JSON.stringify(created.body)}`,
      ).toContain(created.status);
      expect(created.holdId, 'hold id required').toBeTruthy();
      holdId = created.holdId;

      await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'HELD', {
        timeoutMs: 15_000,
      });

      await releaseHoldSafe(request, holdId);
      holdId = undefined;

      await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'AVAILABLE', {
        timeoutMs: 20_000,
      });

      const reclaim = await attemptSeatHold(request, {
        eventId: seat.eventId,
        seatId: seat.seatId,
        offerId: seat.offerId,
        sessionId: `${sessionId}-reclaim`,
      });
      expect(
        [200, 201],
        `re-hold after release failed: ${reclaim.status} ${JSON.stringify(reclaim.body)}`,
      ).toContain(reclaim.status);
      expect(reclaim.holdId).toBeTruthy();
      holdId = reclaim.holdId;

      await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'HELD', {
        timeoutMs: 15_000,
      });
    } finally {
      await releaseHoldSafe(request, holdId);
    }
  });
});
