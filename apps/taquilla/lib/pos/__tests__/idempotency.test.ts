import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  beginSaleAttempt,
  createClientSaleId,
  getPendingSale,
  markSaleConfirmed,
  markSaleFailed,
} from '../idempotency';
import { PENDING_SALE_KEY } from '../keys';

type StorageMap = Map<string, string>;

function installLocalStorageMock(): StorageMap {
  const store: StorageMap = new Map();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: localStorageMock },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
  return store;
}

describe('createClientSaleId', () => {
  it('returns unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createClientSaleId()));
    assert.equal(ids.size, 200);
  });
});

describe('beginSaleAttempt persistence', () => {
  let store: StorageMap;

  beforeEach(() => {
    store = installLocalStorageMock();
  });

  afterEach(() => {
    store.clear();
  });

  it('persists submitting state before network', () => {
    const state = beginSaleAttempt({
      clientSaleId: 'sale-abc',
      terminalId: 'term-1',
      sessionId: 'sess-1',
    });
    assert.equal(state.status, 'submitting');
    assert.equal(state.clientSaleId, 'sale-abc');
    assert.ok(store.has(PENDING_SALE_KEY));
    const pending = getPendingSale();
    assert.ok(pending);
    assert.equal(pending?.status, 'submitting');
    assert.equal(pending?.terminalId, 'term-1');
    assert.equal(pending?.sessionId, 'sess-1');
  });

  it('marks confirmed and failed transitions', () => {
    beginSaleAttempt({
      clientSaleId: 'sale-xyz',
      terminalId: 'term-1',
      sessionId: 'sess-1',
    });
    markSaleConfirmed('ord-1', 'pub-1');
    let pending = getPendingSale();
    assert.equal(pending?.status, 'confirmed');
    assert.equal(pending?.orderId, 'ord-1');
    assert.equal(pending?.publicId, 'pub-1');

    beginSaleAttempt({
      clientSaleId: 'sale-fail',
      terminalId: 'term-1',
      sessionId: 'sess-1',
    });
    markSaleFailed('network down');
    pending = getPendingSale();
    assert.equal(pending?.status, 'failed');
    assert.equal(pending?.error, 'network down');
  });
});
