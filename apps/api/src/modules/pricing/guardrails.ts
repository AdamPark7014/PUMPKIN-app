import {
  DEFAULT_CEILING_MULTIPLIER,
  DEFAULT_FLOOR_MULTIPLIER,
  type EventSignals,
  type GuardrailResult,
  type OfferSignals,
  type PricingRulesConfig,
} from './pricing.types';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolve absolute floor/ceiling for an offer from event bands + rule multipliers.
 * Deterministic; no side effects.
 */
export function resolvePriceBand(
  event: Pick<EventSignals, 'minPrice' | 'maxPrice' | 'pricingRules'>,
  offer: Pick<OfferSignals, 'basePrice' | 'zone'>,
): { floor: number; ceiling: number; bandLabel: string } {
  const rules: PricingRulesConfig = event.pricingRules ?? {};
  const floorMul = positiveOr(rules.floorMultiplier, DEFAULT_FLOOR_MULTIPLIER);
  const ceilMul = Math.max(
    floorMul,
    positiveOr(rules.ceilingMultiplier, DEFAULT_CEILING_MULTIPLIER),
  );

  const zoneOverride = rules.customZonePricing?.[offer.zone];
  const anchor = positiveOr(zoneOverride, positiveOr(offer.basePrice, 0.01));

  const ruleFloor = roundMoney(anchor * floorMul);
  const ruleCeiling = roundMoney(anchor * ceilMul);

  const eventFloor =
    Number.isFinite(event.minPrice) && event.minPrice >= 0 ? event.minPrice : 0;
  const eventCeiling =
    Number.isFinite(event.maxPrice) && event.maxPrice > 0
      ? event.maxPrice
      : ruleCeiling;
  const floor = roundMoney(Math.max(eventFloor, ruleFloor, 0.01));
  const ceiling = roundMoney(
    Math.max(floor, Math.min(eventCeiling, ruleCeiling)),
  );

  return {
    floor,
    ceiling,
    bandLabel: `${floor.toFixed(2)}–${ceiling.toFixed(2)}`,
  };
}

/**
 * Clamp a candidate price into the allowed band.
 */
export function applyGuardrails(
  event: Pick<EventSignals, 'minPrice' | 'maxPrice' | 'pricingRules'>,
  offer: Pick<OfferSignals, 'basePrice' | 'zone'>,
  candidatePrice: number,
): GuardrailResult {
  const { floor, ceiling, bandLabel } = resolvePriceBand(event, offer);
  const preClampPrice = roundMoney(Math.max(0.01, candidatePrice));
  const clampedPrice = roundMoney(Math.min(ceiling, Math.max(floor, preClampPrice)));
  return {
    floor,
    ceiling,
    clamped: clampedPrice !== preClampPrice,
    preClampPrice,
    bandLabel,
  };
}

/**
 * Human approval when the move exceeds auto-apply delta or is a meaningful cut.
 */
export function requiresHumanApproval(
  currentPrice: number,
  recommendedPrice: number,
  autoApplyMaxDelta = 0.1,
): boolean {
  const base = Math.max(currentPrice, 0.01);
  const delta = Math.abs(recommendedPrice - currentPrice) / base;
  const safeAutoDelta =
    Number.isFinite(autoApplyMaxDelta) && autoApplyMaxDelta >= 0
      ? Math.min(autoApplyMaxDelta, 0.25)
      : 0.1;
  if (delta > safeAutoDelta) return true;
  // Price cuts ≥ 5% always need a human (revenue risk).
  if (recommendedPrice < currentPrice * 0.95) return true;
  return false;
}

export function roundMoneyPublic(n: number): number {
  return roundMoney(n);
}

