import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  bearer,
  expectProblem,
  isJsonObject,
  jsonObject,
  type AuthSession,
  type JsonObject,
} from '../support/api';
import { environment } from '../support/environment';
import {
  availableSeat,
  requiredNumber,
  requiredString,
  responseArray,
  seedEvent,
  type AvailableSeat,
  type Sale,
  type SeedEvent,
} from './contracts';

export const DEMO_EVENT_SLUG = 'concierto-demo-2026';
export const DEFAULT_MANAGER_PIN = '2468';
export const OPENING_CASH = 1_000;

export type PosContext = {
  testId: string;
  event: SeedEvent;
  seat: AvailableSeat;
  terminalId: string;
  sessionId: string;
  cashierId: string;
  organizationId: string;
};

function authHeaders(session: AuthSession): Record<string, string> {
  return bearer(session);
}

function expectCreatedOrOk(response: APIResponse, label: string): void {
  expect([200, 201], `${label}: ${response.status()} ${response.url()}`).toContain(response.status());
}

export async function requireHealth(request: APIRequestContext): Promise<void> {
  const response = await request.get(`${environment.apiUrl}/health`);
  expect(
    response.ok(),
    `API health check failed at ${environment.apiUrl}/health (${response.status()})`,
  ).toBe(true);
  const body = await jsonObject(response);
  expect(
    body.service,
    `Wrong API at ${environment.apiUrl}/health — expected boletera-api (got ${String(body.service ?? body.product ?? 'unknown')}). Port collision?`,
  ).toBe('boletera-api');
  expect(body.status === 'ok' || body.status === 'degraded').toBe(true);
}

export async function loadSeedEvent(request: APIRequestContext): Promise<SeedEvent> {
  const response = await request.get(`${environment.apiUrl}/discovery/events/${DEMO_EVENT_SLUG}`);
  return seedEvent(response);
}

export async function pickAvailableSeat(
  request: APIRequestContext,
  eventId: string,
): Promise<AvailableSeat> {
  const response = await request.get(`${environment.apiUrl}/inventory/${eventId}/availability`);
  return availableSeat(response);
}

export async function initTerminal(
  request: APIRequestContext,
  session: AuthSession,
  organizationId: string,
  testId: string,
): Promise<string> {
  const response = await request.post(`${environment.apiUrl}/taquilla/terminal/init`, {
    headers: authHeaders(session),
    data: {
      organizationId,
      locationName: `e2e-ops-${testId}`,
      terminalName: `POS-${testId}`,
    },
  });
  expectCreatedOrOk(response, 'terminal/init');
  const body = await jsonObject(response);
  return requiredString(body, 'id');
}

export async function startSession(
  request: APIRequestContext,
  session: AuthSession,
  terminalId: string,
  cashierId: string,
  openingCash = OPENING_CASH,
): Promise<string> {
  const response = await request.post(`${environment.apiUrl}/taquilla/session/start`, {
    headers: authHeaders(session),
    data: { terminalId, cashierId, openingCash },
  });
  expectCreatedOrOk(response, 'session/start');
  const body = await jsonObject(response);
  expect(body.status).toBe('ACTIVE');
  return requiredString(body, 'sessionId');
}

export async function checkoutCashSale(
  request: APIRequestContext,
  session: AuthSession,
  ctx: Pick<PosContext, 'terminalId' | 'sessionId' | 'cashierId' | 'event' | 'seat' | 'testId'>,
): Promise<Sale> {
  const response = await request.post(`${environment.apiUrl}/taquilla/checkout`, {
    headers: authHeaders(session),
    data: {
      terminalId: ctx.terminalId,
      sessionId: ctx.sessionId,
      checkoutData: {
        eventId: ctx.event.id,
        offerId: ctx.event.offerId,
        seatIds: [ctx.seat.seatId],
        paymentMethod: 'CASH',
        cashierId: ctx.cashierId,
        buyerName: `E2E POS ${ctx.testId}`,
        buyerEmail: `e2e+pos-${ctx.testId}@boletera.test`,
        clientSaleId: `e2e-sale-${ctx.testId}`,
      },
    },
  });
  expectCreatedOrOk(response, 'checkout');
  const body = await jsonObject(response);
  expect(body.status).toBe('COMPLETED');
  return {
    orderId: requiredString(body, 'orderId'),
    publicId: requiredString(body, 'publicId'),
  };
}

