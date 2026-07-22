const DB_NAME = 'boletera-taquilla';
const STORE = 'sales';

import type { OfflinePosPayload } from './pos';

export interface QueuedSale {
  id: string;
  payload: OfflinePosPayload | Record<string, unknown>;
  createdAt: string;
}

export async function enqueueSale(payload: OfflinePosPayload | Record<string, unknown>): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const id = crypto.randomUUID();
  const sale: QueuedSale = { id, payload, createdAt: new Date().toISOString() };
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(sale);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getQueueSize(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE, 'readonly');
      const g = tx.objectStore(STORE).count();
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function flushQueue(
  send: (payload: QueuedSale['payload']) => Promise<void>,
): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = async () => {
      const db = req.result;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const all = await new Promise<QueuedSale[]>((res, rej) => {
        const g = store.getAll();
        g.onsuccess = () => res(g.result as QueuedSale[]);
        g.onerror = () => rej(g.error);
      });
      let count = 0;
      for (const sale of all) {
        try {
          await send(sale.payload);
          store.delete(sale.id);
          count++;
        } catch {
          break;
        }
      }
      resolve(count);
    };
    req.onerror = () => reject(req.error);
  });
}
