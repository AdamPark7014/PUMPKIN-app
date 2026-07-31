import { TicketStatus } from '@prisma/client';

export type LiberateHoldRef = {
  eventId: string;
  seatId: string | null;
  offerId: string | null;
  quantity?: number;
};

type TicketUpdateMany = (args: {
  where:
    | {
        eventId: string;
        seatId: string;
        status: typeof TicketStatus.HELD;
      }
    | {
        id: string;
        status: typeof TicketStatus.HELD;
      };
  data: { status: typeof TicketStatus.AVAILABLE };
}) => Promise<{ count: number }>;

type TicketFindMany = (args: {
  where: {
    eventId: string;
    offerId: string;
    status: typeof TicketStatus.HELD;
    seatId: null;
  };
  select: { id: true };
  orderBy: { updatedAt: 'asc' };
  take: number;
}) => Promise<Array<{ id: string }>>;

export type LiberateTicketClient = {
  ticket: {
    updateMany: TicketUpdateMany;
    findMany: TicketFindMany;
  };
};

/**
 * Restore HELD tickets after a hold expires or is released.
 * Reserved seating: free by seatId.
 * GA: free up to `quantity` seatless tickets for the offer (FIFO by updatedAt).
 */
export async function liberateHeldInventory(
  tx: LiberateTicketClient,
  hold: LiberateHoldRef,
): Promise<number> {
  if (hold.seatId) {
    const result = await tx.ticket.updateMany({
      where: {
        eventId: hold.eventId,
        seatId: hold.seatId,
        status: TicketStatus.HELD,
      },
      data: { status: TicketStatus.AVAILABLE },
    });
    return result.count;
  }

  if (!hold.offerId) return 0;

  const qty = Math.max(1, hold.quantity ?? 1);
  const held = await tx.ticket.findMany({
    where: {
      eventId: hold.eventId,
      offerId: hold.offerId,
      status: TicketStatus.HELD,
      seatId: null,
    },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: qty,
  });

  let freed = 0;
  for (const ticket of held) {
    const result = await tx.ticket.updateMany({
      where: { id: ticket.id, status: TicketStatus.HELD },
      data: { status: TicketStatus.AVAILABLE },
    });
    freed += result.count;
  }
  return freed;
}
