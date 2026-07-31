const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  loginSchema,
  createOrderSchema,
  createHoldSchema,
  createEventSchema,
  createPaymentIntentSchema,
  venueLayoutSchema,
  majorMoneySchema,
  parseInput,
  formatZodIssues,
  recurrenceRuleSchema,
} = require('../dist/index.js');

describe('auth', () => {
  it('rejects short passwords with Spanish message', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'short' });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(formatZodIssues(result.error).join(' '), /contraseña/i);
    }
  });

  it('normalizes email to lowercase', () => {
    const parsed = loginSchema.parse({ email: 'User@TicketOS.mx', password: 'secreto123' });
    assert.equal(parsed.email, 'user@ticketos.mx');
  });
});

describe('orders / holds', () => {
  it('requires holdIds or items', () => {
    const bad = createOrderSchema.safeParse({
      eventId: 'evt_1',
      buyerName: 'Ana',
      buyerEmail: 'ana@example.com',
    });
    assert.equal(bad.success, false);

    const ok = createOrderSchema.parse({
      eventId: 'evt_1',
      holdIds: ['hold_1'],
      buyerName: 'Ana Pérez',
      buyerEmail: 'ana@example.com',
      paymentMethod: 'SPEI',
    });
    assert.equal(ok.paymentMethod, 'SPEI');
  });

  it('requires seats or offer on holds', () => {
    const bad = createHoldSchema.safeParse({ eventId: 'evt_1', quantity: 2 });
    assert.equal(bad.success, false);
    const ok = createHoldSchema.parse({ eventId: 'evt_1', seatIds: ['s1', 's2'] });
    assert.equal(ok.seatIds.length, 2);
  });
});

describe('events / recurrence', () => {
  it('accepts a Mexico City weekly rule', () => {
    const rule = recurrenceRuleSchema.parse({
      frequency: 'WEEKLY',
      startLocal: '2025-07-15T20:00',
      timezone: 'America/Mexico_City',
      byWeekday: [2, 4],
      count: 8,
    });
    assert.equal(rule.timezone, 'America/Mexico_City');
  });

  it('creates an event with minor-unit price', () => {
    const event = createEventSchema.parse({
      title: 'Noche de Jazz',
      description: 'Concierto en CDMX',
      type: 'CONCERT',
      startDate: '2025-08-01T02:00:00.000Z',
      venueId: 'ven_1',
      capacity: 500,
      basePrice: 499.99,
      timezone: 'America/Mexico_City',
    });
    assert.equal(event.basePriceMinor, 49999);
    assert.equal(event.currency, 'MXN');
  });
});

describe('payments / money', () => {
  it('converts payment amount to minor units', () => {
    const ok = createPaymentIntentSchema.parse({
      orderId: 'ord_1',
      amount: 499.99,
      buyerEmail: 'ana@example.com',
      buyerName: 'Ana',
      paymentMethod: 'CARD',
    });
    assert.equal(ok.amountMinor, 49999);
    assert.equal(ok.currency, 'MXN');
  });

  it('converts major money without float loss', () => {
    const money = majorMoneySchema.parse({ amount: 19.99, currency: 'MXN' });
    assert.equal(money.amountMinor, 1999);
  });
});

describe('venue', () => {
  it('validates seat map color and seats', () => {
    const ok = venueLayoutSchema.parse({
      name: 'Platea',
      mapData: {
        sections: [
          {
            id: 'sec_1',
            name: 'VIP',
            slug: 'vip',
            color: '#ff8800',
            seats: [{ id: 's1', label: 'A1', x: 1, y: 2 }],
          },
        ],
      },
    });
    assert.equal(ok.mapData.sections[0].seats.length, 1);
  });
});

describe('parseInput', () => {
  it('returns typed success or ZodError', () => {
    const ok = parseInput(loginSchema, { email: 'a@b.com', password: '12345678' });
    assert.equal(ok.success, true);
    const fail = parseInput(loginSchema, { email: 'nope' });
    assert.equal(fail.success, false);
  });
});
