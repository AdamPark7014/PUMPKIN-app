import type { APIRequestContext, APIResponse } from '@playwright/test';
import { isJsonObject, jsonObject, type JsonObject } from '../support/api';
import { environment } from '../support/environment';
import { expect, test } from '../support/fixtures';

type DiscoveryEvent = {
  id: string;
  slug: string;
  title: string;
  sale: {
    canPurchase: boolean;
    requiresCode: boolean;
    state: string;
  };
  offers: StorefrontOffer[];
};

type StorefrontOffer = {
  id: string;
  name: string;
  zone: string;
  remainingQuantity: number;
};

type PaymentConfig = {
  gateway: string;
  demo: boolean;
  methods: string[];
};

type HoldResult = {
  holdIds: string[];
  expiresAt: string;
};

type CreatedOrder = {
  id: string;
  publicId: string;
  status: string;
};

function requiredString(value: unknown, path: string): string {
  expect(typeof value, `${path} must be a string`).toBe('string');
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  expect(typeof value, `${path} must be a boolean`).toBe('boolean');
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function requiredNumber(value: unknown, path: string): number {
  expect(typeof value, `${path} must be a number`).toBe('number');
  if (typeof value !== 'number') throw new Error(`${path} must be a number`);
  return value;
}

function objectArray(value: unknown, path: string): JsonObject[] {
  expect(Array.isArray(value), `${path} must be an array`).toBe(true);
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((entry, index) => {
    expect(isJsonObject(entry), `${path}[${index}] must be an object`).toBe(true);
    if (!isJsonObject(entry)) throw new Error(`${path}[${index}] must be an object`);
    return entry;
  });
}

async function jsonArray(response: APIResponse, label: string): Promise<JsonObject[]> {
  expect(response.ok(), `${label}: ${response.status()} ${await response.text()}`).toBe(true);
  const value: unknown = await response.json();
  return objectArray(value, label);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseOffer(value: JsonObject, path: string): StorefrontOffer {
  return {
    id: requiredString(value.id, `${path}.id`),
    name: requiredString(value.name, `${path}.name`),
    zone: requiredString(value.zone, `${path}.zone`),
    remainingQuantity: requiredNumber(value.remainingQuantity, `${path}.remainingQuantity`),
  };
}

function parseEvent(value: JsonObject, index: number): DiscoveryEvent {
  const path = `events[${index}]`;
  expect(isJsonObject(value.sale), `${path}.sale must be an object`).toBe(true);
  if (!isJsonObject(value.sale)) throw new Error(`${path}.sale must be an object`);
  return {
    id: requiredString(value.id, `${path}.id`),
    slug: requiredString(value.slug, `${path}.slug`),
    title: requiredString(value.title, `${path}.title`),
    sale: {
      canPurchase: requiredBoolean(value.sale.canPurchase, `${path}.sale.canPurchase`),
      requiresCode: requiredBoolean(value.sale.requiresCode, `${path}.sale.requiresCode`),
      state: requiredString(value.sale.state, `${path}.sale.state`),
    },
    offers: objectArray(value.offers, `${path}.offers`).map((offer, offerIndex) =>
      parseOffer(offer, `${path}.offers[${offerIndex}]`),
    ),
  };
}

async function purchasableEvent(request: APIRequestContext): Promise<{
  event: DiscoveryEvent;
  offer: StorefrontOffer;
}> {
  const response = await request.get(`${environment.apiUrl}/discovery/events`, {
    params: { limit: 60 },
  });
  const events = (await jsonArray(response, 'GET /discovery/events')).map(parseEvent);
  const candidates = events
    .filter((event) => event.sale.canPurchase && !event.sale.requiresCode)
    .map((event) => ({
      event,
      offer: event.offers.find((offer) => offer.remainingQuantity > 0),
    }))
    .filter(
      (candidate): candidate is { event: DiscoveryEvent; offer: StorefrontOffer } =>
        candidate.offer !== undefined,
    );

  expect(
    candidates.length,
    [
      'The public catalog must expose an ungated, purchasable event with available inventory.',
      'If GET /discovery/events returns [] on loopback, verify DEMO_TENANT_SLUG matches a seeded org',
      '(seed uses boletera-plataforma; TenantService defaults to demo-boletera).',
    ].join(' '),
  ).toBeGreaterThan(0);

  const preferred =
    candidates.find(({ event }) => event.slug === 'concierto-demo-2026') ?? candidates[0];
  if (!preferred) throw new Error('No purchasable storefront event was returned');
  return preferred;
}

async function paymentConfig(request: APIRequestContext): Promise<PaymentConfig> {
  const response = await request.get(`${environment.apiUrl}/payments/config`);
  expect(
    response.ok(),
    `GET /payments/config: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  const body = await jsonObject(response);
  const methods = body.methods;
  expect(Array.isArray(methods), 'payments.config.methods must be an array').toBe(true);
  if (!Array.isArray(methods)) throw new Error('payments.config.methods must be an array');
  return {
    gateway: requiredString(body.gateway, 'payments.config.gateway'),
    demo: requiredBoolean(body.demo, 'payments.config.demo'),
    methods: methods.map((method, index) =>
      requiredString(method, `payments.config.methods[${index}]`),
    ),
  };
}

async function releaseHolds(request: APIRequestContext, holdIds: readonly string[]): Promise<void> {
  for (const holdId of holdIds) {
    const response = await request.delete(
      `${environment.apiUrl}/inventory/holds/${encodeURIComponent(holdId)}`,
    );
    expect(
      response.ok(),
      `Cleanup DELETE /inventory/holds/${holdId}: ${response.status()} ${await response.text()}`,
    ).toBe(true);
  }
}

function parseHold(body: JsonObject): HoldResult {
  const holds = objectArray(body.holds, 'hold.holds');
  const holdIds = holds.map((hold, index) => requiredString(hold.id, `hold.holds[${index}].id`));
  expect(holdIds, 'A successful storefront hold must contain at least one hold').not.toHaveLength(0);
  return {
    holdIds,
    expiresAt: requiredString(body.expiresAt, 'hold.expiresAt'),
  };
}

function parseOrder(body: JsonObject): CreatedOrder {
  return {
    id: requiredString(body.id, 'order.id'),
    publicId: requiredString(body.publicId, 'order.publicId'),
    status: requiredString(body.status, 'order.status'),
  };
}

test.describe('Storefront discovery and purchase', () => {
  test('searches, reserves inventory, pays in demo and shows issued tickets', async ({
    page,
    request,
    testId,
  }) => {
    test.setTimeout(90_000);

    const config = await paymentConfig(request);
    expect(config.gateway, 'The storefront payment contract requires Banorte').toBe('BANORTE');
    expect(config.methods, 'SPEI must be offered by the configured gateway').toContain('SPEI');
    expect(
      config.demo,
      'Automated payment confirmation is intentionally unavailable in live Banorte mode: production completion requires a signed IPN webhook. Run this mutation against the demo gateway (no BANORTE_MERCHANT_ID).',
    ).toBe(true);

    const { event, offer } = await purchasableEvent(request);
    const buyerEmail = `${testId.toLowerCase()}@e2e.boletera.test`;
    let activeHoldIds: string[] = [];
    let completed = false;

    test.info().annotations.push(
      { type: 'event', description: `${event.slug} (${event.id})` },
      { type: 'offer', description: `${offer.name} (${offer.id})` },
      { type: 'buyer', description: buyerEmail },
    );

    try {
      await page.goto('/');
      const search = page.getByRole('search');
      await expect(search).toBeVisible();
      await search.getByRole('searchbox', { name: 'Buscar eventos' }).fill(event.title);

      const filteredResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname.endsWith('/discovery/events') &&
          url.searchParams.get('q') === event.title
        );
      });
      await search.getByRole('button', { name: 'Buscar', exact: true }).click();
      expect((await filteredResponse).ok(), 'The UI discovery request must succeed').toBe(true);

      const eventLink = page
        .getByRole('link', { name: new RegExp(escapeRegExp(event.title), 'i') })
        .first();
      await expect(eventLink).toBeVisible();
      await eventLink.click();
      await expect(page).toHaveURL(new RegExp(`/events/${escapeRegExp(event.slug)}(?:\\?.*)?$`));
      await expect(page.getByRole('heading', { level: 1, name: event.title })).toBeVisible();

      const offerButton = page.getByRole('button', {
        name: new RegExp(`^${escapeRegExp(offer.name)}`),
      });
      await expect(offerButton).toBeVisible();
      await offerButton.click();
      await expect(page).toHaveURL(
        new RegExp(
          `/events/${escapeRegExp(event.slug)}\\?zone=${escapeRegExp(encodeURIComponent(offer.zone))}$`,
        ),
      );
      await expect(offerButton).toHaveAttribute('aria-pressed', 'true');

      const purchase = page.getByLabel('Comprar');
      await expect(purchase).toBeVisible();
      await purchase.getByRole('button', { name: 'Mejor disponible', exact: true }).click();
      await purchase.getByRole('button', { name: 'Menos', exact: true }).click();

      const holdResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/inventory/holds/best-available'),
      );
      await purchase.getByRole('button', { name: 'Continuar al pago', exact: true }).click();
      const holdResponse = await holdResponsePromise;
      expect(
        holdResponse.ok(),
        `Seat hold failed: ${holdResponse.status()} ${await holdResponse.text()}`,
      ).toBe(true);
      const hold = parseHold(await jsonObject(holdResponse));
      activeHoldIds = hold.holdIds;
      expect(Date.parse(hold.expiresAt), 'Hold expiry must be a valid timestamp').toBeGreaterThan(
        Date.now(),
      );

      await expect(page).toHaveURL(/\/checkout\?/);
      await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
      await page.getByLabel('Nombre completo').fill('Comprador E2E Storefront');
      await page.getByLabel('Email').fill(buyerEmail);
      await page.getByRole('radio', { name: /^SPEI/ }).click();
      await expect(page.getByRole('radio', { name: /^SPEI/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );

      const orderResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/orders'),
      );
      await page.getByRole('button', { name: /^Simular pago/ }).click();
      const orderResponse = await orderResponsePromise;
      expect(
        orderResponse.ok(),
        `Order creation failed: ${orderResponse.status()} ${await orderResponse.text()}`,
      ).toBe(true);
      const order = parseOrder(await jsonObject(orderResponse));
      expect(order.status, 'SPEI orders must remain pending until confirmation').toBe('PENDING');
      test.info().annotations.push({
        type: 'order',
        description: `${order.publicId} (${order.id})`,
      });

      await expect(page).toHaveURL(
        new RegExp(`/orders/${escapeRegExp(order.publicId)}/pago\\?method=SPEI$`),
      );
      await expect(page.getByRole('heading', { name: 'Instrucciones de pago' })).toBeVisible();

      const confirmResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/payments/confirm'),
      );
      await page.getByRole('button', { name: 'Simular acreditamiento', exact: true }).click();
      const confirmResponse = await confirmResponsePromise;
      expect(
        confirmResponse.ok(),
        `Demo confirmation failed: ${confirmResponse.status()} ${await confirmResponse.text()}`,
      ).toBe(true);

      await expect(page).toHaveURL(new RegExp(`/orders/${escapeRegExp(order.publicId)}$`));
      await expect(page.getByLabel('Progreso')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Tus boletos están listos' })).toBeVisible();
      await expect(page.getByLabel('Evento')).toBeVisible();

      const statusResponse = await request.get(
        `${environment.apiUrl}/orders/${encodeURIComponent(order.publicId)}/status`,
      );
      expect(statusResponse.ok(), 'The completed order status endpoint must succeed').toBe(true);
      const status = await jsonObject(statusResponse);
      expect(status.status).toBe('COMPLETED');

      const qrResponse = await request.get(
        `${environment.apiUrl}/orders/${encodeURIComponent(order.publicId)}/qrcodes`,
      );
      expect(qrResponse.ok(), 'A completed order must expose QR tickets').toBe(true);
      const qr = await jsonObject(qrResponse);
      expect(objectArray(qr.tickets, 'qrcodes.tickets')).not.toHaveLength(0);
      completed = true;
      activeHoldIds = [];
    } finally {
      if (!completed && activeHoldIds.length > 0) {
        await releaseHolds(request, activeHoldIds);
      }
    }
  });
});
