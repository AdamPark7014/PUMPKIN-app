import { expect, request as playwrightRequest, test } from '@playwright/test';
import {
  AUTH_DENY_STATUSES,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  apiUrl,
  authHeaders,
  cookieValue,
  csrfHeaders,
  environment,
  expectAuthzDenied,
  expectOkJson,
  expectProblem,
  expiredAccessToken,
  loginAs,
  organizationIdOf,
  seedUsers,
  stringField,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('auth session lifecycle', () => {
  test('login returns access token, user, and CSRF cookie', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const session = await loginAs(ctx, seedUsers.ocesaAdmin);
      expect(session.accessToken.length).toBeGreaterThan(20);
      expect(stringField(session.user, 'email')).toBe(seedUsers.ocesaAdmin.email);
      expect(stringField(session.user, 'role')).toBe(seedUsers.ocesaAdmin.role);
      expect(organizationIdOf(session).length).toBeGreaterThan(0);

      expect(await cookieValue(ctx, CSRF_COOKIE), 'boletera_csrf after login').toBeTruthy();
      expect(await cookieValue(ctx, REFRESH_COOKIE), 'boletera_refresh after login').toBeTruthy();
    } finally {
      await ctx.dispose();
    }
  });

  test('login with wrong password is 401 without session cookies', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      // Non-seed identity avoids locking out real demo accounts via login-protection.
      const response = await ctx.post(apiUrl('/auth/login'), {
        data: {
          email: 'security-e2e-unknown@example.invalid',
          password: 'WrongPassword!99',
        },
      });
      await expectProblem(response, 401);
      expect(await cookieValue(ctx, REFRESH_COOKIE)).toBeUndefined();
      expect(await cookieValue(ctx, CSRF_COOKIE)).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });

  test('GET /auth/me with bearer returns the authenticated user', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const session = await loginAs(ctx, seedUsers.cieAdmin);
      const me = await ctx.get(apiUrl('/auth/me'), { headers: authHeaders(session) });
      const body = await expectOkJson(me, 200);
      expect(stringField(body, 'email')).toBe(seedUsers.cieAdmin.email);
      expect(stringField(body, 'role')).toBe(seedUsers.cieAdmin.role);
      expect(stringField(body, 'organizationId')).toBe(organizationIdOf(session));
    } finally {
      await ctx.dispose();
    }
  });

  test('refresh requires CSRF and rotates access token', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const session = await loginAs(ctx, seedUsers.ocesaAdmin);
      const csrf = await cookieValue(ctx, CSRF_COOKIE);
      expect(csrf).toBeTruthy();
      if (!csrf) throw new Error('missing csrf');

      await expectAuthzDenied(await ctx.post(apiUrl('/auth/refresh')), {
        allowedStatuses: [403],
      });

      await expectAuthzDenied(
        await ctx.post(apiUrl('/auth/refresh'), {
          headers: csrfHeaders('definitely-not-the-csrf-token'),
        }),
        { allowedStatuses: [403] },
      );

      const body = await expectOkJson(
        await ctx.post(apiUrl('/auth/refresh'), { headers: csrfHeaders(csrf) }),
        201,
      );
      expect(typeof body.accessToken).toBe('string');
      if (typeof body.accessToken !== 'string') {
        throw new Error('refresh missing accessToken');
      }
      expect(body.accessToken).not.toBe(session.accessToken);

      const nextCsrf = await cookieValue(ctx, CSRF_COOKIE);
      expect(nextCsrf).toBeTruthy();
      expect(nextCsrf).not.toBe(csrf);

      const meBody = await expectOkJson(
        await ctx.get(apiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${body.accessToken}` },
        }),
        200,
      );
      expect(stringField(meBody, 'email')).toBe(seedUsers.ocesaAdmin.email);
    } finally {
      await ctx.dispose();
    }
  });

  test('logout with CSRF clears cookies and revokes session-backed access', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const session = await loginAs(ctx, seedUsers.cieAdmin);
      const csrf = await cookieValue(ctx, CSRF_COOKIE);
      expect(csrf).toBeTruthy();
      if (!csrf) throw new Error('missing csrf');

      await expectAuthzDenied(await ctx.post(apiUrl('/auth/logout')), {
        allowedStatuses: [403],
      });

      const logout = await ctx.post(apiUrl('/auth/logout'), {
        headers: {
          ...authHeaders(session),
          ...csrfHeaders(csrf),
        },
      });
      expect([200, 201]).toContain(logout.status());

      expect(await cookieValue(ctx, REFRESH_COOKIE)).toBeUndefined();
      expect(await cookieValue(ctx, CSRF_COOKIE)).toBeUndefined();

      await expectAuthzDenied(
        await ctx.post(apiUrl('/auth/refresh'), { headers: csrfHeaders(csrf) }),
        { allowedStatuses: AUTH_DENY_STATUSES },
      );

      await expectAuthzDenied(
        await ctx.get(apiUrl('/auth/me'), { headers: authHeaders(session) }),
        { allowedStatuses: [401] },
      );
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('token rejection', () => {
  test.describe.configure({ mode: 'serial' });

  test('missing token on /auth/me is 401', async ({ request }) => {
    await expectAuthzDenied(await request.get(apiUrl('/auth/me')), {
      allowedStatuses: [401],
    });
  });

  test('malformed bearer token is 401', async ({ request }) => {
    await expectAuthzDenied(
      await request.get(apiUrl('/auth/me'), {
        headers: { authorization: 'Bearer not.a.jwt' },
      }),
      { allowedStatuses: [401] },
    );
  });

  test('expired bearer token is 401', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const session = await loginAs(ctx, seedUsers.ocesaAdmin);
      const token = expiredAccessToken({
        sub: stringField(session.user, 'id'),
        email: seedUsers.ocesaAdmin.email,
        role: seedUsers.ocesaAdmin.role,
        organizationId: organizationIdOf(session),
      });
      await expectAuthzDenied(
        await ctx.get(apiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
        }),
        { allowedStatuses: [401] },
      );
    } finally {
      await ctx.dispose();
    }
  });

  test('insufficient role cannot read metrics, organization, or admin', async () => {
    const scannerCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    const adminCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      const adminSession = await loginAs(adminCtx, seedUsers.ocesaAdmin);
      const scanner = await loginAs(scannerCtx, seedUsers.scanner);
      const orgId = organizationIdOf(adminSession);

      await expectAuthzDenied(
        await scannerCtx.get(apiUrl(`/metrics/executive?organizationId=${orgId}`), {
          headers: authHeaders(scanner),
        }),
        {
          allowedStatuses: [403],
          forbidBodyKeys: ['grossRevenue', 'ticketsSold', 'events'],
        },
      );

      await expectAuthzDenied(
        await scannerCtx.get(apiUrl(`/organization/${orgId}`), {
          headers: authHeaders(scanner),
        }),
        {
          allowedStatuses: [403],
          forbidBodyKeys: ['commissionRate', 'tenantTheme'],
          forbidSubstrings: ['ocesa-demo.mx', 'cie-demo.mx'],
        },
      );

      await expectAuthzDenied(
        await scannerCtx.get(apiUrl('/admin/dashboard'), {
          headers: authHeaders(scanner),
        }),
        { allowedStatuses: [403] },
      );
    } finally {
      await scannerCtx.dispose();
      await adminCtx.dispose();
    }
  });
});

test.describe('unauthenticated protected surfaces', () => {
  for (const path of [
    '/metrics/executive',
    '/admin/dashboard',
    '/admin/orders',
    '/reports/channels/placeholder-org',
  ] as const) {
    test(`GET ${path} without token is 401`, async ({ request }) => {
      await expectAuthzDenied(await request.get(apiUrl(path)), {
        allowedStatuses: [401],
        forbidBodyKeys: ['orders', 'events', 'channels', 'grossRevenue'],
      });
    });
  }
});
