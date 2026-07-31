import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AiAnomaliesResponse,
  AiAnomalyMetric,
  AiAnomalyPoint,
  AiDataSufficiency,
} from '@boletera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCacheService } from '../ai-cache.service';
import { resolveAiRange, type AiResolvedRange } from '../ai-range';
import {
  mean,
  round,
  sampleStd,
  sufficiencyFromSample,
  zScore,
} from '../stats/stats';

type BucketValue = { bucket: Date; value: number };

const BASELINE_WINDOWS = 14;
const MIN_BASELINE = 7;

/**
 * Anomaly detection via rolling z-score against the event/org baseline.
 *
 * Method: for each daily bucket, compare the observed value to the previous
 * BASELINE_WINDOWS days (same series). |z| >= threshold → anomaly.
 * Chosen because it is explainable, calibrated to each tenant's own history,
 * and does not require cross-tenant pooling.
 *
 * Complexity: O(M * B) metrics × buckets with one SQL series per metric; cached 45s.
 */
@Injectable()
export class AnomalyDetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AiCacheService,
  ) {}

  async detect(
    organizationId: string,
    opts: {
      from?: string;
      to?: string;
      eventId?: string;
      metric?: AiAnomalyMetric;
      zThreshold?: number;
    },
  ): Promise<AiAnomaliesResponse> {
    const range = resolveAiRange(opts.from, opts.to);
    const zThreshold = opts.zThreshold ?? 2.5;
    const cacheKey = this.cache.wrapKey([
      'ai-anomaly',
      organizationId,
      opts.eventId,
      opts.metric,
      zThreshold,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);
    return this.cache.wrap(cacheKey, 45, () =>
      this.compute(organizationId, range, opts.eventId, opts.metric, zThreshold),
    );
  }

  private async compute(
    organizationId: string,
    range: AiResolvedRange,
    eventId: string | undefined,
    metricFilter: AiAnomalyMetric | undefined,
    zThreshold: number,
  ): Promise<AiAnomaliesResponse> {
    // Extend lookback so the first in-range day has a baseline.
    const lookbackFrom = new Date(
      range.from.getTime() - BASELINE_WINDOWS * 24 * 60 * 60 * 1000,
    );

    const metrics: AiAnomalyMetric[] = metricFilter
      ? [metricFilter]
      : [
          'tickets_sold',
          'gross_revenue',
          'refund_amount',
          'payment_approval_rate',
          'access_traffic',
        ];

    const seriesByMetric = new Map<AiAnomalyMetric, BucketValue[]>();
    await Promise.all(
      metrics.map(async (metric) => {
        const rows = await this.loadSeries(
          organizationId,
          metric,
          lookbackFrom,
          range.to,
          eventId,
        );
        seriesByMetric.set(metric, rows);
      }),
    );

    const anomalies: AiAnomalyPoint[] = [];
    let sampleSize = 0;

    for (const metric of metrics) {
      const series = seriesByMetric.get(metric) ?? [];
      sampleSize += series.length;
      const values = series.map((r) => r.value);
      for (let i = 0; i < series.length; i++) {
        const point = series[i]!;
        if (point.bucket < range.from || point.bucket >= range.to) continue;
        const baseline = values.slice(Math.max(0, i - BASELINE_WINDOWS), i);
        if (baseline.length < MIN_BASELINE) continue;
        const z = zScore(point.value, baseline);
        const absZ = Math.abs(z);
        if (!Number.isFinite(absZ) || absZ < zThreshold) continue;
        const direction = z > 0 ? 'spike' : 'drop';
        const severity =
          absZ >= 4 ? 'critical' : absZ >= 3 ? 'alert' : 'watch';
        const baselineMean = mean(baseline);
        const baselineStd = sampleStd(baseline);
        anomalies.push({
          metric,
          bucket: point.bucket.toISOString(),
          observed: round(point.value),
          baselineMean: round(baselineMean),
          baselineStd: round(baselineStd),
          zScore: round(z, 3),
          direction,
          severity,
          explanation: this.explain(metric, direction, point.value, baselineMean, absZ),
          eventId,
        });
      }
    }

    anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

    const sufficiency: AiDataSufficiency = sufficiencyFromSample(
      sampleSize,
      MIN_BASELINE,
      BASELINE_WINDOWS * metrics.length,
    );

    return {
      organizationId,
      dateRange: range.dateRange,
      method: {
        id: 'rolling_zscore',
        name: 'Z-score rodante',
        rationale:
          'Compara cada día contra la media y desviación de los 14 días previos de la misma serie del tenant; umbral típico |z|≥2.5.',
      },
      zThreshold,
      anomalies,
      baselineWindows: BASELINE_WINDOWS,
      sufficiency,
      sampleSize,
      generatedAt: new Date().toISOString(),
    };
  }

  private explain(
    metric: AiAnomalyMetric,
    direction: 'spike' | 'drop',
    observed: number,
    baseline: number,
    absZ: number,
  ): string {
    const labels: Record<AiAnomalyMetric, string> = {
      tickets_sold: 'boletos vendidos',
      gross_revenue: 'ingresos brutos',
      refund_amount: 'monto de reembolsos',
      payment_approval_rate: 'tasa de aprobación de pagos',
      access_traffic: 'tráfico de accesos',
    };
    const verb = direction === 'spike' ? 'pico' : 'caída';
    return `Se detectó un ${verb} anormal en ${labels[metric]}: observado ${round(observed)} vs línea base ${round(baseline)} (|z|=${round(absZ, 2)}).`;
  }

  private async loadSeries(
    organizationId: string,
    metric: AiAnomalyMetric,
    from: Date,
    to: Date,
    eventId?: string,
  ): Promise<BucketValue[]> {
    const eventFilter = eventId
      ? Prisma.sql`AND o."eventId" = ${eventId}`
      : Prisma.empty;

    switch (metric) {
      case 'tickets_sold':
        return this.prisma.$queryRaw<BucketValue[]>(Prisma.sql`
          SELECT date_trunc('day', o."createdAt") AS bucket,
                 COALESCE(SUM(oi.quantity), 0)::float AS value
          FROM "OrderItem" oi
          INNER JOIN "Order" o ON o.id = oi."orderId"
          WHERE o."organizationId" = ${organizationId}
            AND o.status = 'COMPLETED'
            AND o."createdAt" >= ${from}
            AND o."createdAt" < ${to}
            ${eventFilter}
          GROUP BY 1 ORDER BY 1
        `);
      case 'gross_revenue':
        return this.prisma.$queryRaw<BucketValue[]>(Prisma.sql`
          SELECT date_trunc('day', o."createdAt") AS bucket,
                 COALESCE(SUM(o."totalAmount"), 0)::float AS value
          FROM "Order" o
          WHERE o."organizationId" = ${organizationId}
            AND o.status = 'COMPLETED'
            AND o."createdAt" >= ${from}
            AND o."createdAt" < ${to}
            ${eventFilter}
          GROUP BY 1 ORDER BY 1
        `);
      case 'refund_amount':
        return this.prisma.$queryRaw<BucketValue[]>(Prisma.sql`
          SELECT date_trunc('day', r."requestedAt") AS bucket,
                 COALESCE(SUM(r.amount), 0)::float AS value
          FROM "Refund" r
          INNER JOIN "Order" o ON o.id = r."orderId"
          WHERE o."organizationId" = ${organizationId}
            AND r.status = 'COMPLETED'
            AND r."requestedAt" >= ${from}
            AND r."requestedAt" < ${to}
            ${eventFilter}
          GROUP BY 1 ORDER BY 1
        `);
      case 'payment_approval_rate':
        return this.prisma.$queryRaw<BucketValue[]>(Prisma.sql`
          SELECT date_trunc('day', o."createdAt") AS bucket,
                 CASE WHEN COUNT(*) = 0 THEN 0
                      ELSE (SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END)::float
                            / COUNT(*)::float) * 100
                 END AS value
          FROM "Order" o
          WHERE o."organizationId" = ${organizationId}
            AND o.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
            AND o."createdAt" >= ${from}
            AND o."createdAt" < ${to}
            ${eventFilter}
          GROUP BY 1 ORDER BY 1
        `);
      case 'access_traffic':
        return this.prisma.$queryRaw<BucketValue[]>(Prisma.sql`
          SELECT date_trunc('day', ts."scannedAt") AS bucket,
                 COUNT(*)::float AS value
          FROM "TicketScan" ts
          INNER JOIN "Ticket" t ON t.id = ts."ticketId"
          INNER JOIN "Event" e ON e.id = t."eventId"
          WHERE e."organizationId" = ${organizationId}
            AND ts.success = true
            AND ts."scannedAt" >= ${from}
            AND ts."scannedAt" < ${to}
            ${eventId ? Prisma.sql`AND e.id = ${eventId}` : Prisma.empty}
          GROUP BY 1 ORDER BY 1
        `);
      default:
        return [];
    }
  }
}
