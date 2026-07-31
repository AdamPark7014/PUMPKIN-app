/**
 * Cola IndexedDB de ventas POS offline.
 *
 * - Deduplica por `clientSaleId` (put = upsert; nunca se duplica la misma venta).
 * - Reintentos con backoff (`attempts`, `nextRetryAt`); `flushQueue` salta ítems no vencidos.
 * - Sin dependencia del barrel `@/lib/pos`: el callback de fallo se inyecta desde el caller
 *   (rompe el ciclo circular offline-queue ↔ pos).
 */

import type { OfflinePosPayload } from '@/lib/pos/types';

const DB_NAME = 'boletera-taquilla';
const STORE = 'sales';
/** v3: metadatos de reintento en QueuedSale; el esquema del store no cambia (keyPath `id`). */
const DB_VERSION = 3;

const MAX_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 2_000;

/** Mutex en memoria: un solo flush a la vez por pestaña (evita carreras de doble envío). */
let flushInFlight: Promise<number> | null = null;

export interface QueuedSale {
  id: string;
  payload: OfflinePosPayload | Record<string, unknown>;
  createdAt: string;
  /** Intentos de sync fallidos. Ausente en filas legacy → tratado como 0. */
  attempts?: number;
  /** ISO: no reintentar antes de esta marca. Ausente → elegible de inmediato. */
  nextRetryAt?: string;
  /** Último error de sync (diagnóstico UI / recovery). */
  lastError?: string;
}

export interface FlushQueueOptions {
  /**
   * Invocado cuando un ítem falla. Preferido sobre `pushFailedSync` del barrel pos
   * para evitar el ciclo de imports. El caller típico inyecta `pushFailedSync`.
   */
  onFailure?: (info: { clientSaleId: string; error: string; attempts: number }) => void;
  /** Si es `true`, ignora `nextRetryAt` y reintenta todo. Default `false`. */
  force?: boolean;
  /** Tope de ítems a intentar en esta pasada. Default: sin límite. */
  maxItems?: number;
}

export interface PendingQueueStats {
  size: number;
  oldestCreatedAt: string | null;
  /** Edad del ítem más viejo en milisegundos, o `null` si la cola está vacía. */
  oldestAgeMs: number | null;
  dueNow: number;
  deferred: number;
  maxAttempts: number;
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

function extractClientSaleId(payload: OfflinePosPayload | Record<string, unknown>): string {
  const fromTop =
    typeof (payload as OfflinePosPayload).clientSaleId === 'string'
      ? (payload as OfflinePosPayload).clientSaleId.trim()
      : '';
  if (fromTop) return fromTop;

  const checkout = (payload as OfflinePosPayload).checkoutData;
  const fromCheckout =
    checkout && typeof checkout.clientSaleId === 'string' ? checkout.clientSaleId.trim() : '';
  if (fromCheckout) return fromCheckout;

  return typeof crypto !== 'undefined' ? crypto.randomUUID() : `sale-${Date.now()}`;
}

function backoffMs(attempts: number): number {
  // attempts ya incluye el fallo que acaba de ocurrir (1 → 2s, 2 → 4s, …).
  const exp = Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exp);
}

function isDue(sale: QueuedSale, now: number, force: boolean): boolean {
  if (force) return true;
  if (!sale.nextRetryAt) return true;
  const t = Date.parse(sale.nextRetryAt);
  if (Number.isNaN(t)) return true;
  return t <= now;
}

function normalizeSale(raw: QueuedSale): QueuedSale {
  return {
    id: raw.id,
    payload: raw.payload,
    createdAt: raw.createdAt || new Date(0).toISOString(),
    attempts: typeof raw.attempts === 'number' && raw.attempts >= 0 ? raw.attempts : 0,
    nextRetryAt: raw.nextRetryAt,
    lastError: raw.lastError,
  };
}

