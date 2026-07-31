import { expect, test } from '../support/fixtures';
import { jsonObject } from '../support/api';
import { assertAvailability, requireBoolean } from './_lib/guards';
import {
  apiUrl,
  createSeatHold,
  fetchEventBySlug,
  pickAvailableSeat,
  releaseHoldSafe,
  requireApiHealthy,
  seedEvents,
} from './_lib/helpers';

test.describe('API contracts — /inventory/*', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('GET availability for seed concierto-demo has tickets + activeHolds', async ({
    request,
  }) => {
    const event = await fetchEventBySlug(request, seedEvents.conciertoDemo.slug);
    expect(event.id).toBe(seedEvents.conciertoDemo.id);

    const response = await request.get(
      apiUrl(`/inventory/${seedEvents.conciertoDemo.id}/availability`),
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = await jsonObject(response);
    const avail = assertAvailability(body);
    expect(avail.tickets.length).toBeGreaterThan(0);
    expect(avail.activeHolds).toBeGreaterThanOrEqual(0);
    const statuses = new Set(avail.tickets.map((t) => t.status));
    expect(statuses.has('AVAILABLE') || statuses.has('SOLD')).toBe(true);
  });

  test('GET map for seed event returns seat-map snapshot object', async ({ request }) => {
    const response = await request.get(
      apiUrl(`/inventory/${seedEvents.conciertoDemo.id}/map`),
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = await jsonObject(response);
    expect(body).toBeTruthy();
    // Snapshot shape varies by venue template; require object with sections when present.
    if ('sections' in body) {
      expect(Array.isArray(body.sections)).toBe(true);
    }
  });

  test('GET availability for unknown event returns empty tickets (no 5xx)', async ({
    request,
  }) => {
    const response = await request.get(
      apiUrl('/inventory/evt_does_not_exist_contracts_xyz/availability'),
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = await jsonObject(response);
    const avail = assertAvailability(body);
    expect(avail.tickets).toEqual([]);
    expect(avail.activeHolds).toBe(0);
  });

  test('POST holds creates ACTIVE hold and DELETE releases inventory', async ({
    request,
    testId,
  }) => {
    const event = await fetchEventBySlug(request, seedEvents.conciertoDemo.slug);
    const offers = Array.isArray(event.offers) ? event.offers : [];
    const seat = await pickAvailableSeat(request, String(event.id), offers, testId);
    const sessionId = `contracts-inv-${testId}`;

    let holdId: string | undefined;
    try {
      const hold = await createSeatHold(request, {
        eventId: String(event.id),
        offerId: seat.offerId,
        seatId: seat.seatId,
        sessionId,
      });
      holdId = hold.holdIds[0];
      expect(holdId).toBeTruthy();

      const mid = await request.get(apiUrl(`/inventory/${event.id}/availability`));
      expect(mid.status()).toBe(200);
      const midBody = assertAvailability(await jsonObject(mid));
      const held = midBody.tickets.find((t) => t.id === seat.ticketId);
      expect(held?.status, 'ticket must be HELD after create').toBe('HELD');

      const release = await request.delete(apiUrl(`/inventory/holds/${holdId}`));
      expect(release.status(), await release.text()).toBe(200);
      const releaseBody = await jsonObject(release);
      expect(requireBoolean(releaseBody, 'released')).toBe(true);
      holdId = undefined;

      const after = await request.get(apiUrl(`/inventory/${event.id}/availability`));
      const afterBody = assertAvailability(await jsonObject(after));
      const free = afterBody.tickets.find((t) => t.id === seat.ticketId);
      expect(free?.status, 'ticket must be AVAILABLE after release').toBe('AVAILABLE');
    } finally {
      await releaseHoldSafe(request, holdId);
    }
  });

  test('POST holds without seatIds/offerId returns 400', async ({ request }) => {
    const response = await request.post(apiUrl('/inventory/holds'), {
      data: { eventId: seedEvents.conciertoDemo.id, sessionId: 'contracts-bad' },
    });
    expect([400], await response.text()).toContain(response.status());
    const body = await jsonObject(response);
    expect(body.statusCode).toBe(400);
  });
});
