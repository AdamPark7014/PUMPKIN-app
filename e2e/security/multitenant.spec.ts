import { expect, request as playwrightRequest, test } from '@playwright/test';
import {
  apiUrl,
  authHeaders,
  environment,
  expectAuthzDenied,
  expectOkJson,
  fetchTenantIds,
  isJsonObject,
  loginAs,
  organizationIdOf,
  seedUsers,
  stringField,
  type AuthSession,
  type JsonObject,
} from './helpers';

const FOREIGN_ORG_LEAK_KEYS = [
  'email',
  'users',
  'team',
  'orders',
  'events',
  'grossRevenue',
  'ticketsSold',
  'channels',
  'heatmap',
  'settlement',
] as const;

test.describe.configure({ mode: 'serial' });

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (isJsonObject(value)) {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
  return out;
}

function assertNoForeignTenantLeak(
  body: JsonObject,
  foreignOrgId: string,
  foreignMarkers: readonly string[],
): void {
  const serialized = JSON.stringify(body);
  expect(
    serialized.includes(foreignOrgId),
    `Response must not contain foreign organizationId ${foreignOrgId}`,
  ).toBe(false);
  const haystack = serialized.toLowerCase();
  for (const marker of foreignMarkers) {
    expect(
      haystack.includes(marker.toLowerCase()),
      `Response must not contain foreign marker "${marker}"`,
    ).toBe(false);
  }
}

async function ownOrgSnapshot(
  request: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  session: AuthSession,
  orgId: string,
): Promise<JsonObject> {
  return expectOkJson(
    await request.get(apiUrl(`/organization/${orgId}`), {
      headers: authHeaders(session),
    }),
    200,
  );
}

function orgUserCount(org: JsonObject): number {
  const count = org._count;
  expect(isJsonObject(count), 'organization._count missing').toBe(true);
  if (!isJsonObject(count)) throw new Error('organization._count missing');
  expect(typeof count.users).toBe('number');
  if (typeof count.users !== 'number') throw new Error('organization._count.users missing');
  return count.users;
}

