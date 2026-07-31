import {
  apiFetch,
  getCashierId as getAuthCashierId,
  getOrgId,
  getTaquillaUser,
} from '../auth';
import { clearCloseIntent, retryCloseIntent, saveCloseIntent } from './close-intent';
import { CASHIER_KEY, OPENING_CASH_KEY, SESSION_KEY, TERMINAL_KEY } from './keys';
import { centavosToPesosNumber, centavosToPesosString, pesosToCentavos } from './money';
import type { SessionSummary } from './types';

export function getTerminalId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TERMINAL_KEY);
}

export function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_KEY);
}

export function getCashierId(): string {
  if (typeof window === 'undefined') return 'cashier-1';
  return localStorage.getItem(CASHIER_KEY) || getAuthCashierId() || 'cashier-1';
}

export function setCashierId(id: string): void {
  localStorage.setItem(CASHIER_KEY, id);
}

export function getOpeningCash(): number {
  if (typeof window === 'undefined') return 0;
  const stored = localStorage.getItem(OPENING_CASH_KEY) || '0';
  try {
    return centavosToPesosNumber(pesosToCentavos(stored));
  } catch {
    return 0;
  }
}

export function setOpeningCash(amount: number): void {
  const centavos = pesosToCentavos(amount);
  localStorage.setItem(OPENING_CASH_KEY, centavosToPesosString(centavos));
}

export function resolveOrgId(): string {
  return getOrgId() || getTaquillaUser()?.organizationId || 'org-demo';
}

export async function ensurePosSession(
  organizationId: string,
  cashierId: string,
  openingCash = 0,
): Promise<{ terminalId: string; sessionId: string }> {
  let terminalId = getTerminalId();
  if (!terminalId) {
    const res = await apiFetch('/taquilla/terminal/init-org', {
      method: 'POST',
      body: JSON.stringify({
        organizationId,
        locationName: 'Mostrador principal',
        terminalName: `POS-${typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 12) : 'term'}`,
      }),
    });
    if (!res.ok) throw new Error('No se pudo inicializar terminal');
    const terminal = (await res.json()) as { id: string };
    terminalId = terminal.id;
    localStorage.setItem(TERMINAL_KEY, terminalId);
  }

  let sessionId = getSessionId();
  if (!sessionId) {
    const res = await apiFetch('/taquilla/session/start', {
      method: 'POST',
      body: JSON.stringify({ terminalId, cashierId, openingCash }),
    });
    if (!res.ok) throw new Error('No se pudo abrir sesión');
    const session = (await res.json()) as { sessionId: string; openingCash?: number | string };
    sessionId = session.sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
    setOpeningCash(Number(session.openingCash ?? openingCash));
  }

  setCashierId(cashierId);
  return { terminalId, sessionId };
}

export async function openShift(opts: {
  organizationId: string;
  cashierId: string;
  openingCash: number;
  forceNew?: boolean;
}): Promise<{ terminalId: string; sessionId: string }> {
  if (opts.forceNew) localStorage.removeItem(SESSION_KEY);
  setOpeningCash(opts.openingCash);
  return ensurePosSession(opts.organizationId, opts.cashierId, opts.openingCash);
}

export async function fetchSessionSummary(sessionId: string): Promise<SessionSummary> {
  const res = await apiFetch(`/taquilla/session/summary?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error('No se pudo cargar resumen de turno');
  return res.json() as Promise<SessionSummary>;
}

export async function endSession(
  sessionId: string,
  closingCashCounted: number,
  managerPin?: string,
): Promise<Record<string, unknown>> {
  saveCloseIntent({
    sessionId,
    closingCashCounted,
    managerPin,
  });
  return retryCloseIntent();
}

export async function addCashDrop(amount: number, note?: string): Promise<SessionSummary> {
  const sessionId = getSessionId();
  if (!sessionId) throw new Error('Sin sesión');
  const res = await apiFetch('/taquilla/session/cash-drop', {
    method: 'POST',
    body: JSON.stringify({ sessionId, amount, note, cashierId: getCashierId() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SessionSummary>;
}

export async function handoffShift(opts: {
  toCashierId: string;
  closingCashCounted: number;
  openingCash?: number;
  managerPin?: string;
}): Promise<{
  closed: Record<string, unknown>;
  next: { sessionId: string; openingCash?: number };
}> {
  const sessionId = getSessionId();
  if (!sessionId) throw new Error('Sin sesión activa');
  const res = await apiFetch('/taquilla/session/handoff', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      fromCashierId: getCashierId(),
      toCashierId: opts.toCashierId,
      closingCashCounted: opts.closingCashCounted,
      openingCash: opts.openingCash,
      managerPin: opts.managerPin,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    closed: Record<string, unknown>;
    next: { sessionId: string; openingCash?: number };
  };
  if (data.next?.sessionId) {
    localStorage.setItem(SESSION_KEY, data.next.sessionId);
    setCashierId(opts.toCashierId);
    if (data.next.openingCash != null) setOpeningCash(data.next.openingCash);
  }
  clearCloseIntent();
  return data;
}
