import { TicketStatus } from '@prisma/client';
import { liberateHeldInventory, type LiberateHoldRef } from './liberate-held-inventory';

type FakeTicket = {
  id: string;
  eventId: string;
  offerId: string;
  seatId: string | null;
  status: typeof TicketStatus.HELD | typeof TicketStatus.AVAILABLE;
  updatedAt: Date;
};

function createFakeTx(tickets: FakeTicket[]) {
  return {
    ticket: {
      async updateMany(args: {
        where:
          | { eventId: string; seatId: string; status: typeof TicketStatus.HELD }
          | { id: string; status: typeof TicketStatus.HELD };
        data: { status: typeof TicketStatus.AVAILABLE };
      }) {
        const where = args.where;
        let count = 0;
        for (const ticket of tickets) {
          if ('id' in where) {
            if (ticket.id === where.id && ticket.status === where.status) {
              ticket.status = args.data.status;
              count += 1;
            }
            continue;
          }
          if (
            ticket.eventId === where.eventId &&
            ticket.seatId === where.seatId &&
            ticket.status === where.status
          ) {
            ticket.status = args.data.status;
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          eventId: string;
          offerId: string;
          status: typeof TicketStatus.HELD;
          seatId: null;
        };
        select: { id: true };
        orderBy: { updatedAt: 'asc' };
        take: number;
      }) {
        return tickets
          .filter(
            (ticket) =>
              ticket.eventId === args.where.eventId &&
              ticket.offerId === args.where.offerId &&
              ticket.status === args.where.status &&
              ticket.seatId === args.where.seatId,
          )
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
          .slice(0, args.take)
          .map((ticket) => ({ id: ticket.id }));
      },
    },
  };
}

describe('liberateHeldInventory', () => {
  it('frees reserved seating by seatId', async () => {
    const tickets: FakeTicket[] = [
      {
        id: 't1',
        eventId: 'evt',
        offerId: 'off',
        seatId: 'seat-a',
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const hold: LiberateHoldRef = {
      eventId: 'evt',
      seatId: 'seat-a',
      offerId: 'off',
      quantity: 1,
    };

    const freed = await liberateHeldInventory(createFakeTx(tickets), hold);
    expect(freed).toBe(1);
    expect(tickets[0]?.status).toBe(TicketStatus.AVAILABLE);
  });

  it('frees GA seatless tickets for offerId (does not skip GA)', async () => {
    const tickets: FakeTicket[] = [
      {
        id: 'ga-old',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: null,
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'ga-new',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: null,
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:05:00Z'),
      },
      {
        id: 'seated',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: 'seat-1',
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const hold: LiberateHoldRef = {
      eventId: 'evt',
      seatId: null,
      offerId: 'ga-off',
      quantity: 1,
    };

    const freed = await liberateHeldInventory(createFakeTx(tickets), hold);
    expect(freed).toBe(1);
    expect(tickets[0]?.status).toBe(TicketStatus.AVAILABLE);
    expect(tickets[1]?.status).toBe(TicketStatus.HELD);
    expect(tickets[2]?.status).toBe(TicketStatus.HELD);
  });

  it('frees quantity GA tickets', async () => {
    const tickets: FakeTicket[] = [
      {
        id: 'ga-1',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: null,
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'ga-2',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: null,
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:01:00Z'),
      },
    ];

    const freed = await liberateHeldInventory(createFakeTx(tickets), {
      eventId: 'evt',
      seatId: null,
      offerId: 'ga-off',
      quantity: 2,
    });
    expect(freed).toBe(2);
    expect(tickets.every((t) => t.status === TicketStatus.AVAILABLE)).toBe(true);
  });
});
