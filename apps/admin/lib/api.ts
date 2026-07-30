const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://127.0.0.1:4000/api/v1';

export type AuthUser = {
  id: string;
  email: string;
  organizationId: string | null;
  role: string;
};

export class ApiError extends Error {
  statusCode: number;
  body: string;

  constructor(statusCode: number, body: string) {
    super(body || `Request failed (${statusCode})`);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

function clearSessionAndRedirectToLogin() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('boletera_token');
  localStorage.removeItem('boletera_org');
  if (!window.location.pathname.startsWith('/login')) {
    window.location.replace('/login');
  }
}

export async function adminApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      clearSessionAndRedirectToLogin();
    }
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json() as Promise<{ accessToken: string; user: AuthUser }>;
}

export async function fetchMe(token: string) {
  return adminApi<AuthUser>('/auth/me', token);
}

export function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('boletera_token');
}
