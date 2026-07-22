import 'dotenv/config';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from project root for development (from apps/worker/src, go up 3 levels to root)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma, HoldStatus, TicketStatus, PayoutStatus } from '@boletera/database';

const INTERVAL_MS = 30_000;
const AUTO_PAYOUT = process.env.WORKER_AUTO_PAYOUT === 'true';

async function releaseExpiredHolds() {
  const expired = await prisma.seatHold.findMany({
    where: { status: HoldStatus.ACTIVE, expiresAt: { lt: new Date() } },
  });
  for (const hold of expired) {
    await prisma.seatHold.update({
      where: { id: hold.id },
      data: { status: HoldStatus.EXPIRED, releasedAt: new Date() },
    });
    if (hold.seatId) {
      await prisma.ticket.updateMany({
        where: { eventId: hold.eventId, seatId: hold.seatId, status: TicketStatus.HELD },
        data: { status: TicketStatus.AVAILABLE },
      });
    }
  }
  if (expired.length) console.log(`Released ${expired.length} expired holds`);
}

async function processPendingPayouts() {
  const pending = await prisma.promoterPayout.findMany({
    where: { status: PayoutStatus.PENDING },
    take: 20,
  });
  if (!pending.length) return;

  // Never fake-complete bank transfers. Real SPEI-out lands in a later phase.
  console.log(
    `Payouts pending (manual settlement required): ${pending.length}` +
      (AUTO_PAYOUT
        ? ' — WORKER_AUTO_PAYOUT ignored until bank rail exists'
        : ''),
  );
}

async function reconcileBanorteSpei() {
  const api = process.env.API_INTERNAL_URL || 'http://localhost:4000/api/v1';
  const secret = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET;
  try {
    const res = await fetch(`${api}/payments/reconcile/spei`, {
      method: 'POST',
      headers: secret ? { 'X-Internal-Secret': secret } : {},
    });
    if (res.ok) {
      const data = (await res.json()) as { checked?: number; completed?: number };
      if (data.completed) console.log(`Banorte SPEI: completed ${data.completed}/${data.checked}`);
    }
  } catch {
    /* API offline */
  }
}

console.log(`Boletera worker started (auto-payout=${AUTO_PAYOUT})`);
void releaseExpiredHolds();

setInterval(() => {
  void releaseExpiredHolds();
  void processPendingPayouts();
  void reconcileBanorteSpei();
}, INTERVAL_MS);
