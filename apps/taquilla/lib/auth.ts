const TOKEN_KEY = 'taquilla_token';
const CASHIER_KEY = 'taquilla_cashier';
const ORG_KEY = 'boletera_org';
const USER_KEY = 'taquilla_user';
const TERMINAL_LABEL_KEY = 'taquilla_terminal_label';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export type TaquillaUser = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  organizationId?: string | null;
};

export function getApiBase() {
  return API;
}

export function getTaquillaToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getCashierId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CASHIER_KEY);
}

export function getOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ORG_KEY);
}

export function getTerminalLabel(): string {
  if (typeof window === 'undefined') return 'TAQ-01';
  return localStorage.getItem(TERMINAL_LABEL_KEY) || 'TAQ-01';
}

export function getTaquillaUser(): TaquillaUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TaquillaUser;
  } catch {
    return null;
  }
}

export function saveTaquillaSession(
  token: string,
  opts: {
    terminalLabel: string;
    user: TaquillaUser;
    cashierId?: string;
  },
) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TERMINAL_LABEL_KEY, opts.terminalLabel);
  localStorage.setItem(USER_KEY, JSON.stringify(opts.user));
  localStorage.setItem(CASHIER_KEY, opts.cashierId || opts.user.id);
  if (opts.user.organizationId) {
    localStorage.setItem(ORG_KEY, opts.user.organizationId);
  }
}

export function clearTaquillaSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CASHIER_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TERMINAL_LABEL_KEY);
  localStorage.removeItem(ORG_KEY);
  localStorage.removeItem('boletera_pos_session');
  localStorage.removeItem('boletera_terminal_id');
  localStorage.removeItem('boletera_cashier_id');
  localStorage.removeItem('boletera_opening_cash');
  localStorage.removeItem('boletera_last_receipt');
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getTaquillaToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    return await fetch(`${API}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers,
    });
  } catch (err) {
    const msg =
      err instanceof TypeError
        ? `Failed to fetch → ${API} (¿API en :4000 / CORS para :3002?)`
        : err instanceof Error
          ? err.message
          : 'Network error';
    throw new Error(msg);
  }
}
