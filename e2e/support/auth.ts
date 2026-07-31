import { expect, type APIRequestContext } from '@playwright/test';
import { environment, type SeedUser } from './environment';
import { isJsonObject, jsonObject, type AuthSession, type JsonObject } from './api';

const CSRF_COOKIE = 'boletera_csrf';
const REFRESH_COOKIE = 'boletera_refresh';
const ACCESS_COOKIE = 'boletera_access';

export async function loginWithCookies(
  request: APIRequestContext,
  user: SeedUser,
): Promise<AuthSession> {
  const response = await request.post(`${environment.apiUrl}/auth/login`, {
    data: { email: user.email, password: environment.password },
  });
  expect([200, 201], await response.text()).toContain(response.status());
  const body = await jsonObject(response);
  expect(typeof body.accessToken).toBe('string');
  expect(isJsonObject(body.user)).toBe(true);
  if (typeof body.accessToken !== 'string' || !isJsonObject(body.user)) {
    throw new Error(`Malformed login response for ${user.email}`);
  }
  const cookies = (await request.storageState()).cookies;
  const csrfToken = cookies.find((cookie) => cookie.name === CSRF_COOKIE)?.value;
  expect(csrfToken, 'Login must set boletera_csrf cookie').toBeTruthy();
  expect(
    cookies.some((cookie) => cookie.name === REFRESH_COOKIE),
    'Login must set boletera_refresh cookie',
  ).toBe(true);
  expect(
    cookies.some((cookie) => cookie.name === ACCESS_COOKIE),
    'Login must set boletera_access cookie',
  ).toBe(true);
  return {
    accessToken: body.accessToken,
    user: body.user,
    csrfToken,
  };
}

export async function refreshSession(
  request: APIRequestContext,
  csrfToken: string,
): Promise<AuthSession> {
  const response = await request.post(`${environment.apiUrl}/auth/refresh`, {
    headers: { 'x-csrf-token': csrfToken },
  });
  expect([200, 201], await response.text()).toContain(response.status());
  const body = await jsonObject(response);
  expect(typeof body.accessToken).toBe('string');
  expect(isJsonObject(body.user)).toBe(true);
  if (typeof body.accessToken !== 'string' || !isJsonObject(body.user)) {
    throw new Error('Malformed refresh response');
  }
  const cookies = (await request.storageState()).cookies;
  return {
    accessToken: body.accessToken,
    user: body.user,
    csrfToken: cookies.find((cookie) => cookie.name === CSRF_COOKIE)?.value ?? csrfToken,
  };
}

export async function logoutSession(
  request: APIRequestContext,
  csrfToken?: string,
): Promise<JsonObject> {
  const response = await request.post(`${environment.apiUrl}/auth/logout`, {
    headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return jsonObject(response);
}

export async function me(
  request: APIRequestContext,
  accessToken: string,
): Promise<JsonObject> {
  const response = await request.get(`${environment.apiUrl}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return jsonObject(response);
}

export function organizationIdOf(user: JsonObject): string {
  const value = user.organizationId;
  expect(typeof value, 'Authenticated user must include organizationId').toBe('string');
  if (typeof value !== 'string') {
    throw new Error('organizationId missing on user');
  }
  return value;
}
