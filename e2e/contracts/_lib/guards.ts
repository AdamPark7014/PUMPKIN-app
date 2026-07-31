import { expect } from '@playwright/test';
import { isJsonObject, type JsonObject } from '../../support/api';

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isIsoDateString(value: unknown): value is string {
  if (!isString(value) || value.length < 10) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

export function requireObject(value: unknown, label: string): JsonObject {
  expect(isJsonObject(value), `${label} must be a JSON object`).toBe(true);
  if (!isJsonObject(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value;
}

export function requireString(obj: JsonObject, key: string, label = key): string {
  const value = obj[key];
  expect(isString(value), `${label} must be string`).toBe(true);
  if (!isString(value)) throw new Error(`${label} missing`);
  return value;
}

export function requireNumber(obj: JsonObject, key: string, label = key): number {
  const value = obj[key];
  expect(isNumber(value), `${label} must be finite number`).toBe(true);
  if (!isNumber(value)) throw new Error(`${label} missing`);
  return value;
}

export function requireBoolean(obj: JsonObject, key: string, label = key): boolean {
  const value = obj[key];
  expect(isBoolean(value), `${label} must be boolean`).toBe(true);
  if (!isBoolean(value)) throw new Error(`${label} missing`);
  return value;
}

export function requireArray(obj: JsonObject, key: string, label?: string): unknown[];
export function requireArray(value: unknown, label: string): unknown[];
export function requireArray(
  objOrValue: JsonObject | unknown,
  keyOrLabel: string,
  label?: string,
): unknown[] {
  if (label !== undefined || isJsonObject(objOrValue)) {
    const obj = requireObject(objOrValue, label ?? keyOrLabel);
    const key = keyOrLabel;
    const resolvedLabel = label ?? key;
    const value = obj[key];
    expect(isUnknownArray(value), `${resolvedLabel} must be array`).toBe(true);
    if (!isUnknownArray(value)) throw new Error(`${resolvedLabel} missing`);
    return value;
  }
  expect(isUnknownArray(objOrValue), `${keyOrLabel} must be array`).toBe(true);
  if (!isUnknownArray(objOrValue)) throw new Error(`${keyOrLabel} missing`);
  return objOrValue;
}

export function requireIso(obj: JsonObject, key: string, label = key): string {
  const value = obj[key];
  expect(isIsoDateString(value), `${label} must be ISO date`).toBe(true);
  if (!isIsoDateString(value)) throw new Error(`${label} missing`);
  return value;
}

export function assertDateRange(value: unknown, label: string): void {
  const range = requireObject(value, label);
  requireIso(range, 'from', `${label}.from`);
  requireIso(range, 'to', `${label}.to`);
}

export function assertKpi(value: unknown, label: string): void {
  const kpi = requireObject(value, label);
  requireString(kpi, 'key', `${label}.key`);
  requireString(kpi, 'label', `${label}.label`);
  requireNumber(kpi, 'value', `${label}.value`);
  requireNumber(kpi, 'previousValue', `${label}.previousValue`);
  requireNumber(kpi, 'delta', `${label}.delta`);
  const deltaPercent = kpi.deltaPercent;
  expect(
    deltaPercent === null || isNumber(deltaPercent),
    `${label}.deltaPercent must be number|null`,
  ).toBe(true);
}

export function assertBreakdown(value: unknown, label: string): void {
  const breakdown = requireObject(value, label);
  requireString(breakdown, 'dimension', `${label}.dimension`);
  requireString(breakdown, 'label', `${label}.label`);
  requireNumber(breakdown, 'total', `${label}.total`);
  const rows = requireArray(breakdown, 'rows', `${label}.rows`);
  for (const [i, row] of rows.entries()) {
    const r = requireObject(row, `${label}.rows[${i}]`);
    requireString(r, 'key', `${label}.rows[${i}].key`);
    requireString(r, 'label', `${label}.rows[${i}].label`);
    requireNumber(r, 'value', `${label}.rows[${i}].value`);
  }
}

export function assertTimeSeries(value: unknown, label: string): void {
  const series = requireObject(value, label);
  requireString(series, 'key', `${label}.key`);
  requireString(series, 'label', `${label}.label`);
  const gran = requireString(series, 'granularity', `${label}.granularity`);
  expect(['hour', 'day', 'week', 'month']).toContain(gran);
  const points = requireArray(series, 'points', `${label}.points`);
  for (const [i, point] of points.entries()) {
    const p = requireObject(point, `${label}.points[${i}]`);
    requireIso(p, 'bucket', `${label}.points[${i}].bucket`);
    requireNumber(p, 'value', `${label}.points[${i}].value`);
  }
}

export function assertFunnel(value: unknown, label: string): void {
  const funnel = requireObject(value, label);
  requireString(funnel, 'key', `${label}.key`);
  requireString(funnel, 'label', `${label}.label`);
  const stages = requireArray(funnel, 'stages', `${label}.stages`);
  for (const [i, stage] of stages.entries()) {
    const s = requireObject(stage, `${label}.stages[${i}]`);
    requireString(s, 'key', `${label}.stages[${i}].key`);
    requireString(s, 'label', `${label}.stages[${i}].label`);
    requireNumber(s, 'count', `${label}.stages[${i}].count`);
    const prev = s.conversionFromPrevious;
    expect(
      prev === null || isNumber(prev),
      `${label}.stages[${i}].conversionFromPrevious`,
    ).toBe(true);
    requireNumber(s, 'conversionFromTop', `${label}.stages[${i}].conversionFromTop`);
  }
}

function assertMetricsEnvelope(body: JsonObject, label: string): void {
  requireString(body, 'organizationId', `${label}.organizationId`);
  assertDateRange(body.dateRange, `${label}.dateRange`);
  requireIso(body, 'generatedAt', `${label}.generatedAt`);
}

export function assertExecutiveMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'executive');
  expect(body.currency).toBe('MXN');
  expect(body.timezone).toBe('America/Mexico_City');
  assertDateRange(body.comparisonRange, 'executive.comparisonRange');
  const kpis = requireObject(body.kpis, 'executive.kpis');
  for (const key of [
    'grossRevenue',
    'netRevenue',
    'ticketsSold',
    'averageTicketPrice',
    'conversionRate',
    'ordersCompleted',
  ]) {
    assertKpi(kpis[key], `executive.kpis.${key}`);
  }
  assertBreakdown(body.revenueByChannel, 'executive.revenueByChannel');
  const projection = requireObject(body.projection, 'executive.projection');
  requireNumber(projection, 'projectedGrossRevenue');
  requireNumber(projection, 'projectedTicketsSold');
  expect(projection.method).toBe('linear_pace');
  requireNumber(projection, 'daysElapsed');
  requireNumber(projection, 'daysInPeriod');
  const series = requireArray(body, 'series', 'executive.series');
  for (const [i, s] of series.entries()) assertTimeSeries(s, `executive.series[${i}]`);
}

export function assertSalesPaceMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'salesPace');
  for (const key of ['events', 'atRisk', 'topPerformers'] as const) {
    const rows = requireArray(body[key], `salesPace.${key}`);
    for (const [i, row] of rows.entries()) {
      const r = requireObject(row, `salesPace.${key}[${i}]`);
      requireString(r, 'eventId');
      requireString(r, 'title');
      requireString(r, 'status');
      requireIso(r, 'startsAt');
      requireNumber(r, 'daysUntilEvent');
      requireNumber(r, 'totalCapacity');
      requireNumber(r, 'ticketsSold');
      requireNumber(r, 'occupancyPercent');
      requireNumber(r, 'remainingCapacity');
      requireNumber(r, 'grossRevenue');
      requireNumber(r, 'actualPace');
      requireNumber(r, 'expectedPace');
      requireNumber(r, 'paceDelta');
      expect(['on_track', 'watch', 'at_risk', 'critical']).toContain(r.riskLevel);
    }
  }
}

