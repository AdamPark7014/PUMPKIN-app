import { Injectable } from '@nestjs/common';
import type { AiExecutiveNarrativeResponse } from '@boletera/shared';
import { MetricsService } from '../../metrics/metrics.service';
import { AiCacheService } from '../ai-cache.service';
import { resolveAiRange } from '../ai-range';
import { TemplateNarrativeRenderer } from '../narrative/template-narrative-renderer';
import { round } from '../stats/stats';

/**
 * Deterministic executive narratives from real aggregates.
 *
 * Method: template + rules over MetricsService.getExecutiveSummary /
 * getEventSalesPace / getOrdersPaymentsMetrics. Never invents figures that
 * are not present in the aggregates. LLM boundary: AiNarrativeRenderer
 * (TemplateNarrativeRenderer by default).
 *
 * Complexity: O(1) parallel metrics calls; cached 60s.
 */
@Injectable()
export class ExecutiveNarrativeService {
  private readonly renderer = new TemplateNarrativeRenderer();

  constructor(
    private readonly metrics: MetricsService,
    private readonly cache: AiCacheService,
  ) {}

  async narrate(
    organizationId: string,
    opts: { from?: string; to?: string },
  ): Promise<AiExecutiveNarrativeResponse> {
    const range = resolveAiRange(opts.from, opts.to);
    const cacheKey = this.cache.wrapKey([
      'ai-narrative',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);
    return this.cache.wrap(cacheKey, 60, () =>
      this.compute(organizationId, range),
    );
  }

  private async compute(
    organizationId: string,
    range: ReturnType<typeof resolveAiRange>,
  ): Promise<AiExecutiveNarrativeResponse> {
    const from = range.from.toISOString();
    const to = range.to.toISOString();
    const [executive, pace, orders] = await Promise.all([
      this.metrics.getExecutiveSummary(organizationId, from, to),
      this.metrics.getEventSalesPace(organizationId, from, to),
      this.metrics.getOrdersPaymentsMetrics(organizationId, from, to),
    ]);

    const kpisCited = [
      {
        key: executive.kpis.grossRevenue.key,
        label: executive.kpis.grossRevenue.label,
        value: executive.kpis.grossRevenue.value,
        previousValue: executive.kpis.grossRevenue.previousValue,
        deltaPercent: executive.kpis.grossRevenue.deltaPercent,
        unit: 'mxn' as const,
      },
      {
        key: executive.kpis.ticketsSold.key,
        label: executive.kpis.ticketsSold.label,
        value: executive.kpis.ticketsSold.value,
        previousValue: executive.kpis.ticketsSold.previousValue,
        deltaPercent: executive.kpis.ticketsSold.deltaPercent,
        unit: 'count' as const,
      },
      {
        key: executive.kpis.ordersCompleted.key,
        label: executive.kpis.ordersCompleted.label,
        value: executive.kpis.ordersCompleted.value,
        previousValue: executive.kpis.ordersCompleted.previousValue,
        deltaPercent: executive.kpis.ordersCompleted.deltaPercent,
        unit: 'count' as const,
      },
      {
        key: orders.kpis.approvalRate.key,
        label: orders.kpis.approvalRate.label,
        value: orders.kpis.approvalRate.value,
        previousValue: orders.kpis.approvalRate.previousValue,
        deltaPercent: orders.kpis.approvalRate.deltaPercent,
        unit: 'percent' as const,
      },
      {
        key: orders.kpis.refundRate.key,
        label: orders.kpis.refundRate.label,
        value: orders.kpis.refundRate.value,
        previousValue: orders.kpis.refundRate.previousValue,
        deltaPercent: orders.kpis.refundRate.deltaPercent,
        unit: 'percent' as const,
      },
    ];

    const facts: string[] = [];
    const highlights: string[] = [];
    const watchouts: string[] = [];

    const rev = executive.kpis.grossRevenue;
    facts.push(
      `En el periodo, los ingresos brutos fueron ${this.mxn(rev.value)} MXN` +
        (rev.deltaPercent == null
          ? ' (sin base comparable en el periodo anterior).'
          : ` (${this.signedPct(rev.deltaPercent)} vs periodo anterior).`),
    );
    facts.push(
      `Se vendieron ${round(executive.kpis.ticketsSold.value)} boletos en ${round(executive.kpis.ordersCompleted.value)} órdenes completadas.`,
    );

    if (rev.deltaPercent != null && rev.deltaPercent >= 10) {
      highlights.push(
        `Los ingresos crecieron ${round(rev.deltaPercent)}% respecto al periodo comparable.`,
      );
    }
    if (
      executive.kpis.ticketsSold.deltaPercent != null &&
      executive.kpis.ticketsSold.deltaPercent >= 10
    ) {
      highlights.push(
        `El volumen de boletos aumentó ${round(executive.kpis.ticketsSold.deltaPercent)}%.`,
      );
    }

    const topChannel = executive.revenueByChannel.rows[0];
    if (topChannel && executive.revenueByChannel.total > 0) {
      highlights.push(
        `El canal líder fue ${topChannel.label} con ${round(topChannel.percentOfTotal ?? 0)}% de los ingresos.`,
      );
    }

    if (rev.deltaPercent != null && rev.deltaPercent <= -10) {
      watchouts.push(
        `Los ingresos cayeron ${round(Math.abs(rev.deltaPercent))}% frente al periodo anterior.`,
      );
    }
    if (orders.kpis.refundRate.value >= 8) {
      watchouts.push(
        `La tasa de reembolsos está en ${round(orders.kpis.refundRate.value)}%; revisa políticas y calidad de eventos recientes.`,
      );
    }
    if (
      orders.kpis.approvalRate.value > 0 &&
      orders.kpis.approvalRate.value < 85
    ) {
      watchouts.push(
        `La aprobación de pagos es ${round(orders.kpis.approvalRate.value)}%; conviene revisar denegaciones del gateway.`,
      );
    }

    const atRisk = pace.atRisk.slice(0, 3);
    for (const event of atRisk) {
      watchouts.push(
        `«${event.title}» está en riesgo de ritmo (ocupación ${event.occupancyPercent}%, ${event.daysUntilEvent} días).`,
      );
    }

    if (
      executive.kpis.grossRevenue.value === 0 &&
      executive.kpis.ticketsSold.value === 0
    ) {
      facts.length = 0;
      facts.push(
        'No se registraron ingresos ni boletos vendidos en el periodo seleccionado.',
      );
    }

    const narrative = this.renderer.render({
      language: 'es-MX',
      facts,
      highlights,
      watchouts,
    });

    return {
      organizationId,
      dateRange: range.dateRange,
      comparisonRange: range.comparisonRange,
      language: 'es-MX',
      timezone: 'America/Mexico_City',
      currency: 'MXN',
      method: {
        id: 'template_rules_from_metrics',
        name: 'Plantillas deterministas sobre métricas',
        rationale:
          'Redacción basada en KPIs reales del resumen ejecutivo, órdenes y ritmo de eventos; sin modelos generativos.',
      },
      narrative,
      highlights,
      watchouts,
      kpisCited,
      generatedAt: new Date().toISOString(),
    };
  }

  private mxn(n: number): string {
    return new Intl.NumberFormat('es-MX', {
      maximumFractionDigits: 0,
    }).format(n);
  }

  private signedPct(n: number): string {
    const r = round(n);
    return `${r > 0 ? '+' : ''}${r}%`;
  }
}
