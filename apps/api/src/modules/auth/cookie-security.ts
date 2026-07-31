import { ForbiddenException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

export const ACCESS_COOKIE = 'boletera_access';
export const REFRESH_COOKIE = 'boletera_refresh';
export const CSRF_COOKIE = 'boletera_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const OAUTH_STATE_COOKIE = 'boletera_oauth_state';

const production = () => process.env.NODE_ENV === 'production';

export function authCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: production(),
    sameSite: 'strict',
    path: '/',
    maxAge,
  };
}

export function csrfCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: false,
    secure: production(),
    sameSite: 'strict',
    path: '/',
    maxAge,
  };
}

export function issueAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
  csrfToken: string,
): void {
  response.cookie(ACCESS_COOKIE, accessToken, authCookieOptions(15 * 60 * 1000));
  response.cookie(REFRESH_COOKIE, refreshToken, authCookieOptions(30 * 24 * 60 * 60 * 1000));
  response.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions(30 * 24 * 60 * 60 * 1000));
}

export function clearAuthCookies(response: Response): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    response.clearCookie(name, authCookieOptions(0));
  }
  response.clearCookie(CSRF_COOKIE, csrfCookieOptions(0));
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function issueOauthState(response: Response, state: string): void {
  response.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: production(),
    sameSite: 'lax',
    path: '/api/v1/auth/oauth',
    maxAge: 10 * 60 * 1000,
  });
}

export function assertOauthState(request: Request, state: string | undefined): void {
  const expected = request.cookies?.[OAUTH_STATE_COOKIE];
  if (!expected || !state || !safeEqual(expected, state)) {
    throw new ForbiddenException('Invalid OAuth state');
  }
}

export function assertCsrf(request: Request): void {
  const cookie = request.cookies?.[CSRF_COOKIE];
  const headerValue = request.headers[CSRF_HEADER];
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw new ForbiddenException('Invalid CSRF token');
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