export function assertInventoryMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'inventoryMetrics');
  const summary = requireObject(body.summary, 'inventoryMetrics.summary');
  for (const key of [
    'totalCapacity',
    'available',
    'held',
    'sold',
    'blocked',
    'activeHolds',
  ]) {
    requireNumber(summary, key, `inventoryMetrics.summary.${key}`);
  }
  const zones = requireArray(body, 'byZone', 'inventoryMetrics.byZone');
  for (const [i, zone] of zones.entries()) {
    const z = requireObject(zone, `inventoryMetrics.byZone[${i}]`);
    requireString(z, 'eventId');
    requireString(z, 'eventTitle');
    requireString(z, 'offerId');
    requireString(z, 'zone');
    requireString(z, 'tierName');
    requireNumber(z, 'totalQuantity');
    requireNumber(z, 'remainingQuantity');
    requireNumber(z, 'soldQuantity');
    requireNumber(z, 'holdQuantity');
    requireNumber(z, 'availabilityPercent');
    requireNumber(z, 'sellThroughVelocity');
    expect(
      z.daysToSellOut === null || isNumber(z.daysToSellOut),
      `inventoryMetrics.byZone[${i}].daysToSellOut`,
    ).toBe(true);
  }
  assertBreakdown(body.statusBreakdown, 'inventoryMetrics.statusBreakdown');
}

