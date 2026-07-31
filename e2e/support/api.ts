import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { environment, type SeedUser } from './environment';

export type JsonObject = Record<string, unknown>;

export type AuthSession = {
  accessToken: string;
  user: JsonObject;
  csrfToken?: string;
};

const sessionCache = new Map<string, AuthSession>();

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type JsonReadable = {
  json(): Promise<unknown>;
  url(): string;
};

export async function jsonObject(response: JsonReadable): Promise<JsonObject> {
  const value: unknown = await response.json();
  const url = response.url();
  expect(isJsonObject(value), `Expected JSON object from ${url}`).toBe(true);
  if (!isJsonObject(value)) {
    throw new Error(`Response from ${url} is not a JSON object`);
  }
  return value;
}

async function loginOnce(
  request: APIRequestContext,
  user: SeedUser,
): Promise<AuthSession | 'rate-limited' | 'failed'> {
  const response = await request.post(`${environment.apiUrl}/auth/login`, {
    data: { email: user.email, password: environment.password },
  });
  if (response.status() === 429) {
    return 'rate-limited';
  }
  if (![200, 201].includes(response.status())) {
    return 'failed';
  }
  const body = await jsonObject(response);
  if (typeof body.accessToken !== 'string' || !isJsonObject(body.user)) {
    return 'failed';
  }
  const csrfCookie = (await request.storageState()).cookies.find(
    (cookie) => cookie.name === 'boletera_csrf',
  );
  return {
    accessToken: body.accessToken,
    user: body.user,
    csrfToken: csrfCookie?.value,
  };
}

/**
 * Login with worker-local cache and condition wait on Throttler 429.
 * Auth is limited to 5 requests / 60s in production code — parallel e2e must not
 * stampede /auth/login.
 */
export async function login(
  request: APIRequestContext,
  user: SeedUser,
): Promise<AuthSession> {
  const cached = sessionCache.get(user.email);
  if (cached) {
    const probe = await request.get(`${environment.apiUrl}/auth/me`, {
      headers: { authorization: `Bearer ${cached.accessToken}` },
    });
    if (probe.ok()) {
      return cached;
    }
    sessionCache.delete(user.email);
  }

  let lastFailure = 'unknown';
  await expect
    .poll(
      async () => {
        const result = await loginOnce(request, user);
        if (result === 'rate-limited') {
          lastFailure = '429';
          return null;
        }
        if (result === 'failed') {
          lastFailure = 'non-2xx';
          return null;
        }
        sessionCache.set(user.email, result);
        return result;
      },
      {
        message: `login(${user.email}) waiting out auth throttle/failure (last=${lastFailure})`,
        timeout: 90_000,
        intervals: [250, 500, 1_000, 2_000, 3_000],
      },
    )
    .not.toBeNull();

  const session = sessionCache.get(user.email);
  if (!session) {
    throw new Error(`Login failed for ${user.email}`);
  }
  return session;
}

export function clearSessionCache(): void {
  sessionCache.clear();
}

export function bearer(session: AuthSession): Record<string, string> {
  return { authorization: `Bearer ${session.accessToken}` };
}

export async function expectProblem(
  response: APIResponse,
  expectedStatus: number | readonly number[],
): Promise<JsonObject> {
  const statuses = typeof expectedStatus === 'number' ? [expectedStatus] : [...expectedStatus];
  expect(statuses, await response.text()).toContain(response.status());
  const body = await jsonObject(response);
  expect(typeof body.statusCode).toBe('number');
  expect(typeof body.message === 'string' || Array.isArray(body.message)).toBe(true);
  return body;
}

export async function expectUnauthorizedOrForbidden(
  response: APIResponse,
): Promise<JsonObject> {
  return expectProblem(response, [401, 403]);
}
