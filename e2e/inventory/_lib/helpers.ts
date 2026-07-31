import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  expectProblem,
  isJsonObject,
  jsonObject,
  type JsonObject,
} from '../../support/api';
import {
  getAvailability,
  getEventBySlug,
  type AvailabilityTicket,
  type HoldRecord,
} from '../../support/discovery';
import { environment } from '../../support/environment';

/** Deterministic on-sale seed event — selected by slug, never by listing order. */
export const INVENTORY_SEED_EVENT_SLUG = 'concierto-demo-2026' as const;

export type SeededSeat = {
  eventId: string;
  offerId: string;
  ticketId: string;
  seatId: string;
  section: string | null;
};

export type HoldAttempt = {
  status: number;
  ok: boolean;
  holdId?: string;
  expiresAt?: string;
  body: JsonObject;
  response: APIResponse;
};

export type PurchaseAttempt = {
  label: string;
  holdStatus: number;
  orderStatus?: number;
  won: boolean;
  holdId?: string;
  orderId?: string;
  publicId?: string;
  orderState?: string;
  errorBody?: JsonObject;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function sectionToZone(section: string | null): string | null {
  if (!section) return null;
  return section
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function parseHoldRecords(body: JsonObject): HoldRecord[] {
  const holdsRaw = body.holds;
  if (!Array.isArray(holdsRaw)) return [];
  return holdsRaw.flatMap((item) => {
    if (!isJsonObject(item) || typeof item.id !== 'string') return [];
    const record: HoldRecord = {
      id: item.id,
      seatId: typeof item.seatId === 'string' ? item.seatId : null,
      offerId: typeof item.offerId === 'string' ? item.offerId : null,
    };
    if (typeof item.status === 'string') record.status = item.status;
    if (typeof item.expiresAt === 'string') record.expiresAt = item.expiresAt;
    return [record];
  });
}

/** Fail hard when API/DB are unavailable — never silent-skip. */
export async function requireApiHealthy(request: APIRequestContext): Promise<void> {
  let response: APIResponse;
  try {
    response = await request.get(`${environment.apiUrl}/health`);
  } catch (error) {
    throw new Error(
      [
        `Boletera API unreachable at ${environment.apiUrl}/health.`,
        'Start boletera-api (not another product on :4000) or set API_URL / E2E_INVENTORY_API_PORT.',
        error instanceof Error ? error.message : String(error),
      ].join(' '),
    );
  }
  const raw = await response.text();
  expect(
    response.status(),
    `API health required for inventory e2e (got ${response.status()}: ${raw})`,
  ).toBe(200);
  let body: JsonObject;
  try {
    const parsed: unknown = JSON.parse(raw);
    expect(isJsonObject(parsed), `Health JSON from ${environment.apiUrl}`).toBe(true);
    if (!isJsonObject(parsed)) throw new Error('health is not a JSON object');
    body = parsed;
  } catch (error) {
    throw new Error(
      `Unreadable health payload from ${environment.apiUrl}: ${raw} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  expect(
    body.service,
    `Wrong process on ${environment.apiUrl} (payload=${raw}). Expected boletera-api.`,
  ).toBe('boletera-api');
  expect(body.status, 'health.status').toBe('ok');
  expect(body.database, 'health.database must be up').toBe('up');
}

export async function resolveSeedEvent(
  request: APIRequestContext,
): Promise<{ eventId: string; slug: string; offers: JsonObject[] }> {
  const detail = await getEventBySlug(request, INVENTORY_SEED_EVENT_SLUG);
  expect(detail.slug).toBe(INVENTORY_SEED_EVENT_SLUG);
  expect(typeof detail.id).toBe('string');
  if (typeof detail.id !== 'string') {
    throw new Error(`Seed event ${INVENTORY_SEED_EVENT_SLUG} missing id`);
  }
  const offersRaw = detail.offers;
  expect(Array.isArray(offersRaw), 'Event detail must include offers[]').toBe(true);
  if (!Array.isArray(offersRaw) || offersRaw.length === 0) {
    throw new Error(`Seed event ${INVENTORY_SEED_EVENT_SLUG} has no offers`);
  }
  const offers = offersRaw.map((offer, index) => {
    expect(isJsonObject(offer), `offers[${index}]`).toBe(true);
    if (!isJsonObject(offer)) throw new Error(`offers[${index}] invalid`);
    expect(typeof offer.id).toBe('string');
    return offer;
  });
  return { eventId: detail.id, slug: INVENTORY_SEED_EVENT_SLUG, offers };
}

/**
 * Pick an AVAILABLE seated ticket using testId hash over a seatId-sorted list.
 * Avoids depending on API row order.
 */
export async function pickSeatForTest(
  request: APIRequestContext,
  testId: string,
): Promise<SeededSeat> {
  const { eventId, offers } = await resolveSeedEvent(request);
  const availability = await getAvailability(request, eventId);
  const available = availability.tickets
    .filter((ticket): ticket is AvailabilityTicket & { seatId: string } =>
      Boolean(ticket.status === 'AVAILABLE' && ticket.seatId),
    )
    .sort((a, b) => a.seatId.localeCompare(b.seatId));

  expect(
    available.length,
    `Seed event ${eventId} must expose AVAILABLE seated inventory`,
  ).toBeGreaterThan(0);

  const ticket = available[hashString(testId) % available.length];
  if (!ticket) {
    throw new Error('Deterministic seat selection failed');
  }

  const zone = sectionToZone(ticket.section);
  const offer = offers.find((item) => {
    const name = typeof item.name === 'string' ? item.name : null;
    const offerZone = typeof item.zone === 'string' ? item.zone : null;
    return name === ticket.section || (zone !== null && offerZone === zone);
  });
  expect(
    offer,
    `No offer matched section=${ticket.section} seat=${ticket.seatId}`,
  ).toBeTruthy();
  if (!offer || typeof offer.id !== 'string') {
    throw new Error(`Offer missing for section ${ticket.section}`);
  }

  return {
    eventId,
    offerId: offer.id,
    ticketId: ticket.id,
    seatId: ticket.seatId,
    section: ticket.section,
  };
}

export async function attemptSeatHold(
  request: APIRequestContext,
  args: {
    eventId: string;
    seatId: string;
    sessionId: string;
    offerId?: string;
    channel?: 'WEB' | 'TAQUILLA';
  },
): Promise<HoldAttempt> {
  const headers: Record<string, string> = {};
  if (args.channel) headers['x-channel'] = args.channel;

  const response = await request.post(`${environment.apiUrl}/inventory/holds`, {
    headers,
    data: {
      eventId: args.eventId,
      seatIds: [args.seatId],
      sessionId: args.sessionId,
      offerId: args.offerId,
    },
  });
  const body = await jsonObject(response);
  const holds = parseHoldRecords(body);
  const holdId = holds[0]?.id;
  const expiresAt =
    typeof body.expiresAt === 'string'
      ? body.expiresAt
      : holds[0]?.expiresAt;

  const attempt: HoldAttempt = {
    status: response.status(),
    ok: response.ok(),
    body,
    response,
  };
  if (holdId) attempt.holdId = holdId;
  if (expiresAt) attempt.expiresAt = expiresAt;
  return attempt;
}

export async function releaseHoldSafe(
  request: APIRequestContext,
  holdId: string | undefined,
): Promise<void> {
  if (!holdId) return;
  const response = await request.delete(`${environment.apiUrl}/inventory/holds/${holdId}`);
  expect([200, 201, 404, 409], await response.text()).toContain(response.status());
}

export async function ticketStatus(
  request: APIRequestContext,
  eventId: string,
  ticketId: string,
): Promise<string | undefined> {
  const availability = await getAvailability(request, eventId);
  return availability.tickets.find((ticket) => ticket.id === ticketId)?.status;
}

/** Wait until ticket reaches an expected status — no fixed sleep. */
export async function waitForTicketStatus(
  request: APIRequestContext,
  eventId: string,
  ticketId: string,
  expected: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<string> {
  const timeout = options?.timeoutMs ?? 30_000;
  const intervals = options?.intervalMs ?? 500;
  let last: string | undefined;
  await expect
    .poll(
      async () => {
        last = await ticketStatus(request, eventId, ticketId);
        return last;
      },
      {
        message: `ticket ${ticketId} → ${expected} (last=${last ?? 'missing'})`,
        timeout,
        intervals: [intervals],
      },
    )
    .toBe(expected);
  if (last !== expected) {
    throw new Error(`Expected ticket ${ticketId} status ${expected}, got ${last}`);
  }
  return last;
}

/** Wait until wall clock passes an ISO expiresAt — condition poll, not sleep(). */
export async function waitUntilExpired(
  expiresAtIso: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const expiresAtMs = Date.parse(expiresAtIso);
  expect(Number.isFinite(expiresAtMs), `Invalid expiresAt: ${expiresAtIso}`).toBe(true);
  const timeout = options?.timeoutMs ?? Math.max(expiresAtMs - Date.now() + 30_000, 5_000);
  await expect
    .poll(() => Date.now() > expiresAtMs, {
      message: `wall clock past hold expiresAt ${expiresAtIso}`,
      timeout,
      intervals: [250],
    })
    .toBe(true);
}

export async function attemptHoldThenCashPurchase(
  request: APIRequestContext,
  args: {
    label: string;
    eventId: string;
    offerId: string;
    seatId: string;
    sessionId: string;
    testId: string;
  },
): Promise<PurchaseAttempt> {
  const hold = await attemptSeatHold(request, {
    eventId: args.eventId,
    seatId: args.seatId,
    offerId: args.offerId,
    sessionId: args.sessionId,
    channel: 'WEB',
  });

  if (!hold.ok || !hold.holdId) {
    const failed: PurchaseAttempt = {
      label: args.label,
      holdStatus: hold.status,
      won: false,
      errorBody: hold.body,
    };
    return failed;
  }

  const holdId = hold.holdId;
  const orderResponse = await request.post(`${environment.apiUrl}/orders`, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `${args.testId}-${args.label}`,
    },
    data: {
      eventId: args.eventId,
      offerId: args.offerId,
      holdIds: [holdId],
      items: [{ offerId: args.offerId, holdIds: [holdId] }],
      buyerName: `Inventory E2E ${args.label}`,
      buyerEmail: `inventory-${args.label}-${args.testId.slice(0, 8)}@boletera.test`,
      paymentMethod: 'CASH',
    },
  });

  if (!orderResponse.ok()) {
    const rawText = await orderResponse.text();
    let errorBody: JsonObject = { message: rawText };
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (isJsonObject(parsed)) errorBody = parsed;
    } catch {
      // keep text fallback
    }
    await releaseHoldSafe(request, holdId);
    return {
      label: args.label,
      holdStatus: hold.status,
      orderStatus: orderResponse.status(),
      won: false,
      holdId,
      errorBody,
    };
  }

  const orderBody = await jsonObject(orderResponse);
  expect(typeof orderBody.id).toBe('string');
  expect(typeof orderBody.publicId).toBe('string');
  expect(typeof orderBody.status).toBe('string');
  const orderState = typeof orderBody.status === 'string' ? orderBody.status : undefined;
  const won = orderState === 'COMPLETED';

  if (!won) {
    await releaseHoldSafe(request, holdId);
  }

  const result: PurchaseAttempt = {
    label: args.label,
    holdStatus: hold.status,
    orderStatus: orderResponse.status(),
    won,
    holdId,
  };
  if (typeof orderBody.id === 'string') result.orderId = orderBody.id;
  if (typeof orderBody.publicId === 'string') result.publicId = orderBody.publicId;
  if (orderState) result.orderState = orderState;
  return result;
}

export async function expectHoldConflict(response: APIResponse): Promise<JsonObject> {
  return expectProblem(response, [409, 400]);
}