export function assertOrdersPaymentsMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'ordersMetrics');
  assertDateRange(body.comparisonRange, 'ordersMetrics.comparisonRange');
  assertBreakdown(body.volumeByStatus, 'ordersMetrics.volumeByStatus');
  assertBreakdown(body.paymentMethodBreakdown, 'ordersMetrics.paymentMethodBreakdown');
  const kpis = requireObject(body.kpis, 'ordersMetrics.kpis');
  for (const key of [
    'approvalRate',
    'refundRate',
    'chargebackCount',
    'completedOrders',
    'grossRevenue',
  ]) {
    assertKpi(kpis[key], `ordersMetrics.kpis.${key}`);
  }
}

export function assertAccessMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'accessMetrics');
  assertTimeSeries(body.checkInByHour, 'accessMetrics.checkInByHour');
  requireNumber(body, 'noShowRate');
  requireNumber(body, 'ticketsSold');
  requireNumber(body, 'ticketsCheckedIn');
  requireNumber(body, 'ticketsNoShow');
  assertBreakdown(body.trafficByAccessPoint, 'accessMetrics.trafficByAccessPoint');
}

export function assertResaleMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'resaleMetrics');
  const summary = requireObject(body.summary, 'resaleMetrics.summary');
  for (const key of [
    'activeListings',
    'soldListings',
    'cancelledListings',
    'grossGmv',
    'platformFees',
    'averageAskingPrice',
    'averageSoldPrice',
  ]) {
    requireNumber(summary, key);
  }
  assertBreakdown(body.statusBreakdown, 'resaleMetrics.statusBreakdown');
  const series = requireArray(body, 'series', 'resaleMetrics.series');
  for (const [i, s] of series.entries()) assertTimeSeries(s, `resaleMetrics.series[${i}]`);
}

export function assertWaitlistMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'waitlistMetrics');
  const summary = requireObject(body.summary, 'waitlistMetrics.summary');
  for (const key of [
    'pending',
    'notified',
    'converted',
    'expired',
    'cancelled',
    'conversionRate',
  ]) {
    requireNumber(summary, key);
  }
  const byEvent = requireArray(body, 'byEvent', 'waitlistMetrics.byEvent');
  for (const [i, row] of byEvent.entries()) {
    const r = requireObject(row, `waitlistMetrics.byEvent[${i}]`);
    requireString(r, 'key');
    requireString(r, 'label');
    requireNumber(r, 'value');
  }
  assertFunnel(body.funnel, 'waitlistMetrics.funnel');
}

export function assertCampaignMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'campaignMetrics');
  const promotions = requireArray(body, 'promotions', 'campaignMetrics.promotions');
  for (const [i, promo] of promotions.entries()) {
    const p = requireObject(promo, `campaignMetrics.promotions[${i}]`);
    requireString(p, 'promotionId');
    requireString(p, 'code');
    requireString(p, 'name');
    requireNumber(p, 'usageCount');
    expect(
      p.usageLimit === null || isNumber(p.usageLimit),
      `campaignMetrics.promotions[${i}].usageLimit`,
    ).toBe(true);
    requireNumber(p, 'ordersAttributed');
    requireNumber(p, 'revenueAttributed');
    requireNumber(p, 'discountGiven');
    requireNumber(p, 'conversionRate');
    expect(['strong', 'average', 'poor']).toContain(p.performance);
  }
  assertFunnel(body.funnel, 'campaignMetrics.funnel');
}

