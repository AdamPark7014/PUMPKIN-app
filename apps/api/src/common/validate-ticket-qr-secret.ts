import { assertTicketSecret } from '@boletera/crypto';

/**
 * Fail-fast at process boot: the QR signing secret must meet
 * `assertTicketSecret` (≥32 chars) before Nest listens for traffic.
 *
 * Resolution mirrors runtime consumers (`TICKET_QR_SECRET || JWT_SECRET`).
 * An empty `TICKET_QR_SECRET=` is rejected because `||` and `??` disagree
 * across modules and would otherwise surface as a 500 on first QR use.
 */
export function validateTicketQrSecret(): void {
  const ticketQr = process.env.TICKET_QR_SECRET;
  const jwt = process.env.JWT_SECRET;

  if (ticketQr !== undefined && ticketQr.length === 0) {
    throw new Error(
      'TICKET_QR_SECRET is empty. Set at least 32 characters (openssl rand -hex 32) ' +
        'or omit the variable to fall back to JWT_SECRET.',
    );
  }

  const secret = ticketQr || jwt;
  if (!secret) {
    throw new Error('Neither TICKET_QR_SECRET nor JWT_SECRET is configured.');
  }

  try {
    assertTicketSecret(secret);
  } catch (error) {
    if (!ticketQr && jwt) {
      throw new Error(
        'TICKET_QR_SECRET is not set and JWT_SECRET is shorter than 32 characters, ' +
          'so QR signing would fail at runtime. Set TICKET_QR_SECRET with: openssl rand -hex 32',
      );
    }
    throw error;
  }
}
