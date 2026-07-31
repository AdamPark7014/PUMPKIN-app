import { Injectable } from '@nestjs/common';
import type {
  AiFactor,
  AiRecommendation,
  AiRecommendationsResponse,
} from '@boletera/shared';
import { MetricsService } from '../../metrics/metrics.service';
import { AiCacheService } from '../ai-cache.service';
import { resolveAiRange } from '../ai-range';
import { round } from '../stats/stats';

/**
 * Actionable organizer recommendations from metrics aggregates.
 *
 * Method: weighted rule engine over sales-pace, inventory velocity and campaign
 * funnel aggregates already computed by MetricsService (no re-scan of raw rows
 * for those domains). Impact estimates are derived from the gap to expected
 * pace or remaining inventory × observed velocity.
 *
 * Complexity: O(E + Z + C) over cached metrics payloads; TTL 60s.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly cache: AiCacheService,
  ) {}

  async recommend(
    organizationId: string,
    opts: { from?: string; to?: string; eventId?: string; limit?: number },
  ): Promise<AiRecommendationsResponse> {
    const range = resolveAiRange(opts.from, opts.to);
    const limit = opts.limit ?? 25;
    const cacheKey = this.cache.wrapKey([
      'ai-recs',
      organizationId,
      opts.eventId,
      limit,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);
    return this.cache.wrap(cacheKey, 60, () =>
      this.compute(organizationId, range.from.toISOString(), range.to.toISOString(), opts.eventId, limit, range),
    );
  }

  private async compute(
    organizationId: string,
    from: string,
    to: string,
    eventId: string | undefined,
    limit: number,
    range: ReturnType<typeof resolveAiRange>,
  ): Promise<AiRecommendationsResponse> {
    const [pace, inventory, campaigns] = await Promise.all([
      this.metrics.getEventSalesPace(organizationId, from, to),
      this.metrics.getInventoryMetrics(organizationId, from, to, eventId),
      this.metrics.getCampaignMetrics(organizationId, from, to),
    ]);

    const recommendations: AiRecommendation[] = [];

    for (const event of pace.events) {
      if (eventId && event.eventId !== eventId) continue;
      if (event.riskLevel !== 'at_risk' && event.riskLevel !== 'critical') continue;
      const gapTickets = Math.max(
        0,
        Math.round((event.expectedPace - event.actualPace) * event.totalCapacity),
      );
      const priority =
        event.riskLevel === 'critical'
          ? 'urgent'
          : event.daysUntilEvent <= 7
            ? 'high'
            : 'medium';
      const factors: AiFactor[] = [
        {
          key: 'pace_delta',
          label: 'Desviación de ritmo',
          weight: event.paceDelta,
          value: event.paceDelta,
          explanation: `Ritmo actual ${round(event.actualPace * 100)}% vs esperado ${round(event.expectedPace * 100)}%.`,
        },
        {
          key: 'days_until',
          label: 'Días al evento',
          weight: event.daysUntilEvent,
          value: event.daysUntilEvent,
          explanation: `Faltan ${event.daysUntilEvent} días para el evento.`,
        },
      ];
      recommendations.push({
        id: `boost-pace-${event.eventId}`,
        kind: 'boost_sales_pace',
        priority,
        title: `Acelerar ventas de «${event.title}»`,
        action:
          event.daysUntilEvent <= 14
            ? 'Lanza una promoción de último momento (10–15%) y activa recordatorios a la lista de espera y carritos abandonados.'
            : 'Incrementa inversión en canales con mejor conversión y publica contenido del lineup/artistas para recuperar el ritmo esperado.',
        rationale: `El evento está ${event.riskLevel === 'critical' ? 'críticamente' : ''} por debajo del ritmo lineal esperado.`,
        estimatedImpact:
          gapTickets > 0
            ? {
                metric: 'tickets',
                value: gapTickets,
                unit: 'boletos para igualar ritmo esperado',
              }
            : null,
        confidence: gapTickets > 0 ? 'medium' : 'low',
        sufficiency: event.ticketsSold >= 10 ? 'sufficient' : 'limited',
        sampleSize: event.ticketsSold,
        entityType: 'event',
        entityId: event.eventId,
        entityLabel: event.title,
        factors,
      });

      if (event.occupancyPercent < 40 && event.daysUntilEvent <= 21) {
        recommendations.push({
          id: `review-pricing-${event.eventId}`,
          kind: 'review_pricing',
          priority: event.daysUntilEvent <= 7 ? 'high' : 'medium',
          title: `Revisar precios de «${event.title}»`,
          action:
            'Evalúa bajar 5–10% las zonas más lentas o abrir un tier early-bird residual; evita descuentos globales si VIP ya vende bien.',
          rationale: `Ocupación ${event.occupancyPercent}% con ${event.daysUntilEvent} días restantes.`,
          estimatedImpact: {
            metric: 'occupancy_pp',
            value: round(Math.min(12, (event.expectedPace - event.actualPace) * 100)),
            unit: 'puntos porcentuales de ocupación',
          },
          confidence: 'low',
          sufficiency: event.ticketsSold >= 5 ? 'limited' : 'insufficient',
          sampleSize: event.ticketsSold,
          entityType: 'event',
          entityId: event.eventId,
          entityLabel: event.title,
          factors,
        });
      }
    }

    for (const zone of inventory.byZone) {
      if (eventId && zone.eventId !== eventId) continue;
      if (zone.availabilityPercent < 55) continue;
      if (zone.daysToSellOut != null && zone.daysToSellOut < 30) continue;
      const stuck = zone.remainingQuantity;
      recommendations.push({
        id: `clear-zone-${zone.offerId}`,
        kind: 'clear_inventory_zone',
        priority: zone.availabilityPercent >= 80 ? 'high' : 'medium',
        title: `Desahogar zona «${zone.zone}» de «${zone.eventTitle}»`,
        action: `Crea un bundle o upgrade hacia ${zone.tierName}, o aplica un código exclusivo de zona con cupo limitado para mover ~${Math.min(stuck, Math.max(10, Math.round(stuck * 0.2)))} boletos.`,
        rationale: `${round(zone.availabilityPercent)}% del inventario de la zona sigue disponible; velocidad ${round(zone.sellThroughVelocity, 2)} boletos/día.`,
        estimatedImpact: {
          metric: 'tickets',
          value: Math.min(stuck, Math.max(5, Math.round(stuck * 0.15))),
          unit: 'boletos estimados recuperables',
        },
        confidence: zone.sellThroughVelocity > 0 ? 'medium' : 'low',
        sufficiency: zone.soldQuantity >= 5 ? 'limited' : 'insufficient',
        sampleSize: zone.soldQuantity,
        entityType: 'offer',
        entityId: zone.offerId,
        entityLabel: `${zone.eventTitle} · ${zone.zone}`,
        factors: [
          {
            key: 'availability',
            label: 'Disponibilidad de zona',
            weight: zone.availabilityPercent,
            value: zone.availabilityPercent,
            explanation: `${zone.remainingQuantity} de ${zone.totalQuantity} boletos libres.`,
          },
        ],
      });
    }

    for (const promo of campaigns.promotions) {
      if (promo.performance !== 'poor') continue;
      recommendations.push({
        id: `improve-campaign-${promo.promotionId}`,
        kind: 'improve_campaign',
        priority: 'medium',
        title: `Mejorar campaña «${promo.name}» (${promo.code})`,
        action:
          promo.usageCount === 0
            ? 'El código no se ha usado: verifícalo en creativos, acorta la URL y prográmolo en el canal de mayor tráfico.'
            : 'Ajusta el descuento o el mínimo de compra; prioriza audiencia que abandonó carrito en los últimos 7 días.',
        rationale: `Rendimiento pobre: ${promo.ordersAttributed} órdenes y ${round(promo.conversionRate)}% de conversión atribuida.`,
        estimatedImpact:
          promo.revenueAttributed >= 0
            ? {
                metric: 'revenue_mxn',
                value: round(Math.max(0, promo.discountGiven * 2)),
                unit: 'MXN potenciales si alcanza rendimiento promedio',
              }
            : null,
        confidence: promo.usageCount >= 10 ? 'medium' : 'low',
        sufficiency: promo.usageCount >= 5 ? 'limited' : 'insufficient',
        sampleSize: promo.usageCount,
        entityType: 'promotion',
        entityId: promo.promotionId,
        entityLabel: promo.code,
        factors: [
          {
            key: 'conversion',
            label: 'Conversión de campaña',
            weight: promo.conversionRate,
            value: promo.conversionRate,
            explanation: `${promo.ordersAttributed} órdenes / ${promo.usageCount} usos.`,
          },
        ],
      });
    }

    const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
    recommendations.sort(
      (a, b) => priorityRank[a.priority] - priorityRank[b.priority],
    );

    return {
      organizationId,
      dateRange: range.dateRange,
      method: {
        id: 'metrics_rule_engine',
        name: 'Motor de reglas sobre métricas',
        rationale:
          'Traduce ritmo de venta, inventario lento y campañas flojas (agregados de MetricsService) en acciones concretas con impacto estimado.',
      },
      recommendations: recommendations.slice(0, limit),
      generatedAt: new Date().toISOString(),
    };
  }
}