export async function receiptBarcodes(
  request: APIRequestContext,
  session: AuthSession,
  orderId: string,
  terminalId: string,
): Promise<string[]> {
  const response = await request.get(
    `${environment.apiUrl}/taquilla/receipt/${orderId}?terminalId=${encodeURIComponent(terminalId)}`,
    { headers: authHeaders(session) },
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = await jsonObject(response);
  const ticketCodes = body.ticketCodes;
  expect(Array.isArray(ticketCodes) && ticketCodes.length > 0, 'Receipt must include ticket codes').toBe(
    true,
  );
  if (!Array.isArray(ticketCodes)) {
    throw new Error('Malformed receipt: ticketCodes is not an array');
  }
  const barcodes = ticketCodes
    .filter(isJsonObject)
    .map((ticket) => ticket.barcode)
    .filter((barcode): barcode is string => typeof barcode === 'string' && barcode.length > 0);
  expect(barcodes.length, 'Receipt barcodes missing').toBeGreaterThan(0);
  return barcodes;
}

export async function endSessionZReport(
  request: APIRequestContext,
  session: AuthSession,
  sessionId: string,
  cashierId: string,
  closingCashCounted: number,
): Promise<JsonObject> {
  const response = await request.post(`${environment.apiUrl}/taquilla/session/end`, {
    headers: authHeaders(session),
    data: { sessionId, cashierId, closingCashCounted },
  });
  expectCreatedOrOk(response, 'session/end');
  const body = await jsonObject(response);
  expect(body.zReport).toBe(true);
  expect(body.status).toBe('CLOSED');
  return body;
}

export async function voidOrder(
  request: APIRequestContext,
  session: AuthSession,
  orderId: string,
  cashierId: string,
  sessionId: string | undefined,
  reason: string,
): Promise<void> {
  const payload: {
    orderId: string;
    cashierId: string;
    reason: string;
    managerPin: string;
    sessionId?: string;
  } = {
    orderId,
    cashierId,
    reason,
    managerPin: DEFAULT_MANAGER_PIN,
  };
  if (sessionId !== undefined) {
    payload.sessionId = sessionId;
  }
  const response = await request.post(`${environment.apiUrl}/taquilla/void`, {
    headers: authHeaders(session),
    data: payload,
  });
  expectCreatedOrOk(response, 'void');
  const body = await jsonObject(response);
  expect(typeof body.orderId).toBe('string');
  expect(body.status === 'REFUNDED' || body.status === 'CANCELLED').toBe(true);
}

export async function scanAccess(
  request: APIRequestContext,
  session: AuthSession,
  ticketCode: string,
  scannedBy: string,
): Promise<{ response: APIResponse; body?: JsonObject }> {
  const response = await request.post(`${environment.apiUrl}/access/scan`, {
    headers: authHeaders(session),
    data: {
      ticketCode,
      scannedBy,
      channel: 'TAQUILLA',
    },
  });
  if (response.ok()) {
    return { response, body: await jsonObject(response) };
  }
  return { response };
}

export async function findZReport(
  request: APIRequestContext,
  session: AuthSession,
  organizationId: string,
  sessionId: string,
): Promise<JsonObject> {
  const response = await request.get(
    `${environment.apiUrl}/taquilla/z-reports?organizationId=${encodeURIComponent(organizationId)}`,
    { headers: authHeaders(session) },
  );
  const rows = await responseArray(response);
  const match = rows.filter(isJsonObject).find((row) => row.sessionId === sessionId);
  expect(match, `Z-report for session ${sessionId} not archived`).toBeTruthy();
  if (!match) {
    throw new Error(`Z-report for session ${sessionId} not archived`);
  }
  return match;
}

export function cashierIdFrom(session: AuthSession): string {
  return requiredString(session.user, 'id');
}

export function scannerIdFrom(session: AuthSession): string {
  return requiredString(session.user, 'id');
}

export { expectProblem, requiredNumber, requiredString };


