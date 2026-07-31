import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * HMAC rotation window for ticket QR signatures.
 * Signatures are valid for the current window, the previous window, and the next
 * window (clock skew tolerance).
 */
export const ROTATION_SECONDS = 15;

/** Minimum length for TICKET_QR_SECRET (UTF-8 code units). */
export const MIN_SECRET_LENGTH = 32;

/** Hex characters kept from the HMAC-SHA256 digest (128 bits). */
const SIGNATURE_HEX_LENGTH = 32;

/**
 * Parsed ticket QR envelope.
 * Legacy payloads omit `version`; current issuers set `v: 1`.
 */
export interface TicketQrPayload {
  ticketId: string;
  eventId: string;
  signature: string;
  version?: 1;
}

/**
 * Asserts that a ticket QR secret meets the minimum strength requirement.
 *
 * Migration: set `TICKET_QR_SECRET` to a high-entropy value of at least 32
 * characters (e.g. `openssl rand -hex 32`). Do not fall back to short or
 * default secrets — this package never supplies one.
 */
export function assertTicketSecret(secret: string): asserts secret is string {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `TICKET_QR_SECRET must be at least ${MIN_SECRET_LENGTH} characters. ` +
        'Generate one with: openssl rand -hex 32',
    );
  }
}

export function generateTicketCode(): string {
  return `BLT-${randomBytes(8).toString('hex').toUpperCase()}`;
}

function currentWindow(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / (ROTATION_SECONDS * 1000));
}

function signWindow(ticketId: string, eventId: string, secret: string, window: number): string {
  const payload = `${ticketId}:${eventId}:${window}`;
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, SIGNATURE_HEX_LENGTH);
}

/**
 * Compare two strings in constant time when lengths match.
 * Different lengths always return false after a dummy compare.
 */
function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function signTicketPayload(ticketId: string, eventId: string, secret: string): string {
  assertTicketSecret(secret);
  return signWindow(ticketId, eventId, secret, currentWindow());
}

/**
 * Verifies a rotating HMAC signature.
 * Accepts the current 15s window, the previous window, and the next window
 * (optional clock-skew tolerance). Comparison is timing-safe.
 */
export function verifyTicketSignature(
  ticketId: string,
  eventId: string,
  signature: string,
  secret: string,
): boolean {
  assertTicketSecret(secret);
  if (typeof signature !== 'string' || signature.length === 0) {
    return false;
  }

  const window = currentWindow();
  const candidates = [window, window - 1, window + 1];

  let matched = false;
  for (const w of candidates) {
    const expected = signWindow(ticketId, eventId, secret, w);
    if (safeEqualString(signature, expected)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Builds a QR JSON payload: `{ t, e, s, v: 1 }`.
 * The `v` field is additive; older scanners that only read `t`/`e`/`s` remain compatible.
 */
export function buildQrPayload(ticketId: string, eventId: string, secret: string): string {
  const sig = signTicketPayload(ticketId, eventId, secret);
  return JSON.stringify({ t: ticketId, e: eventId, s: sig, v: 1 });
}

/**
 * Parses a ticket QR JSON string into a typed envelope.
 * Accepts legacy `{ t, e, s }` and current `{ t, e, s, v: 1 }` payloads.
 */
export function parseQrPayload(raw: string): TicketQrPayload {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('Malformed QR payload');
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Malformed QR payload');
  }

  const obj = decoded as Record<string, unknown>;
  const t = obj.t;
  const e = obj.e;
  const s = obj.s;
  const v = obj.v;

  if (typeof t !== 'string' || typeof e !== 'string' || typeof s !== 'string') {
    throw new Error('Malformed QR payload');
  }
  if (t.length === 0 || e.length === 0 || s.length === 0) {
    throw new Error('Malformed QR payload');
  }

  if (v !== undefined && v !== 1) {
    throw new Error('Unsupported QR payload version');
  }

  const result: TicketQrPayload = {
    ticketId: t,
    eventId: e,
    signature: s,
  };
  if (v === 1) {
    result.version = 1;
  }
  return result;
}
