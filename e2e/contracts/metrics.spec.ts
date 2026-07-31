import { expect, test } from '../support/fixtures';
import { expectProblem, jsonObject } from '../support/api';
import {
  assertAccessMetrics,
  assertAlertsResponse,
  assertCampaignMetrics,
  assertExecutiveMetrics,
  assertFraudMetrics,
  assertInventoryMetrics,
  assertOrdersPaymentsMetrics,
  assertResaleMetrics,
  assertSalesPaceMetrics,
  assertSettlementsMetrics,
  assertTimeSeriesResponse,
  assertWaitlistMetrics,
} from './_lib/guards';
import {
  authHeaders,
  expectForbidden,
  expectUnauthorized,
  metricsUrl,
  requireApiHealthy,
} from './_lib/helpers';
import { METRICS_PATHS, metricsRange, seedOrgs } from './_lib/seed';
import { seedUsers } from '../support/environment';

test.describe('API contracts — /metrics/*', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('rejects anonymous access on every metrics endpoint with 401', async ({ request }) => {
    for (const path of METRICS_PATHS) {
      const url =
        path === 'timeseries'
          ? metricsUrl(path, { metric: 'revenue', granularity: 'day' })
          : metricsUrl(path);
      const response = await request.get(url);
      await expectUnauthorized(response, [401]);
    }
  });

  test('rejects CUSTOMER role on every metrics endpoint with 403', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.customer);
    for (const path of METRICS_PATHS) {
      const url =
        path === 'timeseries'
          ? metricsUrl(path, {
              organizationId: seedOrgs.platform.id,
              metric: 'revenue',
              granularity: 'day',
            })
          : metricsUrl(path, { organizationId: seedOrgs.platform.id });
      const response = await request.get(url, { headers });
      await expectForbidden(response, [403]);
    }
  });

  test('rejects TAQUILLA role on metrics/executive with 403', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.cashier);
    const response = await request.get(
      metricsUrl('executive', { organizationId: seedOrgs.platform.id }),
      { headers },
    );
    await expectForbidden(response, [403]);
  });

  test('rejects SCANNER role on metrics/orders with 403', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.scanner);
    const response = await request.get(
      metricsUrl('orders', { organizationId: seedOrgs.platform.id }),
      { headers },
    );
    await expectForbidden(response, [403]);
  });

  test('rejects cross-tenant organizationId for OCESA ADMIN against CIE', async ({
    request,
  }) => {
    const headers = await authHeaders(request, seedUsers.ocesaAdmin);
    const response = await request.get(
      metricsUrl('executive', { organizationId: seedOrgs.cie.id }),
      { headers },
    );
    await expectForbidden(response, [403]);
  });

  test('rejects invalid from date with 400 validation problem', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.superAdmin);
    const response = await request.get(
      metricsUrl('executive', {
        organizationId: seedOrgs.platform.id,
        from: 'not-a-date',
        to: metricsRange.to,
      }),
      { headers },
    );
    const body = await expectProblem(response, 400);
    expect(body.message).toBeTruthy();
  });

  test('rejects inverted range from >= to with 400', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.superAdmin);
    const response = await request.get(
      metricsUrl('executive', {
        organizationId: seedOrgs.platform.id,
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
      { headers },
    );
    // Production contract: MetricsService.resolveRange must reject inverted windows.
    // If this returns 200, that is a real API bug (range validation bypassed).
    expect(
      response.status(),
      `inverted range must be 400, got ${response.status()}: ${await response.text()}`,
    ).toBe(400);
    await expectProblem(response, 400);
  });

  test('rejects invalid timeseries granularity with 400', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.superAdmin);
    const response = await request.get(
      metricsUrl('timeseries', {
        organizationId: seedOrgs.platform.id,
        metric: 'revenue',
        granularity: 'fortnight',
      }),
      { headers },
    );
    expect(
      response.status(),
      `invalid granularity must be 400, got ${response.status()}: ${await response.text()}`,
    ).toBe(400);
    await expectProblem(response, 400);
  });

  test('SUPER_ADMIN receives contract-shaped payloads for all metrics endpoints', async ({
    request,
  }) => {
    const headers = await authHeaders(request, seedUsers.superAdmin);
    const org = seedOrgs.platform.id;

    const executive = await request.get(metricsUrl('executive', { organizationId: org }), {
      headers,
    });
    expect(executive.status(), await executive.text()).toBe(200);
    assertExecutiveMetrics(await jsonObject(executive));

    const salesPace = await request.get(
      metricsUrl('events/sales-pace', { organizationId: org }),
      { headers },
    );
    expect(salesPace.status(), await salesPace.text()).toBe(200);
    assertSalesPaceMetrics(await jsonObject(salesPace));

    const inventory = await request.get(metricsUrl('inventory', { organizationId: org }), {
      headers,
    });
    expect(inventory.status(), await inventory.text()).toBe(200);
    assertInventoryMetrics(await jsonObject(inventory));

    const orders = await request.get(metricsUrl('orders', { organizationId: org }), {
      headers,
    });
    expect(orders.status(), await orders.text()).toBe(200);
    assertOrdersPaymentsMetrics(await jsonObject(orders));

    const access = await request.get(metricsUrl('access', { organizationId: org }), {
      headers,
    });
    expect(access.status(), await access.text()).toBe(200);
    assertAccessMetrics(await jsonObject(access));

    const resale = await request.get(metricsUrl('resale', { organizationId: org }), {
      headers,
    });
    expect(resale.status(), await resale.text()).toBe(200);
    assertResaleMetrics(await jsonObject(resale));

    const waitlist = await request.get(metricsUrl('waitlist', { organizationId: org }), {
      headers,
    });
    expect(waitlist.status(), await waitlist.text()).toBe(200);
    assertWaitlistMetrics(await jsonObject(waitlist));

    const campaigns = await request.get(metricsUrl('campaigns', { organizationId: org }), {
      headers,
    });
    expect(campaigns.status(), await campaigns.text()).toBe(200);
    assertCampaignMetrics(await jsonObject(campaigns));

    const fraud = await request.get(metricsUrl('fraud', { organizationId: org }), {
      headers,
    });
    expect(fraud.status(), await fraud.text()).toBe(200);
    assertFraudMetrics(await jsonObject(fraud));

    const settlements = await request.get(
      metricsUrl('settlements', { organizationId: org }),
      { headers },
    );
    expect(settlements.status(), await settlements.text()).toBe(200);
    assertSettlementsMetrics(await jsonObject(settlements));

    const timeseries = await request.get(
      metricsUrl('timeseries', {
        organizationId: org,
        metric: 'revenue',
        granularity: 'day',
      }),
      { headers },
    );
    expect(timeseries.status(), await timeseries.text()).toBe(200);
    assertTimeSeriesResponse(await jsonObject(timeseries));

    for (const metric of ['orders', 'tickets', 'refunds', 'checkins'] as const) {
      const series = await request.get(
        metricsUrl('timeseries', {
          organizationId: org,
          metric,
          granularity: 'week',
        }),
        { headers },
      );
      expect(series.status(), `${metric}: ${await series.text()}`).toBe(200);
      const body = await jsonObject(series);
      assertTimeSeriesResponse(body);
      expect(body.metric).toBe(metric);
    }

    const alerts = await request.get(metricsUrl('alerts', { organizationId: org }), {
      headers,
    });
    expect(alerts.status(), await alerts.text()).toBe(200);
    assertAlertsResponse(await jsonObject(alerts));
  });

  test('OCESA ADMIN can read own-org metrics without cross-tenant leak', async ({
    request,
  }) => {
    const headers = await authHeaders(request, seedUsers.ocesaAdmin);
    const response = await request.get(
      metricsUrl('executive', { organizationId: seedOrgs.ocesa.id }),
      { headers },
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = await jsonObject(response);
    assertExecutiveMetrics(body);
    expect(body.organizationId).toBe(seedOrgs.ocesa.id);
  });
});
