import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  expectProblem,
  jsonObject,
  type JsonObject,
} from '../../support/api';
import { environment, seedUsers } from '../../support/environment';
import { authHeadersCached, loginCached } from './auth-cache';
import {
  assertAvailability,
  assertDiscoveryEventCard,
  assertHoldResponse,
  isString,
  requireObject,
  requireString,
} from './guards';
import { metricsRange, seedEvents, type MetricsPath } from './seed';

export function apiUrl(path: string): string {
  const base = environment.apiUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function metricsUrl(
  path: MetricsPath,
  params: Record<string, string | undefined> = {},
): string {
  const search = new URLSearchParams();
  search.set('from', params.from ?? metricsRange.from);
  search.set('to', params.to ?? metricsRange.to);
  if (params.organizationId) search.set('organizationId', params.organizationId);
  if (params.eventId) search.set('eventId', params.eventId);
  if (params.metric) search.set('metric', params.metric);
  if (params.granularity) search.set('granularity', params.granularity);
  if (params.page) search.set('page', params.page);
  if (params.pageSize) search.set('pageSize', params.pageSize);
  return apiUrl(`/metrics/${path}?${search.toString()}`);
}

export async function loginAs(
  request: APIRequestContext,
  user: (typeof seedUsers)[keyof typeof seedUsers],
) {
  return loginCached(request, user);
}

export async function authHeaders(
  request: APIRequestContext,
  user: (typeof seedUsers)[keyof typeof seedUsers],
): Promise<Record<string, string>> {
  return authHeadersCached(request, user);
}

/** Fail hard if API is down or is not Boletera — never silent-skip. */
export async function requireApiHealthy(request: APIRequestContext): Promise<void> {
  const response = await request.get(apiUrl('/health'));
  const raw = await response.text();
  expect(
    response.status(),
    `Boletera API health required at ${apiUrl('/health')} (got ${response.status()}: ${raw})`,
  ).toBe(200);
  let body: JsonObject;
  try {
    const parsed: unknown = JSON.parse(raw);
    expect(
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      `Health body must be JSON object: ${raw}`,
    ).toBe(true);
    body = parsed as JsonObject;
  } catch (error) {
    throw new Error(`Health body is not JSON from ${apiUrl('/health')}: ${raw}`);
  }
  expect(
    body.service,
    `Wrong process on API_URL — expected boletera-api, body=${raw}`,
  ).toBe('boletera-api');
  expect(body.status, `boletera-api health.status must be ok; body=${raw}`).toBe('ok');
}

export async function fetchEventBySlug(
  request: APIRequestContext,
  slug: string,
): Promise<JsonObject> {
  const response = await request.get(apiUrl(`/discovery/events/${slug}`));
  expect(
    response.status(),
    `Seed event ${slug} must exist: ${await response.text()}`,
  ).toBe(200);
  const body = await jsonObject(response);
  assertDiscoveryEventCard(body, `discovery.events.${slug}`);
  expect(body.slug).toBe(slug);
  return body;
}

export type SeedSeat = {
  ticketId: string;
  seatId: string;
  section: string | null;
  offerId: string;
};

/** Pick an AVAILABLE seated ticket deterministically from testId (no listing-order dependency). */
export async function pickAvailableSeat(
  request: APIRequestContext,
  eventId: string,
  offers: unknown[],
  testId: string,
): Promise<SeedSeat> {
  const response = await request.get(apiUrl(`/inventory/${eventId}/availability`));
  expect(response.status(), await response.text()).toBe(200);
  const body = await jsonObject(response);
  const { tickets } = assertAvailability(body);

  const available = tickets
    .filter((t) => t.status === 'AVAILABLE' && isString(t.seatId))
    .sort((a, b) => String(a.seatId).localeCompare(String(b.seatId)));

  expect(
    available.length,
    `Event ${eventId} must have AVAILABLE seated inventory for contracts`,
  ).toBeGreaterThan(0);

  let hash = 0;
  for (let i = 0; i < testId.length; i++) {
    hash = (Math.imul(hash, 31) + testId.charCodeAt(i)) >>> 0;
  }
  const ticket = available[hash % available.length]!;
  const offer = offers
    .map((o, i) => requireObject(o, `offer[${i}]`))
    .find((o) => o.name === ticket.section || o.zone === sectionToZone(ticket.section));

  expect(
    offer,
    `No offer matched section=${ticket.section} for seat ${ticket.seatId}`,
  ).toBeTruthy();
  if (!offer) throw new Error('offer missing');

  return {
    ticketId: ticket.id,
    seatId: String(ticket.seatId),
    section: ticket.section,
    offerId: requireString(offer, 'id'),
  };
}

function sectionToZone(section: string | null): string | null {
  if (!section) return null;
  return section
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

export async function createSeatHold(
  request: APIRequestContext,
  args: { eventId: string; offerId: string; seatId: string; sessionId: string },
): Promise<{ holdIds: string[]; expiresAt: string; response: APIResponse }> {
  const response = await request.post(apiUrl('/inventory/holds'), {
    data: {
      eventId: args.eventId,
      offerId: args.offerId,
      seatIds: [args.seatId],
      sessionId: args.sessionId,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await jsonObject(response);
  const parsed = assertHoldResponse(body);
  return { ...parsed, response };
}

export async function releaseHoldSafe(
  request: APIRequestContext,
  holdId: string | undefined,
): Promise<void> {
  if (!holdId) return;
  const response = await request.delete(apiUrl(`/inventory/holds/${holdId}`));
  // 200/201 success, 404/409 already converted/expired — all acceptable cleanup outcomes
  expect([200, 201, 404, 409], await response.text()).toContain(response.status());
}

export async function expectUnauthorized(
  response: APIResponse,
  allowed: readonly number[] = [401],
): Promise<JsonObject> {
  return expectProblem(response, allowed);
}

export async function expectForbidden(
  response: APIResponse,
  allowed: readonly number[] = [403],
): Promise<JsonObject> {
  return expectProblem(response, allowed);
}

export { seedEvents, seedUsers, metricsRange };
