import { Injectable } from '@nestjs/common';
import type {
  AiCustomerSegment,
  AiCustomerSegmentRow,
  AiFactor,
  AiSegmentationResponse,
} from '@boletera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCacheService } from '../ai-cache.service';
import { MS_PER_DAY, resolveAiRange } from '../ai-range';
import {
  logistic,
  percentile,
  round,
  sufficiencyFromSample,
} from '../stats/stats';

type BuyerAgg = {
  userId: string;
  email: string;
  orders: number;
  revenue: number;
  lastOrderAt: Date;
  firstOrderAt: Date;
};

/**
 * RFM segmentation + logistic churn probability.
 *
 * Method: Recency / Frequency / Monetary quintile scoring on completed orders
 * in the lookback window. Churn probability = logistic(β·z) where z combines
 * normalized recency and inverse frequency. Requires ≥ MIN_BUYERS buyers with
 * ≥1 completed order; otherwise sufficiency=insufficient and segments empty.
 *
 * Complexity: O(B) single group query + in-memory RFM; cached 90s.
 */
@Injectable()
export class CustomerSegmentationService {
  private static readonly MIN_BUYERS = 15;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AiCacheService,
  ) {}

  async segment(
    organizationId: string,
    opts: { from?: string; to?: string; limit?: number },
  ): Promise<AiSegmentationResponse> {
    const range = resolveAiRange(opts.from, opts.to);
    const limit = opts.limit ?? 100;
    const cacheKey = this.cache.wrapKey([
      'ai-seg',
      organizationId,
      limit,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);
    return this.cache.wrap(cacheKey, 90, () =>
      this.compute(organizationId, range, limit),
    );
  }

  private async compute(
    organizationId: string,
    range: ReturnType<typeof resolveAiRange>,
    limit: number,
  ): Promise<AiSegmentationResponse> {
    const rows = await this.prisma.order.groupBy({
      by: ['userId', 'buyerEmail'],
      where: {
        organizationId,
        status: 'COMPLETED',
        createdAt: { gte: range.from, lt: range.to },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    });

    const buyers: BuyerAgg[] = rows.map((r) => ({
      userId: r.userId,
      email: r.buyerEmail,
      orders: r._count._all,
      revenue: Number(r._sum.totalAmount ?? 0),
      lastOrderAt: r._max.createdAt ?? range.from,
      firstOrderAt: r._min.createdAt ?? range.from,
    }));

    const sampleSize = buyers.length;
    const sufficiency = sufficiencyFromSample(
      sampleSize,
      5,
      CustomerSegmentationService.MIN_BUYERS,
    );

    if (sufficiency === 'insufficient') {
      return {
        organizationId,
        dateRange: range.dateRange,
        method: this.method(),
        sufficiency,
        sampleSize,
        segments: [],
        customers: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const now = range.to.getTime();
    const recencies = buyers.map((b) =>
      Math.max(0, (now - b.lastOrderAt.getTime()) / MS_PER_DAY),
    );
    const frequencies = buyers.map((b) => b.orders);
    const monetaries = buyers.map((b) => b.revenue);

    const rCuts = this.quintileCuts(recencies, true);
    const fCuts = this.quintileCuts(frequencies, false);
    const mCuts = this.quintileCuts(monetaries, false);

    const customers: AiCustomerSegmentRow[] = buyers.map((b, idx) => {
      const recencyDays = round(recencies[idx]!);
      const rScore = this.scoreAgainstCuts(recencyDays, rCuts, true);
      const fScore = this.scoreAgainstCuts(b.orders, fCuts, false);
      const mScore = this.scoreAgainstCuts(b.revenue, mCuts, false);
      const segment = this.mapSegment(rScore, fScore, mScore, b.orders, recencyDays);
      const churnZ =
        0.045 * recencyDays - 0.35 * Math.log1p(b.orders) - 0.00005 * b.revenue;
      const churnProbability =
        segment === 'new' || segment === 'insufficient_history'
          ? null
          : round(logistic(churnZ), 4);
      const factors: AiFactor[] = [
        {
          key: 'recency',
          label: 'Recencia',
          weight: rScore,
          value: recencyDays,
          explanation: `Última compra hace ${recencyDays} días (score R=${rScore}).`,
        },
        {
          key: 'frequency',
          label: 'Frecuencia',
          weight: fScore,
          value: b.orders,
          explanation: `${b.orders} órdenes completadas en el periodo (score F=${fScore}).`,
        },
        {
          key: 'monetary',
          label: 'Monetario',
          weight: mScore,
          value: round(b.revenue),
          explanation: `${round(b.revenue)} MXN de gasto (score M=${mScore}).`,
        },
      ];
      return {
        userId: b.userId,
        email: b.email,
        segment,
        recencyDays,
        frequency: b.orders,
        monetaryMxn: round(b.revenue),
        churnProbability,
        churnConfidence:
          sufficiency === 'sufficient'
            ? b.orders >= 3
              ? 'medium'
              : 'low'
            : 'low',
        factors,
      };
    });

    customers.sort((a, b) => {
      const ca = a.churnProbability ?? -1;
      const cb = b.churnProbability ?? -1;
      return cb - ca;
    });

    const segmentCounts = new Map<AiCustomerSegment, { count: number; monetary: number }>();
    for (const c of customers) {
      const cur = segmentCounts.get(c.segment) ?? { count: 0, monetary: 0 };
      cur.count += 1;
      cur.monetary += c.monetaryMxn;
      segmentCounts.set(c.segment, cur);
    }

    const segments = [...segmentCounts.entries()]
      .map(([segment, v]) => ({
        segment,
        count: v.count,
        percentOfTotal: sampleSize > 0 ? round((v.count / sampleSize) * 100) : 0,
        averageMonetaryMxn: v.count > 0 ? round(v.monetary / v.count) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      organizationId,
      dateRange: range.dateRange,
      method: this.method(),
      sufficiency,
      sampleSize,
      segments,
      customers: customers.slice(0, limit),
      generatedAt: new Date().toISOString(),
    };
  }

  private method() {
    return {
      id: 'rfm_logistic_churn',
      name: 'RFM + churn logístico',
      rationale:
        'Segmenta compradores por quintiles de recencia, frecuencia y monto; estima abandono con una logística sobre recencia y frecuencia observada.',
    };
  }

  /** Higher-is-better cuts; if invert=true, lower raw values get higher scores. */
  private quintileCuts(values: number[], invert: boolean): number[] {
    const data = invert ? values.map((v) => -v) : values;
    return [0.2, 0.4, 0.6, 0.8].map((p) => percentile(data, p));
  }

  private scoreAgainstCuts(
    value: number,
    cuts: number[],
    invert: boolean,
  ): number {
    const v = invert ? -value : value;
    let score = 1;
    for (const cut of cuts) {
      if (v >= cut) score += 1;
    }
    return score;
  }

  private mapSegment(
    r: number,
    f: number,
    m: number,
    orders: number,
    recencyDays: number,
  ): AiCustomerSegment {
    if (orders <= 1 && recencyDays <= 30) return 'new';
    if (r >= 4 && f >= 4 && m >= 4) return 'champion';
    if (r >= 3 && f >= 3) return 'loyal';
    if (r >= 3 && f <= 2) return 'promising';
    if (r <= 2 && f >= 3) return 'at_risk';
    if (r <= 2 && f <= 2) return 'hibernating';
    return 'promising';
  }
}
