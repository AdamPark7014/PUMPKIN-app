import {
  applyGuardrails,
  requiresHumanApproval,
  resolvePriceBand,
} from './guardrails';
import {
  recommendForEvent,
  recommendOffer,
} from './recommendation.engine';
import {
  encodePendingReason,
  isPendingReason,
  parsePendingReason,
} from './pending-reason';
import type { EventSignals, OfferSignals } from './pricing.types';

function baseEvent(overrides: Partial<EventSignals> = {}): EventSignals {
  const now = new Date('2026-06-01T12:00:00.000Z');
  return {
    eventId: 'evt_1',
    organizationId: 'org_1',
    title: 'Test Concert',
    startsAt: new Date('2026-06-15T20:00:00.000Z'),
    salesStartAt: new Date('2026-05-01T00:00:00.000Z'),
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    enableDynamic: true,
    minPrice: 100,
    maxPrice: 2000,
    surgeThreshold: 0.8,
    surgePriceMultiplier: 1.25,
    totalCapacity: 1000,
    currency: 'MXN',
    now,
    ...overrides,
  };
}

function baseOffer(overrides: Partial<OfferSignals> = {}): OfferSignals {
  return {
    offerId: 'off_1',
    name: 'General',
    zone: 'GA',
    basePrice: 500,
    totalQuantity: 500,
    soldQuantity: 100,
    remainingQuantity: 400,
    holdQuantity: 0,
    currentPrice: 500,
    ...overrides,
  };
}

describe('resolvePriceBand / applyGuardrails', () => {
  it('clamps below floor and above ceiling', () => {
    const event = baseEvent({ minPrice: 200, maxPrice: 800 });
    const offer = baseOffer({ basePrice: 500 });
    const band = resolvePriceBand(event, offer);
    expect(band.floor).toBeGreaterThanOrEqual(200);
    expect(band.ceiling).toBeLessThanOrEqual(800);

    const low = applyGuardrails(event, offer, 50);
    expect(low.clamped).toBe(true);
    expect(low.preClampPrice).toBe(50);

    const high = applyGuardrails(event, offer, 5000);
    expect(high.clamped).toBe(true);
    expect(high.preClampPrice).toBe(5000);
  });

  it('requires approval for large deltas and cuts', () => {
    expect(requiresHumanApproval(500, 520, 0.1)).toBe(false);
    expect(requiresHumanApproval(500, 600, 0.1)).toBe(true);
    expect(requiresHumanApproval(500, 450, 0.1)).toBe(true);
  });

  it('caps unsafe autoApplyMaxDelta values', () => {
    expect(requiresHumanApproval(500, 650, 0.9)).toBe(true);
    expect(requiresHumanApproval(500, 520, 0.9)).toBe(false);
  });
});

