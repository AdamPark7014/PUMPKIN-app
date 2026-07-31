import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AiFactor,
  AiFraudRiskBand,
  AiFraudRiskOrderResponse,
  AiFraudRiskResponse,
  AiFraudRiskScore,
} from '@boletera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCacheService } from '../ai-cache.service';
import { resolveAiRange } from '../ai-range';
import { clamp, mean, round, weightedScore } from '../stats/stats';

type OrderRow = {
  id: string;
  userId: string;
  buyerEmail: string;
  eventId: string;
  createdAt: Date;
  totalAmount: { toNumber?: () => number } | number;
  status: string;
  paymentMethod: string;
  payment: {
    lastFourDigits: string | null;
    brand: string | null;
    status: string;
  } | null;
  fraudFlags: Array<{
    score: number;
    type: string;
    ipAddress: string | null;
    deviceFingerprint: string | null;
  }>;
};

/**
 * Deterministic, explainable fraud risk scoring.
 *
 * Method: weighted rule system over observable signals — purchase velocity,
 * payment instrument reuse across distinct buyers, prior fraud flags, device /
 * IP reuse when present in FraudFlag rows, and failed-payment bursts.
 * Score ∈ [0,100]; every point is attributable to named factors.
 *
 * Complexity: O(N + U) orders + grouped lookups; cached 45s.
 */
