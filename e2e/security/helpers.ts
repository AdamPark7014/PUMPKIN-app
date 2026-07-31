import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  bearer,
  expectProblem,
  isJsonObject,
  jsonObject,
  login,
  type AuthSession,
  type JsonObject,
} from '../support/api';
import { environment, seedUsers, type SeedUser } from '../support/environment';

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'boletera_csrf';
export const REFRESH_COOKIE = 'boletera_refresh';

/** Authz failures must be 401/403 — never 404 as a soft substitute. */
export const AUTH_DENY_STATUSES = [401, 403] as const;

export type TenantIds = {
  ocesa: string;
  cie: string;
};

/** Absolute API URL. Leading-slash paths would strip `/api/v1` from baseURL. */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${environment.apiUrl}${normalized}`;
}

function hydrateJwtSecretFromEnvFiles(): void {
  if (process.env.JWT_SECRET) return;
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), 'apps/api/.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      if (key !== 'JWT_SECRET' || process.env.JWT_SECRET) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env.JWT_SECRET = value;
    }
  }
}

export function requireJwtSecret(): string {
  hydrateJwtSecretFromEnvFiles();
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be available for expired-token security tests');
  }
  return secret;
}

export function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function expiredAccessToken(claims: {
  sub: string;
  email: string;
  role: string;
  organizationId?: string;
  sid?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  return signHs256Jwt(
    {
      ...claims,
      iat: now - 3_600,
      exp: now - 60,
    },
    requireJwtSecret(),
  );
}

export function stringField(obj: JsonObject, key: string): string {
  const value = obj[key];
  expect(typeof value, `Expected string field "${key}"`).toBe('string');
  if (typeof value !== 'string') {
    throw new Error(`Expected string field "${key}"`);
  }
  return value;
}

export function organizationIdOf(session: AuthSession): string {
  return stringField(session.user, 'organizationId');
}

export async function cookieValue(
  request: APIRequestContext,
  name: string,
): Promise<string | undefined> {
  const cookie = (await request.storageState()).cookies.find((c) => c.name === name);
  return cookie?.value;
}

export function csrfHeaders(csrfToken: string): Record<string, string> {
  return { [CSRF_HEADER]: csrfToken };
}

export function authHeaders(session: AuthSession): Record<string, string> {
  return bearer(session);
}

/**
 * Cookie-aware login with 429 tolerance (Nest throttler + anti-abuse).
 * Uses absolute API URLs and expect.poll — no fixed sleeps.
 */
export async function loginAs(
  request: APIRequestContext,
  user: SeedUser,
): Promise<AuthSession> {
  let session: AuthSession | undefined;
  await expect
    .poll(
      async () => {
        let response: APIResponse;
        try {
          response = await request.post(apiUrl('/auth/login'), {
            data: { email: user.email, password: environment.password },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(message)) return false;
          throw error;
        }
        if (response.status() === 429) return false;
        expect(
          [200, 201],
          `Login failed for ${user.email}: ${await response.text()}`,
        ).toContain(response.status());
        const body = await jsonObject(response);
        expect(typeof body.accessToken).toBe('string');
        expect(isJsonObject(body.user)).toBe(true);
        if (typeof body.accessToken !== 'string' || !isJsonObject(body.user)) {
          throw new Error(`Malformed login response for ${user.email}`);
        }
        const csrfToken = await cookieValue(request, CSRF_COOKIE);
        session = {
          accessToken: body.accessToken,
          user: body.user,
          ...(csrfToken !== undefined ? { csrfToken } : {}),
        };
        return true;
      },
      {
        message: `loginAs(${user.email}) waiting out auth rate limit`,
        intervals: [250, 500, 1_000, 2_000],
        timeout: 90_000,
      },
    )
    .toBe(true);
  if (!session) throw new Error(`loginAs(${user.email}) produced no session`);
  return session;
}

/**
 * Assert denial with the correct authz status and no successful payload leak.
 * Rejects 404 unless the caller explicitly opts into that contract.
 */
export async function expectAuthzDenied(
  response: APIResponse,
  options?: {
    allowedStatuses?: readonly number[];
    forbidBodyKeys?: readonly string[];
    forbidSubstrings?: readonly string[];
  },
): Promise<JsonObject> {
  const allowed = options?.allowedStatuses ?? AUTH_DENY_STATUSES;
  const status = response.status();
  const raw = await response.text();
  expect(
    allowed,
    `Expected authz deny ${allowed.join('|')} from ${response.url()} but got ${status}: ${raw}`,
  ).toContain(status);

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Authz deny response from ${response.url()} was not JSON: ${raw}`);
  }
  expect(isJsonObject(body), `Expected problem JSON from ${response.url()}`).toBe(true);
  if (!isJsonObject(body)) {
    throw new Error(`Expected problem JSON from ${response.url()}`);
  }
  expect(typeof body.statusCode).toBe('number');
  expect(body.statusCode).toBe(status);
  expect(typeof body.message === 'string' || Array.isArray(body.message)).toBe(true);

  for (const key of options?.forbidBodyKeys ?? []) {
    expect(body, `Denied response must not leak field "${key}"`).not.toHaveProperty(key);
  }
  const haystack = raw.toLowerCase();
  for (const needle of options?.forbidSubstrings ?? []) {
    expect(
      haystack.includes(needle.toLowerCase()),
      `Denied response must not contain "${needle}"`,
    ).toBe(false);
  }
  return body;
}

export async function expectOkJson(
  response: APIResponse,
  expectedStatus: number | readonly number[] = [200, 201],
): Promise<JsonObject> {
  const statuses = typeof expectedStatus === 'number' ? [expectedStatus] : [...expectedStatus];
  expect(statuses, await response.text()).toContain(response.status());
  return jsonObject(response);
}

let cachedTenants: TenantIds | undefined;

export async function fetchTenantIds(): Promise<TenantIds> {
  if (cachedTenants) return cachedTenants;
  const ocesaCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
  const cieCtx = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
  try {
    const ocesa = await loginAs(ocesaCtx, seedUsers.ocesaAdmin);
    const cie = await loginAs(cieCtx, seedUsers.cieAdmin);
    const ocesaId = organizationIdOf(ocesa);
    const cieId = organizationIdOf(cie);
    expect(ocesaId).not.toBe(cieId);
    cachedTenants = { ocesa: ocesaId, cie: cieId };
    return cachedTenants;
  } finally {
    await ocesaCtx.dispose();
    await cieCtx.dispose();
  }
}

export {
  expectProblem,
  environment,
  seedUsers,
  login,
  bearer,
  jsonObject,
  isJsonObject,
};
export type { AuthSession, JsonObject, SeedUser };
