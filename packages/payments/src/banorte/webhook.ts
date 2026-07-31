import { createHmac, timingSafeEqual } from 'node:crypto';

export type BanorteParsedStatus =
  | 'completed'
  | 'failed'
  | 'pending'
  | 'declined'
  | 'cancelled'
  | 'expired';

/**
 * Verify Banorte IPN / webhook HMAC signature.
 *
 * Soft-allow missing secret ONLY outside production (local demos).
 * In production (NODE_ENV=production), a missing secret ALWAYS fails —
 * never skip signature verification in production.
 *
 * Uses crypto.timingSafeEqual on equal-length buffers (timing-safe).
 */
export function verifyBanorteWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  const isProd = process.env.NODE_ENV === 'production';
  if (!secret) {
    // Soft-allow only in demo/dev. Production MUST set BANORTE_WEBHOOK_SECRET.
    return !isProd;
  }
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = signature.trim().toLowerCase();
  const expectedNorm = expected.toLowerCase();

  const expectedBuf = Buffer.from(expectedNorm, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Normalize free-text / JSON gateway responses into BanorteParsedStatus. */
export function parseBanorteStatusText(text: string): BanorteParsedStatus {
  const lower = text.toLowerCase();
  if (
    lower.includes('aprobada') ||
    lower.includes('approved') ||
    lower.includes('"00"') ||
    lower.includes('exitoso')
  ) {
    return 'completed';
  }
  if (lower.includes('expir') || lower.includes('timeout')) {
    return 'expired';
  }
  if (lower.includes('cancel')) {
    return 'cancelled';
  }
  if (
    lower.includes('rechaz') ||
    lower.includes('declined') ||
    lower.includes('declin') ||
    lower.includes('failed') ||
    lower.includes('deneg')
  ) {
    return 'declined';
  }
  return 'pending';
}