export function assertFraudMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'fraudMetrics');
  const summary = requireObject(body.summary, 'fraudMetrics.summary');
  for (const key of [
    'totalFlags',
    'openFlags',
    'criticalFlags',
    'averageRiskScore',
    'resolvedFlags',
    'falsePositives',
  ]) {
    requireNumber(summary, key);
  }
  assertBreakdown(body.byType, 'fraudMetrics.byType');
  assertBreakdown(body.bySeverity, 'fraudMetrics.bySeverity');
  const signals = requireArray(body.recentSignals, 'fraudMetrics.recentSignals');
  for (const [i, signal] of signals.entries()) {
    const s = requireObject(signal, `fraudMetrics.recentSignals[${i}]`);
    requireString(s, 'id');
    requireString(s, 'type');
    requireString(s, 'severity');
    requireNumber(s, 'score');
    requireString(s, 'reason');
    requireString(s, 'status');
    expect(
      s.orderId === null || isString(s.orderId),
      `fraudMetrics.recentSignals[${i}].orderId`,
    ).toBe(true);
    expect(
      s.eventId === null || isString(s.eventId),
      `fraudMetrics.recentSignals[${i}].eventId`,
    ).toBe(true);
    requireIso(s, 'createdAt');
  }
}

export function assertSettlementsMetrics(body: JsonObject): void {
  assertMetricsEnvelope(body, 'settlementsMetrics');
  const summary = requireObject(body.summary, 'settlementsMetrics.summary');
  for (const key of [
    'grossRevenue',
    'refunds',
    'commission',
    'netPayable',
    'pendingPayouts',
    'completedPayouts',
  ]) {
    requireNumber(summary, key);
  }
  const payouts = requireArray(body.payouts, 'settlementsMetrics.payouts');
  for (const [i, payout] of payouts.entries()) {
    const p = requireObject(payout, `settlementsMetrics.payouts[${i}]`);
    requireString(p, 'id');
    requireIso(p, 'periodStart');
    requireIso(p, 'periodEnd');
    requireNumber(p, 'grossRevenue');
    requireNumber(p, 'commission');
    requireNumber(p, 'netAmount');
    requireString(p, 'status');
    expect(
      p.referenceId === null || isString(p.referenceId),
      `settlementsMetrics.payouts[${i}].referenceId`,
    ).toBe(true);
    expect(
      p.processedAt === null || isIsoDateString(p.processedAt),
      `settlementsMetrics.payouts[${i}].processedAt`,
    ).toBe(true);
  }
  const byEvent = requireArray(body.byEvent, 'settlementsMetrics.byEvent');
  for (const [i, row] of byEvent.entries()) {
    const r = requireObject(row, `settlementsMetrics.byEvent[${i}]`);
    requireString(r, 'key');
    requireString(r, 'label');
    requireNumber(r, 'value');
  }
}

export function assertTimeSeriesResponse(body: JsonObject): void {
  assertMetricsEnvelope(body, 'timeseries');
  const gran = requireString(body, 'granularity');
  expect(['hour', 'day', 'week', 'month']).toContain(gran);
  requireString(body, 'metric');
  const series = requireArray(body.series, 'timeseries.series');
  for (const [i, s] of series.entries()) assertTimeSeries(s, `timeseries.series[${i}]`);
}

export function assertAlertsResponse(body: JsonObject): void {
  assertMetricsEnvelope(body, 'alerts');
  const alerts = requireArray(body.alerts, 'alerts.alerts');
  for (const [i, alert] of alerts.entries()) {
    const a = requireObject(alert, `alerts.alerts[${i}]`);
    requireString(a, 'id');
    requireString(a, 'domain');
    expect(['info', 'warning', 'critical']).toContain(a.severity);
    requireString(a, 'title');
    requireString(a, 'explanation');
    requireString(a, 'suggestedAction');
    requireIso(a, 'detectedAt');
  }
  const counts = requireObject(body.countsBySeverity, 'alerts.countsBySeverity');
  requireNumber(counts, 'info');
  requireNumber(counts, 'warning');
  requireNumber(counts, 'critical');
}

