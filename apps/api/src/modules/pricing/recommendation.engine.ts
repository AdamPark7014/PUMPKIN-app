import {
  applyGuardrails,
  requiresHumanApproval,
  roundMoneyPublic,
} from './guardrails';
import {
  DEFAULT_AUTO_APPLY_MAX_DELTA,
  type EventRecommendationBundle,
  type EventSignals,
  type FactorExplanation,
  type OfferRecommendation,
  type OfferSignals,
  type RecommendationConfidence,
  type RecommendationDirection,
  type SurgeTier,
  type TimeBasedRule,
} from './pricing.types';

const DAY_MS = 86_400_000;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function occupancyOf(offer: OfferSignals): number {
  const total = Math.max(offer.totalQuantity, 1);
  return offer.soldQuantity / total;
}

function defaultSurgeMultiplier(
  occupancy: number,
  surgeThreshold: number,
  surgePriceMultiplier: number,
  tiers?: SurgeTier[],
): { multiplier: number; detail: string; threshold: number } {
  if (tiers?.length) {
    const sorted = [...tiers].sort((a, b) => b.occupancy - a.occupancy);
    for (const tier of sorted) {
      if (occupancy >= tier.occupancy) {
        return {
          multiplier: tier.multiplier,
          detail: `Regla de ocupación ≥ ${(tier.occupancy * 100).toFixed(0)}% → ×${tier.multiplier}`,
          threshold: tier.occupancy,
        };
      }
    }
    return { multiplier: 1, detail: 'Sin surge por ocupación', threshold: 0 };
  }

  if (occupancy >= 0.9) {
    return {
      multiplier: 1.5,
      detail: 'Demanda extrema (ocupación ≥ 90%)',
      threshold: 0.9,
    };
  }
  if (occupancy >= 0.8) {
    return {
      multiplier: 1.3,
      detail: 'Demanda alta (ocupación ≥ 80%)',
      threshold: 0.8,
    };
  }
  if (occupancy >= surgeThreshold) {
    return {
      multiplier: surgePriceMultiplier,
      detail: `Umbral de surge del evento (≥ ${(surgeThreshold * 100).toFixed(0)}%)`,
      threshold: surgeThreshold,
    };
  }
  if (occupancy >= 0.7) {
    return {
      multiplier: 1.15,
      detail: 'Demanda moderada (ocupación ≥ 70%)',
      threshold: 0.7,
    };
  }
  return { multiplier: 1, detail: 'Sin surge por ocupación', threshold: surgeThreshold };
}

function paceMultiplier(paceDelta: number): {
  multiplier: number;
  detail: string;
  threshold: number;
} {
  if (paceDelta >= 0.2) {
    return {
      multiplier: 1.12,
      detail: 'Ritmo de venta muy por encima de lo esperado',
      threshold: 0.2,
    };
  }
  if (paceDelta >= 0.1) {
    return {
      multiplier: 1.06,
      detail: 'Ritmo de venta por encima de lo esperado',
      threshold: 0.1,
    };
  }
  if (paceDelta <= -0.35) {
    return {
      multiplier: 0.85,
      detail: 'Ritmo de venta crítico (muy por debajo)',
      threshold: -0.35,
    };
  }
  if (paceDelta <= -0.2) {
    return {
      multiplier: 0.92,
      detail: 'Ritmo de venta en riesgo',
      threshold: -0.2,
    };
  }
  if (paceDelta <= -0.1) {
    return {
      multiplier: 0.96,
      detail: 'Ritmo de venta ligeramente bajo',
      threshold: -0.1,
    };
  }
  return {
    multiplier: 1,
    detail: 'Ritmo de venta en línea con lo esperado',
    threshold: 0,
  };
}

