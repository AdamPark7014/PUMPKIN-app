import { prisma, HoldStatus, PayoutStatus } from '@boletera/database';
import { logger } from '../logger';
import { config } from '../config';
import { classifyHttpStatus, PermanentError, TransientError } from '../errors';
import { correlationHeaders } from '../correlation';
import { liberateHeldInventory } from './liberate-held-inventory';

/**
 * Idempotent expiry: only ACTIVE + past-due holds transition to EXPIRED.
 * Frees reserved seats by seatId and GA inventory by offerId (seatId null).
 * Safe under concurrent workers / retries.
 */
export async function releaseExpiredHolds(correlationId: string): Promise<number> {
  const now = new Date();
  const expired = await prisma.seatHold.findMany({
    where: { status: HoldStatus.ACTIVE, expiresAt: { lte: now } },
    select: { id: true, eventId: true, seatId: true, offerId: true, quantity: true },
    take: 500,
  });

  let released = 0;
  for (const hold of expired) {
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.seatHold.updateMany({
        where: { id: hold.id, status: HoldStatus.ACTIVE, expiresAt: { lte: now } },
        data: { status: HoldStatus.EXPIRED, releasedAt: now },
      });
      if (updated.count === 0) return false;

      await liberateHeldInventory(tx, {
        eventId: hold.eventId,
        seatId: hold.seatId,
        offerId: hold.offerId,
        quantity: hold.quantity,
      });
      return true;
    });
    if (changed) released += 1;
  }

  if (released > 0) {
    logger.info('released expired holds', { correlationId, job: 'release-expired-holds', released });
  }
  return released;
}

export async function processPendingPayouts(correlationId: string): Promise<number> {
  const pending = await prisma.promoterPayout.count({
    where: { status: PayoutStatus.PENDING },
  });
  if (pending === 0) return 0;

  // Never fake-complete bank transfers. Real SPEI-out lands in a later phase.
  logger.info('payouts pending manual settlement', {
    correlationId,
    job: 'process-pending-payouts',
    pending,
    reason: config.autoPayout
      ? 'WORKER_AUTO_PAYOUT ignored until bank rail exists'
      : 'manual settlement required',
  });
  return pending;
}

async function postInternalJson(
  path: string,
  correlationId: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${config.apiInternalUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: correlationHeaders(correlationId, config.internalApiSecret, `${correlationId}:${path}`),
      signal: AbortSignal.timeout(config.internalRequestTimeoutMs),
    });
  } catch (err) {
    throw new TransientError(
      err instanceof Error ? err.message : 'internal API unreachable',
      'API_UNREACHABLE',
    );
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { rawLength: text.length };
    }
  }

  if (!res.ok) {
    const kind = classifyHttpStatus(res.status);
    const message = `internal API ${path} returned ${res.status}`;
    if (kind === 'permanent') {
      throw new PermanentError(message, `HTTP_${res.status}`);
    }
    throw new TransientError(message, `HTTP_${res.status}`);
  }

  return { status: res.status, body };
}

export async function reconcileBanorteSpei(correlationId: string): Promise<void> {
  const { body } = await postInternalJson('/payments/reconcile/spei', correlationId);
  if (body && typeof body === 'object') {
    const data = body as { checked?: unknown; completed?: unknown };
    const checked = typeof data.checked === 'number' ? data.checked : 0;
    const completed = typeof data.completed === 'number' ? data.completed : 0;
    if (completed > 0 || checked > 0) {
      logger.info('banorte spei reconcile', {
        correlationId,
        job: 'reconcile-banorte-spei',
        checked,
        completed,
      });
    }
  }
}

export async function runScheduleTick(correlationId: string): Promise<void> {
  const { body } = await postInternalJson('/events/schedule/tick', correlationId);
  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>;
    const changed = Object.entries(data)
      .filter(([key, value]) => key !== 'at' && typeof value === 'number' && value > 0)
      .map(([key, value]) => `${key}=${value as number}`);
    if (changed.length) {
      logger.info('schedule tick applied', {
        correlationId,
        job: 'schedule-tick',
        reason: changed.join(' '),
      });
    }
  }
}
