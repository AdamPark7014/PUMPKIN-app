import { expect, type APIRequestContext } from '@playwright/test';
import { environment } from './environment';
import { isJsonObject, jsonObject, type JsonObject } from './api';

export type DiscoveryEvent = {
  id: string;
  slug: string;
  organizationId?: string;
};

export type AvailabilityTicket = {
  id: string;
  seatId: string | null;
  status: string;
  section: string | null;
  row: string | null;
  seatNumber: string | null;
};

export type AvailabilitySnapshot = {
  tickets: AvailabilityTicket[];
  activeHolds: number;
};

export type HoldRecord = {
  id: string;
  seatId?: string | null;
  offerId?: string | null;
  status?: string;
  expiresAt?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseEvent(value: unknown): DiscoveryEvent | null {
  if (!isJsonObject(value)) return null;
  const id = asString(value.id);
  const slug = asString(value.slug);
  if (!id || !slug) return null;
  return {
    id,
    slug,
    organizationId: asString(value.organizationId),
  };
}

export async function listPublishedEvents(
  request: APIRequestContext,
): Promise<DiscoveryEvent[]> {
  const response = await request.get(`${environment.apiUrl}/discovery/events`);
  expect(response.ok(), await response.text()).toBe(true);
  const body: unknown = await response.json();
  expect(Array.isArray(body)).toBe(true);
  if (!Array.isArray(body)) {
    throw new Error('discovery/events did not return an array');
  }
  return body.map(parseEvent).filter((event): event is DiscoveryEvent => event !== null);
}

export async function getEventBySlug(
  request: APIRequestContext,
  slug: string,
): Promise<JsonObject> {
  const response = await request.get(`${environment.apiUrl}/discovery/events/${slug}`);
  expect(response.ok(), await response.text()).toBe(true);
  return jsonObject(response);
}

export async function resolvePurchasableEvent(
  request: APIRequestContext,
  preferredSlug = 'concierto-demo-2026',
): Promise<{ event: DiscoveryEvent; detail: JsonObject; offerId: string }> {
  const events = await listPublishedEvents(request);
  const event = events.find((item) => item.slug === preferredSlug) ?? events[0];
  expect(event, 'Seed must expose at least one discoverable event').toBeTruthy();
  if (!event) {
    throw new Error('No discoverable events available for e2e');
  }
  const detail = await getEventBySlug(request, event.slug);
  const offers = detail.offers;
  expect(Array.isArray(offers), 'Event detail must include offers[]').toBe(true);
  if (!Array.isArray(offers) || offers.length === 0) {
    throw new Error(`Event ${event.slug} has no offers`);
  }
  const firstOffer = offers[0];
  expect(isJsonObject(firstOffer)).toBe(true);
  if (!isJsonObject(firstOffer) || typeof firstOffer.id !== 'string') {
    throw new Error(`Offer payload for ${event.slug} is malformed`);
  }
  return { event: { ...event, id: asString(detail.id) ?? event.id }, detail, offerId: firstOffer.id };
}

export async function getAvailability(
  request: APIRequestContext,
  eventId: string,
): Promise<AvailabilitySnapshot> {
  const response = await request.get(`${environment.apiUrl}/inventory/${eventId}/availability`);
  expect(response.ok(), await response.text()).toBe(true);
  const body = await jsonObject(response);
  expect(Array.isArray(body.tickets)).toBe(true);
  expect(typeof body.activeHolds).toBe('number');
  if (!Array.isArray(body.tickets) || typeof body.activeHolds !== 'number') {
    throw new Error('Malformed availability response');
  }
  const tickets: AvailabilityTicket[] = body.tickets.map((ticket) => {
    expect(isJsonObject(ticket)).toBe(true);
    if (!isJsonObject(ticket)) {
      throw new Error('Ticket row is not an object');
    }
    expect(typeof ticket.id).toBe('string');
    expect(typeof ticket.status).toBe('string');
    if (typeof ticket.id !== 'string' || typeof ticket.status !== 'string') {
      throw new Error('Ticket row missing id/status');
    }
    return {
      id: ticket.id,
      seatId: typeof ticket.seatId === 'string' ? ticket.seatId : null,
      status: ticket.status,
      section: typeof ticket.section === 'string' ? ticket.section : null,
      row: typeof ticket.row === 'string' ? ticket.row : null,
      seatNumber: typeof ticket.seatNumber === 'string' ? ticket.seatNumber : null,
    };
  });
  return { tickets, activeHolds: body.activeHolds };
}

export async function pickAvailableSeatId(
  request: APIRequestContext,
  eventId: string,
): Promise<string> {
  const availability = await getAvailability(request, eventId);
  const seatId = availability.tickets.find(
    (ticket) => ticket.status === 'AVAILABLE' && ticket.seatId,
  )?.seatId;
  expect(seatId, `Event ${eventId} needs an AVAILABLE reserved seat`).toBeTruthy();
  if (!seatId) {
    throw new Error(`No AVAILABLE seat for event ${eventId}`);
  }
  return seatId;
}

export async function createSeatHold(
  request: APIRequestContext,
  input: { eventId: string; seatId: string; sessionId: string; offerId?: string },
): Promise<{ status: number; holds: HoldRecord[]; expiresAt?: string; body: JsonObject }> {
  const response = await request.post(`${environment.apiUrl}/inventory/holds`, {
    data: {
      eventId: input.eventId,
      seatIds: [input.seatId],
      sessionId: input.sessionId,
      offerId: input.offerId,
    },
  });
  const body = await jsonObject(response);
  const holdsRaw = body.holds;
  const holds: HoldRecord[] = Array.isArray(holdsRaw)
    ? holdsRaw.flatMap((item) => {
        if (!isJsonObject(item) || typeof item.id !== 'string') return [];
        return [
          {
            id: item.id,
            seatId: typeof item.seatId === 'string' ? item.seatId : null,
            offerId: typeof item.offerId === 'string' ? item.offerId : null,
            status: typeof item.status === 'string' ? item.status : undefined,
            expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : undefined,
          },
        ];
      })
    : [];
  return {
    status: response.status(),
    holds,
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
    body,
  };
}

export async function releaseHold(
  request: APIRequestContext,
  holdId: string,
): Promise<void> {
  const response = await request.delete(`${environment.apiUrl}/inventory/holds/${holdId}`);
  expect(response.ok(), await response.text()).toBe(true);
}