function timeMultiplier(
  daysUntil: number,
  occupancy: number,
  rules?: TimeBasedRule[],
): { multiplier: number; detail: string; threshold: number } {
  if (rules?.length) {
    const sorted = [...rules].sort((a, b) => a.daysUntilEvent - b.daysUntilEvent);
    for (const rule of sorted) {
      if (daysUntil <= rule.daysUntilEvent) {
        return {
          multiplier: rule.multiplier,
          detail: `Regla temporal ≤ ${rule.daysUntilEvent} días → ×${rule.multiplier}`,
          threshold: rule.daysUntilEvent,
        };
      }
    }
  }

  if (daysUntil < 0) {
    return { multiplier: 1, detail: 'Evento ya iniciado o pasado', threshold: 0 };
  }
  if (daysUntil <= 1 && occupancy >= 0.5) {
    return {
      multiplier: 1.15,
      detail: 'Último día con ocupación ≥ 50%',
      threshold: 1,
    };
  }
  if (daysUntil <= 3 && occupancy >= 0.6) {
    return {
      multiplier: 1.08,
      detail: 'Últimos 3 días con ocupación ≥ 60%',
      threshold: 3,
    };
  }
  if (daysUntil <= 7 && occupancy < 0.3) {
    return {
      multiplier: 0.9,
      detail: 'Menos de 7 días y ocupación baja (< 30%)',
      threshold: 7,
    };
  }
  if (daysUntil <= 14 && occupancy < 0.2) {
    return {
      multiplier: 0.85,
      detail: 'Menos de 14 días y ocupación muy baja (< 20%)',
      threshold: 14,
    };
  }
  if (daysUntil > 90) {
    return {
      multiplier: 0.95,
      detail: 'Venta temprana (> 90 días)',
      threshold: 90,
    };
  }
  return { multiplier: 1, detail: 'Sin ajuste temporal', threshold: daysUntil };
}

function inventoryMultiplier(
  offer: OfferSignals,
  daysUntil: number,
): { multiplier: number; detail: string; metricValue: number; threshold?: number } {
  const total = Math.max(offer.totalQuantity, 1);
  const remainingRatio = offer.remainingQuantity / total;
  const holdRatio = offer.holdQuantity / total;

  if (remainingRatio <= 0.1) {
    return {
      multiplier: 1.2,
      detail: 'Inventario crítico (≤ 10% restante)',
      metricValue: remainingRatio,
      threshold: 0.1,
    };
  }
  if (remainingRatio <= 0.2) {
    return {
      multiplier: 1.1,
      detail: 'Inventario bajo (≤ 20% restante)',
      metricValue: remainingRatio,
      threshold: 0.2,
    };
  }
  if (remainingRatio >= 0.7 && daysUntil <= 14) {
    return {
      multiplier: 0.88,
      detail: 'Exceso de inventario cerca del evento (≥ 70% restante, ≤ 14 días)',
      metricValue: remainingRatio,
      threshold: 0.7,
    };
  }
  if (remainingRatio >= 0.5 && daysUntil <= 7) {
    return {
      multiplier: 0.85,
      detail: 'Inventario holgado a 7 días (≥ 50% restante)',
      metricValue: remainingRatio,
      threshold: 0.5,
    };
  }
  if (holdRatio >= 0.3) {
    return {
      multiplier: 1.03,
      detail: 'Holds elevados (≥ 30% del cupo) como señal de demanda',
      metricValue: holdRatio,
      threshold: 0.3,
    };
  }
  return {
    multiplier: 1,
    detail: 'Inventario en rango normal',
    metricValue: remainingRatio,
  };
}

function directionOf(current: number, recommended: number): RecommendationDirection {
  const eps = Math.max(0.01, current * 0.005);
  if (recommended > current + eps) return 'increase';
  if (recommended < current - eps) return 'decrease';
  return 'hold';
}

function confidenceOf(
  factors: FactorExplanation[],
  paceDelta: number,
  occupancy: number,
): RecommendationConfidence {
  const strong = factors.filter((f) => Math.abs(f.contribution - 1) >= 0.08).length;
  if (strong >= 2 || Math.abs(paceDelta) >= 0.2 || occupancy >= 0.8) return 'high';
  if (strong >= 1 || Math.abs(paceDelta) >= 0.1) return 'medium';
  return 'low';
}

function buildExplanation(
  rec: Pick<
    OfferRecommendation,
    'direction' | 'currentPrice' | 'recommendedPrice' | 'deltaPercent' | 'factors' | 'guardrail'
  >,
): string {
  const verb =
    rec.direction === 'increase'
      ? 'subir'
      : rec.direction === 'decrease'
        ? 'bajar'
        : 'mantener';
  const main = rec.factors
    .filter((f) => f.contribution !== 1)
    .map((f) => f.detail)
    .slice(0, 3);
  const clampNote = rec.guardrail.clamped
    ? ` Precio acotado a banda ${rec.guardrail.bandLabel}.`
    : '';
  const drivers = main.length ? ` Factores: ${main.join('; ')}.` : '';
  return `Se recomienda ${verb} de ${rec.currentPrice.toFixed(2)} a ${rec.recommendedPrice.toFixed(2)} (${(rec.deltaPercent * 100).toFixed(1)}%).${drivers}${clampNote}`;
}

/**
 * Deterministic, explainable recommendation for a single offer.
 * Pure function — safe to unit-test without I/O.
 */