function sortByCreatedAt(a: QueuedSale, b: QueuedSale): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function idbGetAll(db: IDBDatabase): Promise<QueuedSale[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueuedSale[]).map(normalizeSale));
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, sale: QueuedSale): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(sale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<QueuedSale | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => {
      const row = req.result as QueuedSale | undefined;
      resolve(row ? normalizeSale(row) : undefined);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Encola (o actualiza) una venta por `clientSaleId`.
 * Put sobre la misma clave = upsert: reenviar la misma venta no duplica la fila.
 * Si ya existía, se preserva `createdAt` y se resetea el backoff para reintentar pronto.
 */
export async function enqueueSale(payload: OfflinePosPayload | Record<string, unknown>): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const id = extractClientSaleId(payload);

  await withDb(async (db) => {
    const existing = await idbGet(db, id);
    const sale: QueuedSale = {
      id,
      payload,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      attempts: 0,
      nextRetryAt: undefined,
      lastError: undefined,
    };
    await idbPut(db, sale);
  });
}

export async function getQueueSize(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  return withDb(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Lista completa ordenada por `createdAt` (FIFO) para UI de recuperación. */
export async function listQueuedSales(): Promise<QueuedSale[]> {
  if (typeof indexedDB === 'undefined') return [];
  const all = await withDb(idbGetAll);
  return all.sort(sortByCreatedAt);
}

/** Primer ítem de la cola (el más antiguo), o `null` si está vacía. */
export async function peekQueue(): Promise<QueuedSale | null> {
  const all = await listQueuedSales();
  return all[0] ?? null;
}

export async function recoverPendingQueueStats(): Promise<PendingQueueStats> {
  if (typeof indexedDB === 'undefined') {
    return {
      size: 0,
      oldestCreatedAt: null,
      oldestAgeMs: null,
      dueNow: 0,
      deferred: 0,
      maxAttempts: 0,
    };
  }
  const all = await listQueuedSales();
  const now = Date.now();
  let dueNow = 0;
  let deferred = 0;
  let maxAttempts = 0;
  for (const sale of all) {
    maxAttempts = Math.max(maxAttempts, sale.attempts ?? 0);
    if (isDue(sale, now, false)) dueNow += 1;
    else deferred += 1;
  }
  const oldest = all[0] ?? null;
  const oldestCreatedAt = oldest?.createdAt ?? null;
  const oldestAgeMs =
    oldestCreatedAt !== null && !Number.isNaN(Date.parse(oldestCreatedAt))
      ? Math.max(0, now - Date.parse(oldestCreatedAt))
      : null;

  return {
    size: all.length,
    oldestCreatedAt,
    oldestAgeMs,
    dueNow,
    deferred,
    maxAttempts,
  };
}

/**
 * Vacía la cola enviando cada venta con `send`.
 *
 * - Salta ítems cuyo `nextRetryAt` aún no vence (salvo `force`).
 * - Tras un fallo, marca backoff y continúa con el siguiente ítem elegible
 *   (no aborta toda la cola); el orden FIFO se mantiene al recorrer la lista.
 * - Mutex: llamadas concurrentes se serializan sobre la misma promesa.
 *
 * Firma legacy: `flushQueue(send)` — `options` es opcional y compatible.
 */
export async function flushQueue(
  send: (payload: QueuedSale['payload']) => Promise<void>,
  options: FlushQueueOptions = {},
): Promise<number> {
  if (flushInFlight) return flushInFlight;

  flushInFlight = runFlush(send, options).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlush(
  send: (payload: QueuedSale['payload']) => Promise<void>,
  options: FlushQueueOptions,
): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;

  const { onFailure, force = false, maxItems } = options;
  const now = Date.now();

  const all = (await withDb(idbGetAll)).sort(sortByCreatedAt);
  let synced = 0;
  let attempted = 0;

  for (const sale of all) {
    if (maxItems !== undefined && attempted >= maxItems) break;
    if (!isDue(sale, now, force)) continue;

    attempted += 1;
    try {
      await send(sale.payload);
      await withDb((db) => idbDelete(db, sale.id));
      synced += 1;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'sync failed';
      const attempts = (sale.attempts ?? 0) + 1;
      const nextRetryAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
      const updated: QueuedSale = {
        ...sale,
        attempts,
        nextRetryAt,
        lastError: error,
      };
      try {
        await withDb((db) => idbPut(db, updated));
      } catch {
        // Si IndexedDB falla al persistir el backoff, igual notificamos al caller.
      }
      onFailure?.({ clientSaleId: sale.id, error, attempts });
      // Continuar: no romper la cola entera por un ítem; el orden se preserva
      // porque ya recorrimos en FIFO y los siguientes siguen en su turno.
    }
  }

  return synced;
}
