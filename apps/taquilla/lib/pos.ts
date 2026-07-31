/**
 * Public POS API barrel — keeps `@/lib/pos` stable for taquilla pages.
 * Implementation lives under `./pos/*`.
 *
 * Note: re-export submodules explicitly (not `./pos/index`) to avoid
 * Node/tsx ambiguity between this file and the `pos/` directory.
 */
export type {
  CloseIntentState,
  OfflinePosPayload,
  PaymentMethod,
  PendingSaleState,
  PosReceipt,
  SessionSummary,
} from './pos/types';

export {
  TERMINAL_KEY,
  SESSION_KEY,
  CASHIER_KEY,
  OPENING_CASH_KEY,
  LAST_RECEIPT_KEY,
  LOCAL_QUOTA_KEY,
  FAILED_SYNC_KEY,
  PENDING_SALE_KEY,
  CLOSE_INTENT_KEY,
} from './pos/keys';

export {
  type Centavos,
  pesosToCentavos,
  centavosToPesosNumber,
  centavosToPesosString,
  formatMxn,
  addCentavos,
  subCentavos,
  cashVarianceCentavos,
  parseMoneyInput,
  isZeroCentavos,
} from './pos/money';

export {
  createClientSaleId,
  getPendingSale,
  savePendingSale,
  clearPendingSale,
  beginSaleAttempt,
  markSaleConfirmed,
  markSaleQueuedOffline,
  markSaleFailed,
} from './pos/idempotency';

export {
  getCloseIntent,
  saveCloseIntent,
  clearCloseIntent,
  retryCloseIntent,
  type CloseIntentInput,
} from './pos/close-intent';

export {
  getTerminalId,
  getSessionId,
  getCashierId,
  setCashierId,
  getOpeningCash,
  setOpeningCash,
  resolveOrgId,
  ensurePosSession,
  openShift,
  fetchSessionSummary,
  endSession,
  addCashDrop,
  handoffShift,
} from './pos/session';

export {
  createPosHold,
  releasePosHolds,
  posCheckout,
  scanTicket,
  voidOrder,
  exchangeOrder,
  type PosCheckoutResult,
  type ExchangeOrderResult,
} from './pos/checkout';

export {
  saveLastReceipt,
  getLastReceipt,
  fetchReceipt,
  printReceipt,
} from './pos/receipt';

export {
  syncOfflineSales,
  syncInventoryCache,
  getLocalQuotas,
  reserveLocalQuota,
  pushFailedSync,
  getFailedSync,
  clearFailedSync,
} from './pos/offline';

export { willcallLookup, willcallFulfill } from './pos/willcall';
