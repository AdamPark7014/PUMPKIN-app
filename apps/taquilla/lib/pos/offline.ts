import { apiFetch } from '../auth';
import { FAILED_SYNC_KEY, LOCAL_QUOTA_KEY } from './keys';
import { getTerminalId } from './session';
import type { OfflinePosPayload } from './types';

export async function syncOfflineSales(
  transactions: OfflinePosPayload[],
): Promise<{ synced: number; failed?: number }> {
  const terminalId = getTerminalId();
  if (!terminalId || !transactions.length) return { synced: 0 };
  const res = await apiFetch(`/taquilla/offline/sync/${terminalId}`, {
    method: 'POST',
    body: JSON.stringify({
      transactions: transactions.map((transaction) => ({
        sessionId: transaction.sessionId,
        clientSaleId: transaction.clientSaleId,
        checkoutData: {
          ...transaction.checkoutData,
          clientSaleId: transaction.clientSaleId,
        },
      })),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ synced: number; failed?: number }>;
}

export async function syncInventoryCache(eventId: string): Promise<unknown | null> {
  const terminalId = getTerminalId();
  if (!terminalId) return null;
  const res = await apiFetch('/taquilla/sync-inventory', {
    method: 'POST',
    body: JSON.stringify({ terminalId, eventId }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { tickets?: Array<{ status: string }> };
  const quotas = getLocalQuotas();
  const remaining = (data.tickets || []).filter(
    (ticket) => String(ticket.status).toUpperCase() === 'AVAILABLE',
  ).length;
  quotas[eventId] = remaining;
  localStorage.setItem(LOCAL_QUOTA_KEY, JSON.stringify(quotas));
  return data;
}

export function getLocalQuotas(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_QUOTA_KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function reserveLocalQuota(eventId: string, qty: number): boolean {
  const quotas = getLocalQuotas();
  const available = quotas[eventId] ?? 0;
  if (available < qty) return false;
  quotas[eventId] = available - qty;
  localStorage.setItem(LOCAL_QUOTA_KEY, JSON.stringify(quotas));
  return true;
}

export function pushFailedSync(item: { clientSaleId: string; error: string }): void {
  const list = getFailedSync();
  list.push({ ...item, at: new Date().toISOString() });
  localStorage.setItem(FAILED_SYNC_KEY, JSON.stringify(list.slice(-20)));
}

export function getFailedSync(): Array<{
  clientSaleId: string;
  error: string;
  at: string;
}> {
  try {
    return JSON.parse(localStorage.getItem(FAILED_SYNC_KEY) || '[]') as Array<{
      clientSaleId: string;
      error: string;
      at: string;
    }>;
  } catch {
    return [];
  }
}

export function clearFailedSync(): void {
  localStorage.removeItem(FAILED_SYNC_KEY);
}
