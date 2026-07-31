import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  ROTATION_SECONDS,
  MIN_SECRET_LENGTH,
  assertTicketSecret,
  buildQrPayload,
  generateTicketCode,
  parseQrPayload,
  signTicketPayload,
  verifyTicketSignature,
} from './index.ts';

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);
const SHORT_SECRET = 'too-short-secret-value';

describe('assertTicketSecret', () => {
  it('accepts secrets of at least 32 characters', () => {
    assert.doesNotThrow(() => assertTicketSecret(SECRET));
    assert.doesNotThrow(() => assertTicketSecret('x'.repeat(64)));
  });

  it('rejects short or non-string secrets with a clear migration message', () => {
    assert.throws(() => assertTicketSecret(SHORT_SECRET), /TICKET_QR_SECRET must be at least 32/);
    assert.throws(() => assertTicketSecret(''), /TICKET_QR_SECRET must be at least 32/);
    assert.throws(
      () => assertTicketSecret(null as unknown as string),
      /TICKET_QR_SECRET must be at least 32/,
    );
  });
});

describe('generateTicketCode', () => {
  it('returns a BLT- prefixed uppercase hex code', () => {
    const code = generateTicketCode();
    assert.match(code, /^BLT-[0-9A-F]{16}$/);
  });

  it('produces unique codes', () => {
    const a = generateTicketCode();
    const b = generateTicketCode();
    assert.notEqual(a, b);
  });
});

describe('sign and verify', () => {
  it('exports ROTATION_SECONDS as 15', () => {
    assert.equal(ROTATION_SECONDS, 15);
  });

  it('round-trips a fresh signature', () => {
    const sig = signTicketPayload('ticket-1', 'event-1', SECRET);
    assert.equal(sig.length, 32);
    assert.match(sig, /^[0-9a-f]{32}$/);
    assert.equal(verifyTicketSignature('ticket-1', 'event-1', sig, SECRET), true);
  });

  it('rejects wrong ticket, event, or signature', () => {
    const sig = signTicketPayload('ticket-1', 'event-1', SECRET);
    assert.equal(verifyTicketSignature('ticket-2', 'event-1', sig, SECRET), false);
    assert.equal(verifyTicketSignature('ticket-1', 'event-2', sig, SECRET), false);
    assert.equal(verifyTicketSignature('ticket-1', 'event-1', '0'.repeat(32), SECRET), false);
    assert.equal(verifyTicketSignature('ticket-1', 'event-1', '', SECRET), false);
  });

  it('rejects short secrets on sign and verify', () => {
    assert.throws(() => signTicketPayload('t', 'e', SHORT_SECRET), /TICKET_QR_SECRET/);
    assert.throws(
      () => verifyTicketSignature('t', 'e', '0'.repeat(32), SHORT_SECRET),
      /TICKET_QR_SECRET/,
    );
  });

  it('accepts previous and next rotation windows for clock skew', () => {
    const ticketId = 'ticket-skew';
    const eventId = 'event-skew';
    const window = Math.floor(Date.now() / (ROTATION_SECONDS * 1000));

    const hmac = (w: number): string =>
      createHmac('sha256', SECRET)
        .update(`${ticketId}:${eventId}:${w}`)
        .digest('hex')
        .slice(0, 32);

    assert.equal(verifyTicketSignature(ticketId, eventId, hmac(window), SECRET), true);
    assert.equal(verifyTicketSignature(ticketId, eventId, hmac(window - 1), SECRET), true);
    assert.equal(verifyTicketSignature(ticketId, eventId, hmac(window + 1), SECRET), true);
    assert.equal(verifyTicketSignature(ticketId, eventId, hmac(window - 2), SECRET), false);
    assert.equal(verifyTicketSignature(ticketId, eventId, hmac(window + 2), SECRET), false);
  });
});

describe('buildQrPayload / parseQrPayload', () => {
  it('builds a v:1 JSON payload that verifies', () => {
    const raw = buildQrPayload('ticket-1', 'event-1', SECRET);
    const parsedJson = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsedJson.t, 'ticket-1');
    assert.equal(parsedJson.e, 'event-1');
    assert.equal(parsedJson.v, 1);
    assert.equal(typeof parsedJson.s, 'string');

    const envelope = parseQrPayload(raw);
    assert.equal(envelope.ticketId, 'ticket-1');
    assert.equal(envelope.eventId, 'event-1');
    assert.equal(envelope.version, 1);
    assert.equal(
      verifyTicketSignature(envelope.ticketId, envelope.eventId, envelope.signature, SECRET),
      true,
    );
  });

  it('parses legacy payloads without v', () => {
    const sig = signTicketPayload('ticket-legacy', 'event-legacy', SECRET);
    const legacy = JSON.stringify({ t: 'ticket-legacy', e: 'event-legacy', s: sig });
    const envelope = parseQrPayload(legacy);
    assert.equal(envelope.ticketId, 'ticket-legacy');
    assert.equal(envelope.eventId, 'event-legacy');
    assert.equal(envelope.signature, sig);
    assert.equal(envelope.version, undefined);
  });

  it('rejects malformed and unsupported versions', () => {
    assert.throws(() => parseQrPayload('not-json'), /Malformed QR payload/);
    assert.throws(() => parseQrPayload('[]'), /Malformed QR payload/);
    assert.throws(() => parseQrPayload('{"t":1,"e":"e","s":"s"}'), /Malformed QR payload/);
    assert.throws(
      () => parseQrPayload(JSON.stringify({ t: 't', e: 'e', s: 's', v: 2 })),
      /Unsupported QR payload version/,
    );
    assert.throws(() => parseQrPayload(JSON.stringify({ t: '', e: 'e', s: 's' })), /Malformed/);
  });

  it('rejects short secrets when building QR payloads', () => {
    assert.throws(() => buildQrPayload('t', 'e', SHORT_SECRET), /TICKET_QR_SECRET/);
  });
});
