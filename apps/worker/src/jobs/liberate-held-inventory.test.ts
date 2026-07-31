import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TicketStatus } from '@boletera/database';
import {
  liberateHeldInventory,
  type LiberateHoldRef,
  type LiberateTicketClient,
} from './liberate-held-inventory';

type FakeTicket = {
  id: string;
  eventId: string;
  offerId: string;
  seatId: string | null;
  status: typeof TicketStatus.HELD | typeof TicketStatus.AVAILABLE;
  updatedAt: Date;
};

function createFakeTx(tickets: FakeTicket[]): LiberateTicketClient {
  return {
    ticket: {
      async updateMany(args) {
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
      async findMany(args) {
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
      {
        id: 't2',
        eventId: 'evt',
        offerId: 'off',
        seatId: 'seat-b',
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:01:00Z'),
      },
    ];
    const hold: LiberateHoldRef = {
      eventId: 'evt',
      seatId: 'seat-a',
      offerId: 'off',
      quantity: 1,
    };

    const freed = await liberateHeldInventory(createFakeTx(tickets), hold);
    assert.equal(freed, 1);
    assert.equal(tickets[0]?.status, TicketStatus.AVAILABLE);
    assert.equal(tickets[1]?.status, TicketStatus.HELD);
  });

  it('frees GA inventory without seatId (FIFO by updatedAt)', async () => {
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
        id: 'ga-other-offer',
        eventId: 'evt',
        offerId: 'other',
        seatId: null,
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
    assert.equal(freed, 1);
    assert.equal(tickets[0]?.status, TicketStatus.AVAILABLE);
    assert.equal(tickets[1]?.status, TicketStatus.HELD);
    assert.equal(tickets[2]?.status, TicketStatus.HELD);
  });

  it('frees quantity GA tickets for a multi-qty hold', async () => {
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
      {
        id: 'ga-3',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: null,
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:02:00Z'),
      },
    ];
    const hold: LiberateHoldRef = {
      eventId: 'evt',
      seatId: null,
      offerId: 'ga-off',
      quantity: 2,
    };

    const freed = await liberateHeldInventory(createFakeTx(tickets), hold);
    assert.equal(freed, 2);
    assert.equal(tickets[0]?.status, TicketStatus.AVAILABLE);
    assert.equal(tickets[1]?.status, TicketStatus.AVAILABLE);
    assert.equal(tickets[2]?.status, TicketStatus.HELD);
  });

  it('no-ops when GA hold has no offerId', async () => {
    const tickets: FakeTicket[] = [
      {
        id: 'ga-1',
        eventId: 'evt',
        offerId: 'ga-off',
        seatId: null,
        status: TicketStatus.HELD,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const freed = await liberateHeldInventory(createFakeTx(tickets), {
      eventId: 'evt',
      seatId: null,
      offerId: null,
      quantity: 1,
    });
    assert.equal(freed, 0);
    assert.equal(tickets[0]?.status, TicketStatus.HELD);
  });
});