test.describe('multitenant isolation OCESA ↔ CIE', () => {
  test('organization: cross-tenant GET is 403 without payload leak', async () => {
    const tenants = await fetchTenantIds();
    const ocesaCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    const cieCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const ocesa = await loginAs(ocesaCtx, seedUsers.ocesaAdmin);
      const cie = await loginAs(cieCtx, seedUsers.cieAdmin);

      const ocesaOwn = await ownOrgSnapshot(ocesaCtx, ocesa, tenants.ocesa);
      const cieOwn = await ownOrgSnapshot(cieCtx, cie, tenants.cie);
      expect(stringField(ocesaOwn, 'id')).toBe(tenants.ocesa);
      expect(stringField(cieOwn, 'id')).toBe(tenants.cie);
      expect(stringField(ocesaOwn, 'id')).not.toBe(stringField(cieOwn, 'id'));

      const ocesaLeakMarkers = collectStrings(ocesaOwn).filter((value) =>
        /ocesa|@ocesa-demo/i.test(value),
      );
      const cieLeakMarkers = collectStrings(cieOwn).filter((value) =>
        /cie|@cie-demo/i.test(value),
      );

      await expectAuthzDenied(
        await ocesaCtx.get(apiUrl(`/organization/${tenants.cie}`), {
          headers: authHeaders(ocesa),
        }),
        {
          allowedStatuses: [403],
          forbidBodyKeys: [...FOREIGN_ORG_LEAK_KEYS],
          forbidSubstrings: cieLeakMarkers.slice(0, 8),
        },
      );

      await expectAuthzDenied(
        await cieCtx.get(apiUrl(`/organization/${tenants.ocesa}`), {
          headers: authHeaders(cie),
        }),
        {
          allowedStatuses: [403],
          forbidBodyKeys: [...FOREIGN_ORG_LEAK_KEYS],
          forbidSubstrings: ocesaLeakMarkers.slice(0, 8),
        },
      );

      await expectAuthzDenied(
        await ocesaCtx.get(apiUrl(`/organization/${tenants.cie}/team`), {
          headers: authHeaders(ocesa),
        }),
        { allowedStatuses: [403] },
      );

      await expectAuthzDenied(
        await ocesaCtx.get(
          apiUrl(`/organization/capabilities?organizationId=${tenants.cie}`),
          { headers: authHeaders(ocesa) },
        ),
        { allowedStatuses: [403] },
      );
    } finally {
      await ocesaCtx.dispose();
      await cieCtx.dispose();
    }
  });

  test('metrics: foreign organizationId query is 403', async () => {
    const tenants = await fetchTenantIds();
    const ocesaCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    const cieCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const ocesa = await loginAs(ocesaCtx, seedUsers.ocesaAdmin);
      const cie = await loginAs(cieCtx, seedUsers.cieAdmin);

      const ocesaOwn = await expectOkJson(
        await ocesaCtx.get(apiUrl(`/metrics/executive?organizationId=${tenants.ocesa}`), {
          headers: authHeaders(ocesa),
        }),
        200,
      );
      assertNoForeignTenantLeak(ocesaOwn, tenants.cie, ['cie-demo', 'CIE Espectáculos']);

      await expectAuthzDenied(
        await ocesaCtx.get(apiUrl(`/metrics/executive?organizationId=${tenants.cie}`), {
          headers: authHeaders(ocesa),
        }),
        {
          allowedStatuses: [403],
          forbidBodyKeys: ['grossRevenue', 'ticketsSold', 'byChannel', 'projection'],
        },
      );

      await expectAuthzDenied(
        await cieCtx.get(apiUrl(`/metrics/alerts?organizationId=${tenants.ocesa}`), {
          headers: authHeaders(cie),
        }),
        { allowedStatuses: [403] },
      );

      await expectAuthzDenied(
        await ocesaCtx.get(apiUrl(`/metrics/orders?organizationId=${tenants.cie}`), {
          headers: authHeaders(ocesa),
        }),
        { allowedStatuses: [403] },
      );
    } finally {
      await ocesaCtx.dispose();
      await cieCtx.dispose();
    }
  });

  test('reporting: foreign organizationId path is 403', async () => {
    const tenants = await fetchTenantIds();
    const ocesaCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    const cieCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const ocesa = await loginAs(ocesaCtx, seedUsers.ocesaAdmin);
      const cie = await loginAs(cieCtx, seedUsers.cieAdmin);

      const ocesaChannels = await expectOkJson(
        await ocesaCtx.get(apiUrl(`/reports/channels/${tenants.ocesa}`), {
          headers: authHeaders(ocesa),
        }),
        200,
      );
      assertNoForeignTenantLeak(ocesaChannels, tenants.cie, ['cie-demo']);

      for (const path of [
        `/reports/channels/${tenants.cie}`,
        `/reports/customers/${tenants.cie}`,
        `/reports/dashboard/realtime/${tenants.cie}`,
        `/reports/settlement/${tenants.cie}/MONTHLY`,
        `/reports/forecast/${tenants.cie}/7`,
        `/reports/export/sales/${tenants.cie}`,
      ] as const) {
        await expectAuthzDenied(
          await ocesaCtx.get(apiUrl(path), { headers: authHeaders(ocesa) }),
          {
            allowedStatuses: [403],
            forbidBodyKeys: ['channels', 'customers', 'csv', 'forecast', 'settlement'],
          },
        );
      }

      await expectAuthzDenied(
        await cieCtx.get(apiUrl(`/reports/channels/${tenants.ocesa}`), {
          headers: authHeaders(cie),
        }),
        { allowedStatuses: [403] },
      );
    } finally {
      await ocesaCtx.dispose();
      await cieCtx.dispose();
    }
  });

  test('admin: responses stay tenant-scoped; foreign order id is not 200', async () => {
    const tenants = await fetchTenantIds();
    const ocesaCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    const cieCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const ocesa = await loginAs(ocesaCtx, seedUsers.ocesaAdmin);
      const cie = await loginAs(cieCtx, seedUsers.cieAdmin);

      const ocesaDash = await expectOkJson(
        await ocesaCtx.get(apiUrl('/admin/dashboard'), { headers: authHeaders(ocesa) }),
        200,
      );
      assertNoForeignTenantLeak(ocesaDash, tenants.cie, [
        seedUsers.cieAdmin.email,
        'cie-demo.mx',
      ]);

      const cieDash = await expectOkJson(
        await cieCtx.get(apiUrl('/admin/dashboard'), { headers: authHeaders(cie) }),
        200,
      );
      const ocesaOrg = await ownOrgSnapshot(ocesaCtx, ocesa, tenants.ocesa);
      const cieOrg = await ownOrgSnapshot(cieCtx, cie, tenants.cie);
      const ocesaOrgUsers = orgUserCount(ocesaOrg);
      const cieOrgUsers = orgUserCount(cieOrg);
      expect(
        ocesaDash.totalUsers,
        `admin.dashboard totalUsers must be tenant-scoped (org has ${ocesaOrgUsers}; got ${String(ocesaDash.totalUsers)}). File: apps/api/src/modules/admin/admin.service.ts dashboard() uses prisma.user.count() without organizationId.`,
      ).toBe(ocesaOrgUsers);
      expect(
        cieDash.totalUsers,
        `admin.dashboard totalUsers must be tenant-scoped (org has ${cieOrgUsers}; got ${String(cieDash.totalUsers)})`,
      ).toBe(cieOrgUsers);

      const cieOrdersResponse = await cieCtx.get(apiUrl('/admin/orders'), {
        headers: authHeaders(cie),
      });
      expect(cieOrdersResponse.status()).toBe(200);
      const cieOrdersBody: unknown = await cieOrdersResponse.json();

      const cieOrderList: JsonObject[] = Array.isArray(cieOrdersBody)
        ? cieOrdersBody.filter(isJsonObject)
        : isJsonObject(cieOrdersBody) && Array.isArray(cieOrdersBody.orders)
          ? cieOrdersBody.orders.filter(isJsonObject)
          : [];

      const foreignOrder = cieOrderList[0];
      test.skip(!foreignOrder, 'CIE seed has no orders to probe IDOR');
      if (!foreignOrder) return;

      const foreignOrderId = stringField(foreignOrder, 'id');
      const cross = await ocesaCtx.get(apiUrl(`/admin/orders/${foreignOrderId}`), {
        headers: authHeaders(ocesa),
      });
      await expectAuthzDenied(cross, {
        allowedStatuses: [401, 403],
        forbidBodyKeys: ['items', 'payment', 'refunds', 'customerEmail', 'buyerEmail'],
        forbidSubstrings: [tenants.cie, 'cie-demo'],
      });
    } finally {
      await ocesaCtx.dispose();
      await cieCtx.dispose();
    }
  });

  test('cashier cannot escalate into admin reporting surfaces', async () => {
    const tenants = await fetchTenantIds();
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const cashier = await loginAs(ctx, seedUsers.cashier);
      expect(organizationIdOf(cashier)).toBeTruthy();

      await expectAuthzDenied(
        await ctx.get(apiUrl(`/reports/channels/${tenants.ocesa}`), {
          headers: authHeaders(cashier),
        }),
        { allowedStatuses: [403] },
      );
      await expectAuthzDenied(
        await ctx.get(apiUrl('/admin/reports/sales'), { headers: authHeaders(cashier) }),
        { allowedStatuses: [403] },
      );
    } finally {
      await ctx.dispose();
    }
  });
});
