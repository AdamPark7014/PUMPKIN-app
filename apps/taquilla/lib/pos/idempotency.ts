import { PENDING_SALE_KEY } from './keys';
import type { PendingSaleState } from './types';

export function createClientSaleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPendingSale(): PendingSaleState | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(PENDING_SALE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingSaleState;
  } catch {
    return null;
  }
}

export function savePendingSale(state: PendingSaleState): void {
  localStorage.setItem(PENDING_SALE_KEY, JSON.stringify(state));
}

export function clearPendingSale(): void {
  localStorage.removeItem(PENDING_SALE_KEY);
}

/**
 * Marks a sale as in-flight before the network call.
 * On reload, UI must reconcile: if confirmed clear; if submitting/queued, retry with same clientSaleId.
 */
export function beginSaleAttempt(params: {
  clientSaleId: string;
  terminalId: string;
  sessionId: string;
}): PendingSaleState {
  const state: PendingSaleState = {
    clientSaleId: params.clientSaleId,
    terminalId: params.terminalId,
    sessionId: params.sessionId,
    status: 'submitting',
    createdAt: new Date().toISOString(),
  };
  savePendingSale(state);
  return state;
}

export function markSaleConfirmed(orderId: string, publicId: string): void {
  const cur = getPendingSale();
  if (!cur) return;
  savePendingSale({ ...cur, status: 'confirmed', orderId, publicId });
}

export function markSaleQueuedOffline(): void {
  const cur = getPendingSale();
  if (!cur) return;
  savePendingSale({ ...cur, status: 'queued_offline' });
}

export function markSaleFailed(error: string): void {
  const cur = getPendingSale();
  if (!cur) return;
  savePendingSale({ ...cur, status: 'failed', error });
}
