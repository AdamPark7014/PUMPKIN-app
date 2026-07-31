import { expect, test } from '../support/fixtures';
import { expectProblem } from '../support/api';
import { environment } from '../support/environment';
import {
  attemptSeatHold,
  pickSeatForTest,
  releaseHoldSafe,
  requireApiHealthy,
  ticketStatus,
  waitForTicketStatus,
  waitUntilExpired,
} from './_lib/helpers';

/**
 * TAQUILLA hold TTL is 300s in inventory.service (HOLD_TTL_TAQUILLA_SECONDS).
 * We wait by condition until expiresAt, then assert inventory liberation.
 */
const TAQUILLA_HOLD_TTL_MS = 300_000;
const WORKER_SWEEP_GRACE_MS = 90_000;

test.describe('Inventory API — hold expiry liberates inventory', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('expired TAQUILLA hold frees seat for a new hold (poll, no fixed sleep)', async ({
    request,
    testId,
  }) => {
    test.setTimeout(TAQUILLA_HOLD_TTL_MS + WORKER_SWEEP_GRACE_MS + 60_000);

    const seat = await pickSeatForTest(request, `${testId}-expiry`);
    const sessionId = `inv-expiry-${testId}`;
    let holdId: string | undefined;
    let expiresAt: string | undefined;

    try {
      const created = await attemptSeatHold(request, {
        eventId: seat.eventId,
        seatId: seat.seatId,
        offerId: seat.offerId,
        sessionId,
        channel: 'TAQUILLA',
      });
      expect(
        [200, 201],
        `create hold failed: ${created.status} ${JSON.stringify(created.body)}`,
      ).toContain(created.status);
      expect(created.holdId).toBeTruthy();
      expect(created.expiresAt, 'hold must return expiresAt').toBeTruthy();
      holdId = created.holdId;
      expiresAt = created.expiresAt;

      await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'HELD', {
        timeoutMs: 15_000,
      });

      if (!expiresAt || !holdId) {
        throw new Error('Hold payload incomplete');
      }

      const expiresAtMs = Date.parse(expiresAt);
      expect(expiresAtMs).toBeGreaterThan(Date.now() + 60_000);
      expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + TAQUILLA_HOLD_TTL_MS + 5_000);

      await waitUntilExpired(expiresAt, {
        timeoutMs: TAQUILLA_HOLD_TTL_MS + 30_000,
      });

      // Soft-expiry: checkout must reject the past-due hold even if ticket is still HELD.
      const orderResponse = await request.post(`${environment.apiUrl}/orders`, {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `inv-expiry-order-${testId}`,
        },
        data: {
          eventId: seat.eventId,
          offerId: seat.offerId,
          holdIds: [holdId],
          items: [{ offerId: seat.offerId, holdIds: [holdId] }],
          buyerName: 'Inventory Expiry Probe',
          buyerEmail: `inventory-expiry-${testId.slice(0, 8)}@boletera.test`,
          paymentMethod: 'CASH',
        },
      });
      await expectProblem(orderResponse, [400]);

      // Hard liberation: worker (or equivalent) must return ticket to AVAILABLE.
      // Poll by condition — if this times out, inventory is stuck after expiresAt.
      try {
        await waitForTicketStatus(request, seat.eventId, seat.ticketId, 'AVAILABLE', {
          timeoutMs: WORKER_SWEEP_GRACE_MS,
          intervalMs: 1_000,
        });
      } catch (error) {
        const stuck = await ticketStatus(request, seat.eventId, seat.ticketId);
        throw new Error(
          [
            'Hold expired but inventory was not liberated.',
            `ticketId=${seat.ticketId} seatId=${seat.seatId} status=${stuck}`,
            `holdId=${holdId} expiresAt=${expiresAt}`,
            'Cause (production): apps/worker/src/jobs/handlers.ts releaseExpiredHolds',
            'and/or apps/api/src/modules/inventory/inventory.service.ts createHold',
            'only frees HELD tickets when worker sweeps ACTIVE+past-due holds;',
            'API createHold never lazy-expires on read.',
            `poll error: ${error instanceof Error ? error.message : String(error)}`,
          ].join(' '),
        );
      }

      holdId = undefined;

      const reclaim = await attemptSeatHold(request, {
        eventId: seat.eventId,
        seatId: seat.seatId,
        offerId: seat.offerId,
        sessionId: `${sessionId}-after-expiry`,
        channel: 'WEB',
      });
      expect(
        [200, 201],
        `seat not reclaimable after expiry: ${reclaim.status} ${JSON.stringify(reclaim.body)}`,
      ).toContain(reclaim.status);
      holdId = reclaim.holdId;
    } finally {
      await releaseHoldSafe(request, holdId);
    }
  });
});
