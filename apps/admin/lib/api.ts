import { http, HttpError } from './http';
import { getTokenStorage } from './session';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://127.0.0.1:4000/api/v1';

export type AuthUser = {
  id: string;
  email: string;
  organizationId: string | null;
  role: string;
};

/** @deprecated Usa `HttpError` de `@/lib/http`. */
export class ApiError extends HttpError {
  statusCode: number;
  body: string;

  constructor(statusCode: number, body: string) {
    super(body || `La solicitud falló (${statusCode})`, statusCode, 'REQUEST_FAILED', body);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * @deprecated Las páginas nuevas deben usar `http` o los hooks de `@/lib/queries`.
 * Se conserva para las pantallas aún no migradas.
 */
export async function adminApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  try {
    return await http<T>(path, { ...init, token });
  } catch (error) {
    if (error instanceof HttpError && error.status !== null) {
      throw new ApiError(error.status, error.message);
    }
    throw error;
  }
}

export async function login(email: string, password: string) {
  return http<{ accessToken: string; user: AuthUser }>(`${API}/auth/login`, {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

/** @deprecated Usa `useSession()`. */
export async function fetchMe(token: string) {
  return adminApi<AuthUser>('/auth/me', token);
}

/** @deprecated Usa `useSession()` o `getTokenStorage()`. */
export function getStoredToken() {
  return getTokenStorage().getToken();
}