export function recommendOffer(
  event: EventSignals,
  offer: OfferSignals,
  eventPace: { expectedPace: number; actualPace: number; paceDelta: number; daysUntil: number },
): OfferRecommendation {
  const occupancy = occupancyOf(offer);
  const rules = event.pricingRules;
  const factors: FactorExplanation[] = [];

  let multiplier = 1;

  if (event.enableDynamic || rules?.dynamicPricingEnabled) {
    const surge = defaultSurgeMultiplier(
      occupancy,
      event.surgeThreshold,
      event.surgePriceMultiplier,
      rules?.surgeTiers,
    );
    factors.push({
      code: 'occupancy',
      contribution: surge.multiplier,
      detail: surge.detail,
      metricValue: round4(occupancy),
      threshold: surge.threshold,
    });
    multiplier *= surge.multiplier;
  } else {
    factors.push({
      code: 'occupancy',
      contribution: 1,
      detail: 'Pricing dinámico desactivado — ocupación solo informativa',
      metricValue: round4(occupancy),
    });
  }

  const pace = paceMultiplier(eventPace.paceDelta);
  factors.push({
    code: 'sales_pace',
    contribution: pace.multiplier,
    detail: pace.detail,
    metricValue: round4(eventPace.paceDelta),
    threshold: pace.threshold,
  });
  multiplier *= pace.multiplier;

  const time = timeMultiplier(eventPace.daysUntil, occupancy, rules?.timeBasedRules);
  factors.push({
    code: 'time',
    contribution: time.multiplier,
    detail: time.detail,
    metricValue: round4(eventPace.daysUntil),
    threshold: time.threshold,
  });
  multiplier *= time.multiplier;

  const inv = inventoryMultiplier(offer, eventPace.daysUntil);
  factors.push({
    code: 'inventory',
    contribution: inv.multiplier,
    detail: inv.detail,
    metricValue: round4(inv.metricValue),
    threshold: inv.threshold,
  });
  multiplier *= inv.multiplier;

  const rawPrice = roundMoneyPublic(offer.basePrice * multiplier);
  const guardrail = applyGuardrails(event, offer, rawPrice);
  const finalPrice = roundMoneyPublic(
    Math.min(guardrail.ceiling, Math.max(guardrail.floor, rawPrice)),
  );

  factors.push({
    code: 'price_band',
    contribution: 1,
    detail: guardrail.clamped
      ? `Acotado a banda ${guardrail.bandLabel} (candidato ${rawPrice.toFixed(2)})`
      : `Dentro de banda ${guardrail.bandLabel}`,
    metricValue: finalPrice,
    threshold: guardrail.floor,
  });

  const recommendedMultiplier = round4(finalPrice / Math.max(offer.basePrice, 0.01));
  const deltaPercent = round4(
    (finalPrice - offer.currentPrice) / Math.max(offer.currentPrice, 0.01),
  );
  const direction = directionOf(offer.currentPrice, finalPrice);
  const autoMax = rules?.autoApplyMaxDelta ?? DEFAULT_AUTO_APPLY_MAX_DELTA;
  const needsApproval =
    direction !== 'hold' &&
    requiresHumanApproval(offer.currentPrice, finalPrice, autoMax);
  const autoApplicable =
    direction !== 'hold' &&
    !needsApproval &&
    (event.enableDynamic || Boolean(rules?.dynamicPricingEnabled));

  const draft: OfferRecommendation = {
    offerId: offer.offerId,
    zone: offer.zone,
    name: offer.name,
    basePrice: offer.basePrice,
    currentPrice: offer.currentPrice,
    recommendedPrice: finalPrice,
    recommendedMultiplier,
    direction,
    deltaPercent,
    factors,
    guardrail: { ...guardrail, preClampPrice: rawPrice },
    requiresApproval: needsApproval,
    autoApplicable,
    explanation: '',
    confidence: confidenceOf(factors, eventPace.paceDelta, occupancy),
  };
  draft.explanation = buildExplanation(draft);
  return draft;
}

export function computeEventPace(event: EventSignals): {
  expectedPace: number;
  actualPace: number;
  paceDelta: number;
  daysUntil: number;
  soldTickets: number;
  occupancyPercent: number;
} {
  const now = event.now ?? new Date();
  const saleStart = event.salesStartAt ?? event.createdAt;
  const saleWindowMs = Math.max(1, event.startsAt.getTime() - saleStart.getTime());
  const elapsedMs = Math.min(
    saleWindowMs,
    Math.max(0, now.getTime() - saleStart.getTime()),
  );
  const expectedPace = elapsedMs / saleWindowMs;
  const daysUntil = (event.startsAt.getTime() - now.getTime()) / DAY_MS;
  return {
    expectedPace: round4(expectedPace),
    actualPace: 0,
    paceDelta: 0,
    daysUntil: round4(daysUntil),
    soldTickets: 0,
    occupancyPercent: 0,
  };
}

