import { createHmac, randomBytes } from 'crypto';

const ROTATION_SECONDS = 15;

export function generateTicketCode(): string {
  return `BLT-${randomBytes(8).toString('hex').toUpperCase()}`;
}

export function signTicketPayload(ticketId: string, eventId: string, secret: string): string {
  const payload = `${ticketId}:${eventId}:${Math.floor(Date.now() / (ROTATION_SECONDS * 1000))}`;
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
}

export function verifyTicketSignature(
  ticketId: string,
  eventId: string,
  signature: string,
  secret: string,
): boolean {
  const current = signTicketPayload(ticketId, eventId, secret);
  const prevWindow = Math.floor(Date.now() / (ROTATION_SECONDS * 1000)) - 1;
  const prevPayload = `${ticketId}:${eventId}:${prevWindow}`;
  const prev = createHmac('sha256', secret).update(prevPayload).digest('hex').slice(0, 32);
  return signature === current || signature === prev;
}

export function buildQrPayload(ticketId: string, eventId: string, secret: string): string {
  const sig = signTicketPayload(ticketId, eventId, secret);
  return JSON.stringify({ t: ticketId, e: eventId, s: sig });
}
