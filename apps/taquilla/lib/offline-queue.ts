const DB_NAME = 'boletera-taquilla';
const STORE = 'sales';
const DB_VERSION = 2;

import type { OfflinePosPayload } from './pos';
import { pushFailedSync } from './pos';

export interface QueuedSale {
  id: string;
  payload: OfflinePosPayload | Record<string, unknown>;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        const bump = indexedDB.open(DB_NAME, db.version + 1);
        bump.onupgradeneeded = () => {
          const udb = bump.result;
          if (!udb.objectStoreNames.contains(STORE)) {
            udb.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        bump.onsuccess = () => resolve(bump.result);
        bump.onerror = () => reject(bump.error);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueSale(payload: OfflinePosPayload | Record<string, unknown>): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const id =
    (payload as OfflinePosPayload).clientSaleId ||
    (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now()));
  const sale: QueuedSale = { id, payload, createdAt: new Date().toISOString() };
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(sale);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getQueueSize(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const g = tx.objectStore(STORE).count();
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
  } finally {
    db.close();
  }
}

export async function flushQueue(
  send: (payload: QueuedSale['payload']) => Promise<void>,
): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await openDb();
  try {
    const all = await new Promise<QueuedSale[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const g = tx.objectStore(STORE).getAll();
      g.onsuccess = () => resolve(g.result as QueuedSale[]);
      g.onerror = () => reject(g.error);
    });

    let count = 0;
    for (const sale of all) {
      try {
        await send(sale.payload);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(sale.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        count++;
      } catch (e) {
        pushFailedSync({
          clientSaleId: sale.id,
          error: e instanceof Error ? e.message : 'sync failed',
        });
        break;
      }
    }
    return count;
  } finally {
    db.close();
  }
}
