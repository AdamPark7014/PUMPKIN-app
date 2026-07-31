import { expect, type APIRequestContext } from '@playwright/test';
import { bearer, login, type AuthSession } from '../../support/api';
import { environment, seedUsers, type SeedUser } from '../../support/environment';

const cache = new Map<string, AuthSession>();

/**
 * Login once per role for the worker process to avoid auth throttling (429).
 */
export async function loginCached(
  request: APIRequestContext,
  user: SeedUser,
): Promise<AuthSession> {
  const hit = cache.get(user.email);
  if (hit) return hit;

  let session: AuthSession | undefined;

  await expect
    .poll(
      async () => {
        const response = await request.post(`${environment.apiUrl}/auth/login`, {
          data: { email: user.email, password: environment.password },
        });
        if (response.status() === 429) {
          return 'throttled';
        }
        expect(
          [200, 201],
          `Login failed for ${user.email}: ${await response.text()}`,
        ).toContain(response.status());
        const body: unknown = await response.json();
        expect(body !== null && typeof body === 'object' && !Array.isArray(body)).toBe(
          true,
        );
        const obj = body as Record<string, unknown>;
        expect(typeof obj.accessToken).toBe('string');
        expect(obj.user !== null && typeof obj.user === 'object').toBe(true);
        if (typeof obj.accessToken !== 'string' || typeof obj.user !== 'object' || !obj.user) {
          throw new Error(`Malformed login response for ${user.email}`);
        }
        const csrfCookie = (await request.storageState()).cookies.find(
          (cookie) => cookie.name === 'boletera_csrf',
        );
        session = {
          accessToken: obj.accessToken,
          user: obj.user as Record<string, unknown>,
          csrfToken: csrfCookie?.value,
        };
        return 'ok';
      },
      { timeout: 30_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toBe('ok');

  if (!session) {
    const fallback = await login(request, user);
    cache.set(user.email, fallback);
    return fallback;
  }

  cache.set(user.email, session);
  return session;
}

export async function authHeadersCached(
  request: APIRequestContext,
  user: SeedUser,
): Promise<Record<string, string>> {
  return bearer(await loginCached(request, user));
}

export { seedUsers };
