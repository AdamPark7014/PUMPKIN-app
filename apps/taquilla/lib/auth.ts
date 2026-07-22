const TOKEN_KEY = 'taquilla_token';
const CASHIER_KEY = 'taquilla_cashier';

export function getTaquillaToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getCashierId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CASHIER_KEY);
}

export function saveTaquillaSession(token: string, cashierId: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(CASHIER_KEY, cashierId);
}

export function clearTaquillaSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CASHIER_KEY);
}
