import { Decimal } from '@prisma/client/runtime/library';

export type CustomerSegment = 'EARLY_BUYER' | 'REGULAR' | 'VVIP';

export type FactorCode =
  | 'sales_pace'
  | 'occupancy'
  | 'time'
  | 'inventory'
  | 'price_band'
  | 'segment'
  | 'promotion';

export type RecommendationDirection = 'increase' | 'decrease' | 'hold';
export type RecommendationConfidence = 'high' | 'medium' | 'low';
export type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'preview';

export interface PricingContext {
  eventId: string;
  offerId: string;
  quantity: number;
  timestamp?: Date;
  customerSegment?: CustomerSegment;
  promotionCode?: string;
}

export interface PricingResult {
  basePrice: Decimal;
  dynamicMultiplier: number;
  adjustedPrice: Decimal;
  discount: Decimal;
  subtotal: Decimal;
  fees: Decimal;
  taxes: Decimal;
  total: Decimal;
  breakdown: {
    reason: string;
    appliedRules: string[];
  };
}

export interface SurgeTier {
  occupancy: number;
  multiplier: number;
}

export interface TimeBasedRule {
  daysUntilEvent: number;
  multiplier: number;
}

/** Stored under `Event.metadata.pricingRules` by event-management. */
export interface PricingRulesConfig {
  basePrice?: number;
  dynamicPricingEnabled?: boolean;
  surgeTiers?: SurgeTier[];
  timeBasedRules?: TimeBasedRule[];
  segmentPricing?: Record<string, number>;
  customZonePricing?: Record<string, number>;
  /** Max |Δ| relative to current price that may auto-apply (default 0.10). */
  autoApplyMaxDelta?: number;
  /** Floor as multiplier of base (default 0.7). */
  floorMultiplier?: number;
  /** Ceiling as multiplier of base (default 2.5). */
  ceilingMultiplier?: number;
}

export interface OfferSignals {
  offerId: string;
  name: string;
  zone: string;
  basePrice: number;
  totalQuantity: number;
  soldQuantity: number;
  remainingQuantity: number;
  holdQuantity: number;
  /** Live selling price (active dynamic or base). */
  currentPrice: number;
}

export interface EventSignals {
  eventId: string;
  organizationId: string;
  title: string;
  startsAt: Date;
  salesStartAt: Date | null;
  createdAt: Date;
  enableDynamic: boolean;
  minPrice: number;
  maxPrice: number;
  surgeThreshold: number;
  surgePriceMultiplier: number;
  totalCapacity: number;
  currency: string;
  pricingRules?: PricingRulesConfig;
  now?: Date;
}

export interface FactorExplanation {
  code: FactorCode;
  /** Multiplicative contribution (1.0 = no change). */
  contribution: number;
  detail: string;
  metricValue: number;
  threshold?: number;
}

export interface GuardrailResult {
  floor: number;
  ceiling: number;
  clamped: boolean;
  preClampPrice: number;
  bandLabel: string;
}

export interface OfferRecommendation {
  offerId: string;
  zone: string;
  name: string;
  basePrice: number;
  currentPrice: number;
  recommendedPrice: number;
  recommendedMultiplier: number;
  direction: RecommendationDirection;
  deltaPercent: number;
  factors: FactorExplanation[];
  guardrail: GuardrailResult;
  requiresApproval: boolean;
  autoApplicable: boolean;
  explanation: string;
  confidence: RecommendationConfidence;
}

export interface EventRecommendationBundle {
  eventId: string;
  organizationId: string;
  title: string;
  generatedAt: string;
  enableDynamic: boolean;
  signals: {
    daysUntilEvent: number;
    expectedPace: number;
    actualPace: number;
    paceDelta: number;
    occupancyPercent: number;
    soldTickets: number;
    totalCapacity: number;
  };
  recommendations: OfferRecommendation[];
  summary: string;
}

export interface PendingRecommendationRecord {
  id: string;
  eventId: string;
  offerId: string;
  adjustedPrice: number;
  priceMultiplier: number;
  reason: string;
  activeFrom: Date;
  activeTo: Date;
  createdAt: Date;
  status: RecommendationStatus;
  payload?: PendingReasonPayload;
}

export interface PendingReasonPayload {
  v: 1;
  status: 'pending' | 'rejected';
  explanation: string;
  factors: FactorExplanation[];
  direction: RecommendationDirection;
  deltaPercent: number;
  requiresApproval: boolean;
  guardrail: GuardrailResult;
  basePrice: number;
  currentPrice: number;
}

export const PENDING_REASON_PREFIX = 'pending_approval|';
export const REJECTED_REASON_PREFIX = 'rejected_recommendation|';
export const APPLIED_REASON_PREFIX = 'applied_recommendation|';

export const DEFAULT_AUTO_APPLY_MAX_DELTA = 0.1;
export const DEFAULT_FLOOR_MULTIPLIER = 0.7;
export const DEFAULT_CEILING_MULTIPLIER = 2.5;
/**
 * Cargos sobre el subtotal, configurables por entorno.
 *
 * Pumpkin Zone vende a precio final: el precio anunciado ya incluye IVA y no
 * hay cargo por servicio ("Impuestos incluidos · Sin cargos ocultos"). Por eso
 * los defaults son 0. Si un despliegue cobra cargos aparte, se fijan aquí:
 *   PRICING_SERVICE_FEE_RATE=0.10   PRICING_TAX_RATE=0.16
 */
function rateFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : fallback;
}
export const SERVICE_FEE_RATE = rateFromEnv('PRICING_SERVICE_FEE_RATE', 0);
export const TAX_RATE = rateFromEnv('PRICING_TAX_RATE', 0);