export function assertDiscoveryEventCard(
  value: unknown,
  label: string,
  options: { requireOffers?: boolean } = {},
): JsonObject {
  const requireOffers = options.requireOffers ?? true;
  const event = requireObject(value, label);
  requireString(event, 'id', `${label}.id`);
  requireString(event, 'slug', `${label}.slug`);
  requireString(event, 'title', `${label}.title`);
  requireString(event, 'status', `${label}.status`);
  requireIso(event, 'startsAt', `${label}.startsAt`);
  const sale = requireObject(event.sale, `${label}.sale`);
  requireString(sale, 'state', `${label}.sale.state`);
  requireBoolean(sale, 'canPurchase', `${label}.sale.canPurchase`);
  requireBoolean(sale, 'requiresCode', `${label}.sale.requiresCode`);
  const venue = requireObject(event.venue, `${label}.venue`);
  requireString(venue, 'name', `${label}.venue.name`);
  requireString(venue, 'slug', `${label}.venue.slug`);
  if (requireOffers || event.offers !== undefined) {
    const offers = requireArray(event, 'offers', `${label}.offers`);
    for (const [i, offer] of offers.entries()) {
      const o = requireObject(offer, `${label}.offers[${i}]`);
      requireString(o, 'id');
      requireString(o, 'name');
      // zone is list-card specific; detail Offer model may omit zone when null
      if (o.zone !== undefined && o.zone !== null) {
        expect(isString(o.zone), `${label}.offers[${i}].zone`).toBe(true);
      }
      expect(
        isNumber(o.basePrice) || isString(o.basePrice),
        `${label}.offers[${i}].basePrice`,
      ).toBe(true);
      if (o.remainingQuantity !== undefined) {
        requireNumber(o, 'remainingQuantity');
      }
      if (o.isAvailable !== undefined) {
        requireBoolean(o, 'isAvailable');
      }
    }
  }
  return event;
}

export function assertAvailability(body: JsonObject): {
  tickets: Array<{
    id: string;
    seatId: string | null;
    status: string;
    section: string | null;
    row: string | null;
    seatNumber: string | null;
  }>;
  activeHolds: number;
} {
  requireNumber(body, 'activeHolds');
  const ticketsRaw = requireArray(body.tickets, 'availability.tickets');
  const tickets = ticketsRaw.map((ticket, i) => {
    const t = requireObject(ticket, `availability.tickets[${i}]`);
    const id = requireString(t, 'id');
    const status = requireString(t, 'status');
    const seatId = t.seatId;
    expect(seatId === null || isString(seatId), `availability.tickets[${i}].seatId`).toBe(
      true,
    );
    return {
      id,
      seatId: isString(seatId) ? seatId : null,
      status,
      section: isString(t.section) ? t.section : null,
      row: isString(t.row) ? t.row : null,
      seatNumber: isString(t.seatNumber) ? t.seatNumber : null,
    };
  });
  return { tickets, activeHolds: requireNumber(body, 'activeHolds') };
}

export function assertHoldResponse(body: JsonObject): { holdIds: string[]; expiresAt: string } {
  const holds = requireArray(body.holds, 'hold.holds');
  expect(holds.length, 'hold.holds must not be empty').toBeGreaterThan(0);
  const holdIds = holds.map((hold, i) => {
    const h = requireObject(hold, `hold.holds[${i}]`);
    return requireString(h, 'id', `hold.holds[${i}].id`);
  });
  const expiresAt = requireIso(body, 'expiresAt', 'hold.expiresAt');
  return { holdIds, expiresAt };
}

export function assertOrderContract(body: JsonObject): {
  id: string;
  publicId: string;
  status: string;
} {
  const id = requireString(body, 'id', 'order.id');
  const publicId = requireString(body, 'publicId', 'order.publicId');
  const status = requireString(body, 'status', 'order.status');
  return { id, publicId, status };
}

export function assertPaymentsConfig(body: JsonObject): void {
  expect(body.gateway).toBe('BANORTE');
  requireBoolean(body, 'demo');
  const methods = requireArray(body.methods, 'payments.methods');
  for (const required of ['CARD', 'SPEI', 'OXXO'] as const) {
    expect(methods, `payments.methods must include ${required}`).toContain(required);
  }
  const ipn = requireObject(body.ipn, 'payments.ipn');
  requireString(ipn, 'webhookUrl');
  expect(String(ipn.webhookUrl)).toMatch(/\/payments\/webhooks\/banorte$/);
  requireBoolean(ipn, 'webhookSecretConfigured');
}
