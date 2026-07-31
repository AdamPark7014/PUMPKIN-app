import { expect, type APIResponse } from '@playwright/test';
import { isJsonObject, jsonObject, type JsonObject } from '../support/api';

export type SeedEvent = {
  id: string;
  organizationId: string;
  offerId: string;
};

export type AvailableSeat = {
  id: string;
  seatId: string;
};

export type Sale = {
  orderId: string;
  publicId: string;
};

export function requiredString(object: JsonObject, key: string): string {
  const value = object[key];
  expect(typeof value, `Expected ${key} to be a string`).toBe('string');
  if (typeof value !== 'string') {
    throw new Error(`Malformed response: ${key} is not a string`);
  }
  return value;
}

export function requiredNumber(object: JsonObject, key: string): number {
  const value = object[key];
  expect(typeof value, `Expected ${key} to be a number`).toBe('number');
  if (typeof value !== 'number') {
    throw new Error(`Malformed response: ${key} is not a number`);
  }
  return value;
}

export async function seedEvent(response: APIResponse): Promise<SeedEvent> {
  expect(response.status(), await response.text()).toBe(200);
  const body = await jsonObject(response);
  const offers = body.offers;
  expect(Array.isArray(offers) && offers.length > 0, 'Seed event must expose an offer').toBe(true);
  const firstOffer = Array.isArray(offers) ? offers[0] : undefined;
  if (!isJsonObject(firstOffer)) {
    throw new Error('Malformed seed event: first offer is missing');
  }
  return {
    id: requiredString(body, 'id'),
    organizationId: requiredString(body, 'organizationId'),
    offerId: requiredString(firstOffer, 'id'),
  };
}

export async function availableSeat(response: APIResponse): Promise<AvailableSeat> {
  expect(response.status(), await response.text()).toBe(200);
  const body = await jsonObject(response);
  const tickets = body.tickets;
  if (!Array.isArray(tickets)) {
    throw new Error('Malformed availability response: tickets is not an array');
  }
  const candidates = tickets
    .filter(isJsonObject)
    .filter((ticket) => ticket.status === 'AVAILABLE')
    .map((ticket) => ({
      id: typeof ticket.id === 'string' ? ticket.id : '',
      seatId: typeof ticket.seatId === 'string' ? ticket.seatId : '',
    }))
    .filter((ticket) => ticket.id.length > 0 && ticket.seatId.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  expect(candidates.length, 'Seed must contain an available reserved seat').toBeGreaterThan(0);
  const candidate = candidates[0];
  if (!candidate) {
    throw new Error('Seed has no available reserved seat');
  }
  return candidate;
}

export async function responseArray(response: APIResponse): Promise<unknown[]> {
  expect(response.status(), await response.text()).toBe(200);
  const body: unknown = await response.json();
  expect(Array.isArray(body), `Expected JSON array from ${response.url()}`).toBe(true);
  if (!Array.isArray(body)) {
    throw new Error(`Response from ${response.url()} is not a JSON array`);
  }
  return body;
}