/**
 * Build recommendations for all offers of an event.
 * Event-level pace uses aggregate sold vs capacity (caller supplies sold totals via offers).
 */
export function recommendForEvent(
  event: EventSignals,
  offers: OfferSignals[],
): EventRecommendationBundle {
  const basePace = computeEventPace(event);
  const soldTickets = offers.reduce((s, o) => s + o.soldQuantity, 0);
  const offerCapacity = offers.reduce((sum, offer) => sum + offer.totalQuantity, 0);
  const capacity = Math.max(offerCapacity || event.totalCapacity, 1);
  const actualPace = soldTickets / capacity;
  const paceDelta = actualPace - basePace.expectedPace;
  const aggregatePace = {
    expectedPace: basePace.expectedPace,
    actualPace: round4(actualPace),
    paceDelta: round4(paceDelta),
    daysUntil: basePace.daysUntil,
  };

  const zoneTotals = new Map<string, { sold: number; capacity: number }>();
  for (const offer of offers) {
    const current = zoneTotals.get(offer.zone) ?? { sold: 0, capacity: 0 };
    current.sold += offer.soldQuantity;
    current.capacity += offer.totalQuantity;
    zoneTotals.set(offer.zone, current);
  }

  const recommendations = offers.map((offer) => {
    const zone = zoneTotals.get(offer.zone);
    const zoneActualPace = zone
      ? zone.sold / Math.max(zone.capacity, 1)
      : aggregatePace.actualPace;
    return recommendOffer(event, offer, {
      expectedPace: aggregatePace.expectedPace,
      actualPace: round4(zoneActualPace),
      paceDelta: round4(zoneActualPace - aggregatePace.expectedPace),
      daysUntil: aggregatePace.daysUntil,
    });
  });

  const increases = recommendations.filter((r) => r.direction === 'increase').length;
  const decreases = recommendations.filter((r) => r.direction === 'decrease').length;
  const pending = recommendations.filter((r) => r.requiresApproval).length;

  const summary = [
    `${recommendations.length} ofertas evaluadas`,
    `${increases} alzas`,
    `${decreases} bajas`,
    `${pending} requieren aprobación`,
    `ritmo Δ=${(paceDelta * 100).toFixed(1)} pp`,
  ].join('; ');

  return {
    eventId: event.eventId,
    organizationId: event.organizationId,
    title: event.title,
    generatedAt: (event.now ?? new Date()).toISOString(),
    enableDynamic: event.enableDynamic,
    signals: {
      daysUntilEvent: round4(aggregatePace.daysUntil),
      expectedPace: aggregatePace.expectedPace,
      actualPace: aggregatePace.actualPace,
      paceDelta: aggregatePace.paceDelta,
      occupancyPercent: round4((soldTickets / capacity) * 100),
      soldTickets,
      totalCapacity: capacity,
    },
    recommendations,
    summary,
  };
}

/** Segment multipliers used by checkout pricing (deterministic). */
export const SEGMENT_MULTIPLIERS: Record<string, number> = {
  EARLY_BIRD: 0.85,
  EARLY_BUYER: 0.85,
  REGULAR: 1,
  VVIP: 1.25,
};

export function calculateTimeMultiplierLegacy(daysUntilEvent: number): number {
  if (daysUntilEvent < 0) return 1;
  if (daysUntilEvent <= 1) return 1.4;
  if (daysUntilEvent <= 3) return 1.25;
  if (daysUntilEvent <= 7) return 1.1;
  if (daysUntilEvent <= 30) return 1.05;
  if (daysUntilEvent <= 90) return 0.95;
  return 0.9;
}

export function calculateSurgePricingLegacy(occupancyRate: number): {
  multiplier: number;
  reason: string;
} {
  if (occupancyRate >= 0.9) {
    return { multiplier: 1.5, reason: 'Extreme demand (90%+ sold)' };
  }
  if (occupancyRate >= 0.8) {
    return { multiplier: 1.3, reason: 'High demand (80-90% sold)' };
  }
  if (occupancyRate >= 0.7) {
    return { multiplier: 1.15, reason: 'Moderate demand (70-80% sold)' };
  }
  return { multiplier: 1, reason: 'No surge' };
}