describe('recommendOffer (deterministic)', () => {
  it('raises price on high occupancy + strong pace', () => {
    const event = baseEvent({
      now: new Date('2026-05-05T12:00:00.000Z'),
      startsAt: new Date('2026-06-15T20:00:00.000Z'),
      salesStartAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    const offer = baseOffer({
      soldQuantity: 450,
      remainingQuantity: 50,
      totalQuantity: 500,
      currentPrice: 500,
    });
    const saleStart = event.salesStartAt!.getTime();
    const window = event.startsAt.getTime() - saleStart;
    const elapsed = event.now!.getTime() - saleStart;
    const expectedPace = elapsed / window;
    const actualPace = 450 / 1000;
    const paceDelta = actualPace - expectedPace;

    const rec = recommendOffer(event, offer, {
      expectedPace,
      actualPace,
      paceDelta,
      daysUntil: (event.startsAt.getTime() - event.now!.getTime()) / 86_400_000,
    });

    expect(rec.direction).toBe('increase');
    expect(rec.recommendedPrice).toBeGreaterThan(rec.currentPrice);
    expect(rec.factors.some((f) => f.code === 'occupancy')).toBe(true);
    expect(rec.factors.some((f) => f.code === 'inventory')).toBe(true);
    expect(rec.explanation.length).toBeGreaterThan(20);
    expect(rec.guardrail.floor).toBeLessThanOrEqual(rec.recommendedPrice);
    expect(rec.guardrail.ceiling).toBeGreaterThanOrEqual(rec.recommendedPrice);
  });

  it('suggests decrease when late with low occupancy', () => {
    const event = baseEvent({
      now: new Date('2026-06-12T12:00:00.000Z'),
      startsAt: new Date('2026-06-15T20:00:00.000Z'),
      salesStartAt: new Date('2026-04-01T00:00:00.000Z'),
      enableDynamic: true,
    });
    const offer = baseOffer({
      soldQuantity: 40,
      remainingQuantity: 460,
      totalQuantity: 500,
      currentPrice: 500,
    });

    const bundle = recommendForEvent(event, [offer]);
    const rec = bundle.recommendations[0];
    expect(rec.direction).toBe('decrease');
    expect(rec.requiresApproval).toBe(true);
    expect(rec.factors.some((f) => f.code === 'sales_pace')).toBe(true);
    expect(rec.factors.some((f) => f.code === 'time')).toBe(true);
  });

  it('uses zone-level sales pace for recommendations', () => {
    const event = baseEvent({
      now: new Date('2026-05-10T12:00:00.000Z'),
      startsAt: new Date('2026-06-15T20:00:00.000Z'),
      salesStartAt: new Date('2026-05-01T00:00:00.000Z'),
      totalCapacity: 1000,
    });
    const hot: OfferSignals = baseOffer({
      offerId: 'off_hot',
      zone: 'VIP',
      name: 'VIP',
      basePrice: 1000,
      currentPrice: 1000,
      totalQuantity: 100,
      soldQuantity: 90,
      remainingQuantity: 10,
    });
    const cold: OfferSignals = baseOffer({
      offerId: 'off_cold',
      zone: 'GA',
      name: 'GA',
      basePrice: 400,
      currentPrice: 400,
      totalQuantity: 900,
      soldQuantity: 20,
      remainingQuantity: 880,
    });
    const bundle = recommendForEvent(event, [hot, cold]);
    const hotRec = bundle.recommendations.find((r) => r.offerId === 'off_hot');
    const coldRec = bundle.recommendations.find((r) => r.offerId === 'off_cold');
    expect(hotRec).toBeDefined();
    expect(coldRec).toBeDefined();
    const hotPace = hotRec!.factors.find((f) => f.code === 'sales_pace');
    const coldPace = coldRec!.factors.find((f) => f.code === 'sales_pace');
    expect(hotPace?.contribution ?? 0).toBeGreaterThan(coldPace?.contribution ?? 0);
  });

  it('is deterministic for identical inputs', () => {
    const event = baseEvent();
    const offers = [
      baseOffer(),
      baseOffer({
        offerId: 'off_2',
        zone: 'VIP',
        name: 'VIP',
        basePrice: 1200,
        currentPrice: 1200,
        totalQuantity: 100,
        soldQuantity: 80,
        remainingQuantity: 20,
      }),
    ];
    const a = recommendForEvent(event, offers);
    const b = recommendForEvent(event, offers);
    expect(a).toEqual(b);
    expect(a.signals.paceDelta).toBe(b.signals.paceDelta);
  });

  it('respects custom surge tiers from pricingRules', () => {
    const event = baseEvent({
      pricingRules: {
        dynamicPricingEnabled: true,
        surgeTiers: [{ occupancy: 0.5, multiplier: 1.4 }],
        autoApplyMaxDelta: 0.5,
      },
    });
    const offer = baseOffer({
      soldQuantity: 300,
      remainingQuantity: 200,
      totalQuantity: 500,
    });
    const bundle = recommendForEvent(event, [offer]);
    const occ = bundle.recommendations[0].factors.find((f) => f.code === 'occupancy');
    expect(occ?.contribution).toBe(1.4);
  });
});

describe('pending reason codec', () => {
  it('round-trips pending payloads', () => {
    const payload = {
      v: 1 as const,
      status: 'pending' as const,
      explanation: 'test',
      factors: [
        {
          code: 'occupancy' as const,
          contribution: 1.2,
          detail: 'high',
          metricValue: 0.85,
        },
      ],
      direction: 'increase' as const,
      deltaPercent: 0.12,
      requiresApproval: true,
      guardrail: {
        floor: 100,
        ceiling: 1000,
        clamped: false,
        preClampPrice: 560,
        bandLabel: '100.00–1000.00',
      },
      basePrice: 500,
      currentPrice: 500,
    };
    const encoded = encodePendingReason(payload);
    expect(isPendingReason(encoded)).toBe(true);
    expect(parsePendingReason(encoded)).toEqual(payload);
  });
});