@Injectable()
export class FraudRiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AiCacheService,
  ) {}

  async scoreOrganization(
    organizationId: string,
    opts: { from?: string; to?: string; eventId?: string; limit?: number },
  ): Promise<AiFraudRiskResponse> {
    const range = resolveAiRange(opts.from, opts.to);
    const limit = opts.limit ?? 50;
    const cacheKey = this.cache.wrapKey([
      'ai-fraud',
      organizationId,
      opts.eventId,
      limit,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);
    return this.cache.wrap(cacheKey, 45, () =>
      this.computeOrg(organizationId, range.from, range.to, opts.eventId, limit, range.dateRange),
    );
  }

  async scoreOrder(
    organizationId: string,
    orderId: string,
  ): Promise<AiFraudRiskOrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: {
        id: true,
        userId: true,
        buyerEmail: true,
        eventId: true,
        createdAt: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        payment: {
          select: { lastFourDigits: true, brand: true, status: true },
        },
        fraudFlags: {
          select: {
            score: true,
            type: true,
            ipAddress: true,
            deviceFingerprint: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');

    const windowStart = new Date(order.createdAt.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(order.createdAt.getTime() + 60 * 60 * 1000);
    const contextOrders = (await this.prisma.order.findMany({
      where: {
        organizationId,
        createdAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        userId: true,
        buyerEmail: true,
        eventId: true,
        createdAt: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        payment: {
          select: { lastFourDigits: true, brand: true, status: true },
        },
        fraudFlags: {
          select: {
            score: true,
            type: true,
            ipAddress: true,
            deviceFingerprint: true,
          },
        },
      },
      take: 500,
    })) as OrderRow[];

    const score = this.scoreOne(order as OrderRow, contextOrders);
    return {
      organizationId,
      method: this.method(),
      score,
      generatedAt: new Date().toISOString(),
    };
  }

  private async computeOrg(
    organizationId: string,
    from: Date,
    to: Date,
    eventId: string | undefined,
    limit: number,
    dateRange: { from: string; to: string },
  ): Promise<AiFraudRiskResponse> {
    const orders = (await this.prisma.order.findMany({
      where: {
        organizationId,
        createdAt: { gte: from, lt: to },
        ...(eventId ? { eventId } : {}),
      },
      select: {
        id: true,
        userId: true,
        buyerEmail: true,
        eventId: true,
        createdAt: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        payment: {
          select: { lastFourDigits: true, brand: true, status: true },
        },
        fraudFlags: {
          select: {
            score: true,
            type: true,
            ipAddress: true,
            deviceFingerprint: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })) as OrderRow[];

    const scores = orders
      .map((o) => this.scoreOne(o, orders))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const highOrCritical = scores.filter(
      (s) => s.band === 'high' || s.band === 'critical',
    ).length;

    return {
      organizationId,
      dateRange,
      method: this.method(),
      scores,
      summary: {
        scored: scores.length,
        highOrCritical,
        averageScore: round(mean(scores.map((s) => s.score))),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private method() {
    return {
      id: 'weighted_signal_rules',
      name: 'Reglas ponderadas de señales',
      rationale:
        'Suma puntos por velocidad de compra, reutilización de tarjeta, fallos de pago, banderas previas y reutilización de IP/dispositivo cuando existen en el esquema.',
    };
  }

  private scoreOne(order: OrderRow, universe: OrderRow[]): AiFraudRiskScore {
    const email = order.buyerEmail.toLowerCase();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const sameUser1h = universe.filter(
      (o) =>
        o.userId === order.userId &&
        Math.abs(o.createdAt.getTime() - order.createdAt.getTime()) <= hourMs,
    ).length;
    const sameEmail24h = universe.filter(
      (o) =>
        o.buyerEmail.toLowerCase() === email &&
        Math.abs(o.createdAt.getTime() - order.createdAt.getTime()) <= dayMs,
    ).length;

    const last4 = order.payment?.lastFourDigits ?? null;
    let cardReuseBuyers = 0;
    if (last4) {
      const buyers = new Set(
        universe
          .filter((o) => o.payment?.lastFourDigits === last4)
          .map((o) => o.buyerEmail.toLowerCase()),
      );
      cardReuseBuyers = buyers.size;
    }

    const failedNearby = universe.filter(
      (o) =>
        o.userId === order.userId &&
        o.status === 'FAILED' &&
        Math.abs(o.createdAt.getTime() - order.createdAt.getTime()) <= dayMs,
    ).length;

    const priorFlagScore = order.fraudFlags.reduce(
      (m, f) => Math.max(m, f.score ?? 0),
      0,
    );

    const fingerprints = order.fraudFlags
      .map((f) => f.deviceFingerprint)
      .filter((v): v is string => !!v);
    let deviceReuse = 0;
    if (fingerprints.length > 0) {
      const fp = fingerprints[0]!;
      const users = new Set(
        universe
          .filter((o) => o.fraudFlags.some((f) => f.deviceFingerprint === fp))
          .map((o) => o.userId),
      );
      deviceReuse = users.size;
    }

    const ips = order.fraudFlags
      .map((f) => f.ipAddress)
      .filter((v): v is string => !!v);
    let ipReuse = 0;
    if (ips.length > 0) {
      const ip = ips[0]!;
      const users = new Set(
        universe
          .filter((o) => o.fraudFlags.some((f) => f.ipAddress === ip))
          .map((o) => o.userId),
      );
      ipReuse = users.size;
    }

    const amount =
      typeof order.totalAmount === 'number'
        ? order.totalAmount
        : Number(order.totalAmount ?? 0);
    const amounts = universe.map((o) =>
      typeof o.totalAmount === 'number' ? o.totalAmount : Number(o.totalAmount ?? 0),
    );
    const avgAmount = mean(amounts.filter((a) => a > 0));
    const highTicket = avgAmount > 0 && amount > avgAmount * 4;

    const factorDefs: Array<{
      key: string;
      label: string;
      weight: number;
      active: boolean;
      value?: number;
      explanation: string;
    }> = [
      {
        key: 'velocity_user_1h',
        label: 'Velocidad de compra (usuario, 1h)',
        weight: 22,
        active: sameUser1h >= 4,
        value: sameUser1h,
        explanation: `${sameUser1h} órdenes del mismo usuario en 1 hora.`,
      },
      {
        key: 'velocity_email_24h',
        label: 'Velocidad de compra (email, 24h)',
        weight: 18,
        active: sameEmail24h >= 5,
        value: sameEmail24h,
        explanation: `${sameEmail24h} órdenes con el mismo email en 24 horas.`,
      },
      {
        key: 'card_reuse',
        label: 'Reutilización de método de pago',
        weight: 25,
        active: cardReuseBuyers >= 3,
        value: cardReuseBuyers,
        explanation: last4
          ? `Tarjeta ••••${last4} usada por ${cardReuseBuyers} compradores distintos.`
          : 'Sin dígitos de tarjeta disponibles.',
      },
      {
        key: 'failed_payments',
        label: 'Ráfaga de pagos fallidos',
        weight: 15,
        active: failedNearby >= 3,
        value: failedNearby,
        explanation: `${failedNearby} pagos fallidos del usuario en 24 horas.`,
      },
      {
        key: 'prior_flags',
        label: 'Banderas de fraude previas',
        weight: 20,
        active: priorFlagScore >= 50,
        value: priorFlagScore,
        explanation: `Puntaje máximo de bandera existente: ${round(priorFlagScore)}.`,
      },
      {
        key: 'device_reuse',
        label: 'Reutilización de dispositivo',
        weight: 16,
        active: deviceReuse >= 3,
        value: deviceReuse,
        explanation:
          deviceReuse > 0
            ? `Huella de dispositivo compartida por ${deviceReuse} usuarios.`
            : 'Sin huella de dispositivo en el esquema para esta orden.',
      },
      {
        key: 'ip_reuse',
        label: 'Reutilización de IP',
        weight: 12,
        active: ipReuse >= 4,
        value: ipReuse,
        explanation:
          ipReuse > 0
            ? `IP compartida por ${ipReuse} usuarios en banderas relacionadas.`
            : 'Sin IP observada en banderas de esta orden.',
      },
      {
        key: 'high_ticket',
        label: 'Monto atípico',
        weight: 10,
        active: highTicket,
        value: amount,
        explanation: `Monto ${round(amount)} MXN vs promedio ${round(avgAmount)} MXN del lote.`,
      },
    ];

    const score = weightedScore(
      factorDefs.map((f) => ({ weight: f.weight, active: f.active })),
      5,
    );
    const factors: AiFactor[] = factorDefs
      .filter((f) => f.active)
      .map((f) => ({
        key: f.key,
        label: f.label,
        weight: f.weight,
        value: f.value,
        explanation: f.explanation,
      }));

    return {
      subjectType: 'order',
      subjectId: order.id,
      score,
      band: this.band(score),
      factors,
      relatedOrderIds: universe
        .filter((o) => o.userId === order.userId && o.id !== order.id)
        .slice(0, 10)
        .map((o) => o.id),
      relatedEventIds: [order.eventId],
    };
  }

  private band(score: number): AiFraudRiskBand {
    const s = clamp(score, 0, 100);
    if (s >= 75) return 'critical';
    if (s >= 55) return 'high';
    if (s >= 30) return 'medium';
    return 'low';
  }
}
