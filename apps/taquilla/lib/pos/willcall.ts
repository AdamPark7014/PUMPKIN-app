import { apiFetch } from '../auth';
import { getCashierId, getTerminalId, resolveOrgId } from './session';

export async function willcallLookup(q: string): Promise<unknown> {
  const res = await apiFetch('/taquilla/willcall/lookup', {
    method: 'POST',
    body: JSON.stringify({ q, organizationId: resolveOrgId() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function willcallFulfill(orderId: string): Promise<unknown> {
  const res = await apiFetch('/taquilla/willcall/fulfill', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      cashierId: getCashierId(),
      terminalId: getTerminalId(),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
