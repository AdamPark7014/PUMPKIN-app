import { apiFetch, getCashierId as getAuthCashierId } from '../auth';
import { CASHIER_KEY, CLOSE_INTENT_KEY, SESSION_KEY } from './keys';
import type { CloseIntentState } from './types';

export type CloseIntentInput = {
  sessionId: string;
  closingCashCounted: number;
  managerPin?: string;
};

function resolveCashierId(): string {
  if (typeof window === 'undefined') return 'cashier-1';
  return localStorage.getItem(CASHIER_KEY) || getAuthCashierId() || 'cashier-1';
}

function isCloseIntentState(value: unknown): value is CloseIntentState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === 'string' &&
    typeof record.closingCashCounted === 'number' &&
    typeof record.startedAt === 'string' &&
    (record.status === 'pending' || record.status === 'confirmed' || record.status === 'failed')
  );
}

export function getCloseIntent(): CloseIntentState | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(CLOSE_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCloseIntentState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCloseIntent(input: CloseIntentInput): CloseIntentState {
  const state: CloseIntentState = {
    sessionId: input.sessionId,
    closingCashCounted: input.closingCashCounted,
    managerPin: input.managerPin,
    startedAt: new Date().toISOString(),
    status: 'pending',
  };
  localStorage.setItem(CLOSE_INTENT_KEY, JSON.stringify(state));
  return state;
}

export function clearCloseIntent(): void {
  localStorage.removeItem(CLOSE_INTENT_KEY);
}

/**
 * Retries a durable session-close intent after network mid-failure.
 * Clears local session + intent only after confirmed server close.
 */
export async function retryCloseIntent(): Promise<Record<string, unknown>> {
  const intent = getCloseIntent();
  if (!intent) throw new Error('No hay intento de cierre pendiente');

  try {
    const res = await apiFetch('/taquilla/session/end', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: intent.sessionId,
        cashierId: resolveCashierId(),
        closingCashCounted: intent.closingCashCounted,
        managerPin: intent.managerPin,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = (await res.json()) as Record<string, unknown>;
    localStorage.removeItem(SESSION_KEY);
    clearCloseIntent();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al cerrar turno';
    localStorage.setItem(
      CLOSE_INTENT_KEY,
      JSON.stringify({
        ...intent,
        status: 'failed',
        error: message,
      } satisfies CloseIntentState),
    );
    throw error;
  }
}
