'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ActivityFeed,
  Badge,
  BarChart,
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  formatDateTime,
  formatNumber,
  formatPercent,
  FunnelChart,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
  type ActivityItem,
  type ChartDatum,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import type { MetricsAlert } from '@boletera/shared';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/lib/use-session';
import { useMetricsAlerts, useWaitlist, useWaitlistMetrics } from '@/lib/queries';
import type { WaitlistRow } from '@/lib/platform-api';
import { statusTone, waitlistStatusLabel } from '../fraud/_lib/labels';
import {
  SUITE_RANGE_OPTIONS,
  buildSuiteRange,
  type SuiteRangeKey,
} from '../fraud/_lib/range';
import styles from '../fraud/suite.module.scss';

/** Campos adicionales de GET /waitlist/organization/:id. */
type WaitlistEntryRow = WaitlistRow & {
  offerId?: string | null;
  priority?: number;
  notifiedAt?: string | null;
  convertedAt?: string | null;
  event: WaitlistRow['event'] & { startsAt?: string };
};

type EventBucket = {
  eventId: string;
  title: string;
  slug: string;
  entries: WaitlistEntryRow[];
  pending: number;
  notified: number;
  converted: number;
  demand: number;
};

type ZoneBucket = {
  key: string;
  label: string;
  count: number;
  quantity: number;
};

function zoneLabel(offerId: string | null | undefined): string {
  if (!offerId) return 'Sin zona / oferta';
  return `Oferta ${offerId.slice(0, 8)}`;
}

export default function WaitlistPage() {
  const toast = useToast();
  const client = useQueryClient();
  const { organizationId } = useSession();
  const [rangeKey, setRangeKey] = useState<SuiteRangeKey>('30d');
  const range = useMemo(() => buildSuiteRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({ from: range.from, to: range.to }),
    [range.from, range.to],
  );

  const [filters, setFilters] = useState<FilterSelection>({});
  const [search, setSearch] = useState('');

  const metricsQ = useWaitlistMetrics(metricsParams);
  const waitlistQ = useWaitlist(organizationId);
  const alertsQ = useMetricsAlerts(metricsParams);

  const notifyMutation = useMutation({
    mutationFn: ({ eventId, limit = 50 }: { eventId: string; limit?: number }) =>
      http<{ notified: number }>(`/waitlist/event/${eventId}/notify?limit=${limit}`, {
        method: 'POST',
      }),
    onSettled: () => {
      if (organizationId) {
        void client.invalidateQueries({
          queryKey: queryKeys.waitlist.organization(organizationId),
        });
      }
    },
  });

  const rows = useMemo(
    () => (waitlistQ.data ?? []) as WaitlistEntryRow[],
    [waitlistQ.data],
  );
  const summary = metricsQ.data?.summary;
  const byEventMetrics = metricsQ.data?.byEvent ?? [];
  const funnel = metricsQ.data?.funnel;

  const eventBuckets = useMemo(() => {
    const map = new Map<string, EventBucket>();
    for (const row of rows) {
      const existing = map.get(row.event.id);
      if (!existing) {
        map.set(row.event.id, {
          eventId: row.event.id,
          title: row.event.title,
          slug: row.event.slug,
          entries: [row],
          pending: row.status.toUpperCase() === 'PENDING' ? 1 : 0,
          notified: row.status.toUpperCase() === 'NOTIFIED' ? 1 : 0,
          converted: row.status.toUpperCase() === 'CONVERTED' ? 1 : 0,
          demand: row.quantity,
        });
      } else {
        existing.entries.push(row);
        existing.demand += row.quantity;
        if (row.status.toUpperCase() === 'PENDING') existing.pending += 1;
        if (row.status.toUpperCase() === 'NOTIFIED') existing.notified += 1;
        if (row.status.toUpperCase() === 'CONVERTED') existing.converted += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.pending - a.pending || b.demand - a.demand);
  }, [rows]);

  const zoneBuckets = useMemo(() => {
    const map = new Map<string, ZoneBucket>();
    for (const row of rows) {
      const key = row.offerId ?? 'none';
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          label: zoneLabel(row.offerId),
          count: 1,
          quantity: row.quantity,
        });
      } else {
        existing.count += 1;
        existing.quantity += row.quantity;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [rows]);

  const opportunities = useMemo(
    () =>
      eventBuckets
        .filter((e) => e.pending >= 3)
        .map((e) => {
          const denom = e.pending + e.notified + e.converted;
          const conversion = denom > 0 ? e.converted / denom : 0;
          return { ...e, conversion };
        })
        .sort((a, b) => b.pending - a.pending || a.conversion - b.conversion)
        .slice(0, 6),
    [eventBuckets],
  );

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const statuses = Array.from(new Set(rows.map((r) => r.status))).sort();
    const events = eventBuckets.map((e) => ({
      value: e.eventId,
      label: e.title,
      count: e.entries.length,
    }));
    return [
      {
        id: 'status',
        label: 'Estado',
        multiple: true,
        options: statuses.map((value) => ({
          value,
          label: waitlistStatusLabel(value),
          count: rows.filter((r) => r.status === value).length,
        })),
      },
      {
        id: 'event',
        label: 'Evento',
        multiple: true,
        options: events,
      },
    ];
  }, [eventBuckets, rows]);

  const filteredRows = useMemo(() => {
    const statusFilter = filters.status ?? [];
    const eventFilter = filters.event ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter.length && !statusFilter.includes(row.status)) return false;
      if (eventFilter.length && !eventFilter.includes(row.event.id)) return false;
      if (!q) return true;
      const hay = [row.email, row.firstName, row.lastName, row.event.title, row.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filters, rows, search]);

  const demandChart = useMemo<ChartDatum[]>(() => {
    const source =
      byEventMetrics.length > 0
        ? byEventMetrics.slice(0, 10).map((r) => ({ label: r.label, value: r.value }))
        : eventBuckets
            .slice(0, 10)
            .map((e) => ({ label: e.title, value: e.demand }));
    return source.map((d) => ({
      label: d.label.length > 18 ? `${d.label.slice(0, 16)}…` : d.label,
      value: d.value,
    }));
  }, [byEventMetrics, eventBuckets]);

  const funnelStages = useMemo(
    () =>
      (funnel?.stages ?? []).map((stage) => ({
        id: stage.key,
        label: stage.label,
        value: stage.count,
      })),
    [funnel],
  );

  const waitlistAlerts = useMemo(
    () => (alertsQ.data?.alerts ?? []).filter((a) => a.domain === 'waitlist'),
    [alertsQ.data],
  );

  const recommendations = useMemo(() => {
    const items: MetricsAlert[] = [...waitlistAlerts];
    if (opportunities.length > 0) {
      const top = opportunities[0];
      items.push({
        id: 'notify-opportunity',
        domain: 'waitlist',
        severity: top.pending >= 20 ? 'warning' : 'info',
        title: `Demanda acumulada en ${top.title}`,
        explanation: `Hay ${top.pending} fans en espera (${formatNumber(top.demand)} boletos de demanda).`,
        suggestedAction:
          'Si hay inventario liberado, notifica el lote pendiente desde la oportunidad.',
        entityType: 'event',
        entityId: top.eventId,
        entityLabel: top.title,
        metricValue: top.pending,
        detectedAt: new Date().toISOString(),
      });
    }
    if (summary && summary.conversionRate < 10 && summary.notified > 5) {
      items.push({
        id: 'low-conversion',
        domain: 'waitlist',
        severity: 'warning',
        title: 'Conversión baja tras notificación',
        explanation: `La tasa de conversión del periodo es ${formatNumber(summary.conversionRate, 1)}% con ${summary.notified} notificados.`,
        suggestedAction:
          'Acorta la ventana de oferta, prioriza por cantidad o revisa precios del evento.',
        metricValue: summary.conversionRate,
        detectedAt: new Date().toISOString(),
      });
    }
    if (summary && summary.pending === 0 && summary.converted > 0) {
      items.push({
        id: 'queue-clear',
        domain: 'waitlist',
        severity: 'info',
        title: 'Cola al día',
        explanation: 'No hay pendientes; la demanda reciente ya fue atendida o convertida.',
        suggestedAction: 'Mantén monitoreo en eventos próximos a sold-out.',
        detectedAt: new Date().toISOString(),
      });
    }
    return items.slice(0, 6);
  }, [opportunities, summary, waitlistAlerts]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    return [...rows]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 16)
      .map((row) => ({
        id: row.id,
        actor: row.email,
        action:
          row.status.toUpperCase() === 'CONVERTED'
            ? 'convirtió'
            : row.status.toUpperCase() === 'NOTIFIED'
              ? 'fue notificado para'
              : 'se unió a',
        target: row.event.title,
        timestamp: row.convertedAt ?? row.notifiedAt ?? row.createdAt,
        detail: `${formatNumber(row.quantity)} boleto(s) · ${waitlistStatusLabel(row.status)}`,
      }));
  }, [rows]);

  const columns = useMemo<DataTableColumn<WaitlistEntryRow>[]>(
    () => [
      {
        key: 'email',
        header: 'Fan',
        width: 200,
        sortValue: (row) => row.email,
        render: (row) => row.email,
      },
      {
        key: 'event',
        header: 'Evento',
        width: 200,
        sortValue: (row) => row.event.title,
        render: (row) => row.event.title,
      },
      {
        key: 'zone',
        header: 'Zona / oferta',
        width: 140,
        sortValue: (row) => row.offerId ?? '',
        render: (row) => zoneLabel(row.offerId),
      },
      {
        key: 'quantity',
        header: 'Cant.',
        width: 80,
        align: 'right',
        sortValue: (row) => row.quantity,
        render: (row) => formatNumber(row.quantity),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 120,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={statusTone(row.status)} variant="outline">
            {waitlistStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        key: 'createdAt',
        header: 'Registro',
        width: 160,
        sortValue: (row) => new Date(row.createdAt).getTime(),
        render: (row) => formatDateTime(row.createdAt),
      },
    ],
    [],
  );

  const loading = metricsQ.isPending && waitlistQ.isPending;
  const error = metricsQ.error ?? waitlistQ.error;
  const conversionRatio = (summary?.conversionRate ?? 0) / 100;

  async function notifyEvent(eventId: string, title: string) {
    if (!organizationId) {
      toast.error('No hay organización activa');
      return;
    }
    if (
      !window.confirm(
        `¿Notificar hasta 50 fans en espera de “${title}”? Se enviará correo solo a entradas PENDING.`,
      )
    ) {
      return;
    }
    try {
      const result = await notifyMutation.mutateAsync({ eventId, limit: 50 });
      toast.success(`Notificados: ${formatNumber(result.notified)}`);
      void waitlistQ.refetch();
      void metricsQ.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo notificar el lote');
    }
  }

  if (!organizationId && !waitlistQ.isPending) {
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow="Riesgo y mercado"
          title="Lista de espera"
          description="Demanda, conversión y notificación segura."
        />
        <EmptyState
          title="Sin organización"
          description="Tu sesión no tiene organización asignada. No se puede cargar la lista de espera."
          illustration="error"
          tone="danger"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Riesgo y mercado"
        title="Lista de espera"
        description="Demanda por evento y zona, conversión, oportunidades y notificación segura."
        actions={
          <SegmentedControl
            label="Periodo"
            size="sm"
            value={rangeKey}
            onValueChange={setRangeKey}
            options={SUITE_RANGE_OPTIONS.map((key) => ({
              value: key,
              label: buildSuiteRange(key).label,
            }))}
          />
        }
      />

      {error ? (
        <EmptyState
          title="No se pudo cargar la lista de espera"
          description={error instanceof Error ? error.message : 'Error desconocido'}
          illustration="error"
          tone="danger"
          action={
            <Button
              onClick={() => {
                void metricsQ.refetch();
                void waitlistQ.refetch();
              }}
            >
              Reintentar
            </Button>
          }
        />
      ) : null}

      <section className={styles.kpiGrid} aria-label="Indicadores de lista de espera">
        <KpiCard
          label="En espera"
          value={formatNumber(summary?.pending ?? 0)}
          tone="warning"
          loading={loading}
          hint={range.comparisonLabel}
        />
        <KpiCard
          label="Notificados"
          value={formatNumber(summary?.notified ?? 0)}
          tone="info"
          loading={loading}
          hint="Lotes enviados"
        />
        <KpiCard
          label="Convertidos"
          value={formatNumber(summary?.converted ?? 0)}
          tone="success"
          loading={loading}
          hint={`Expirados: ${formatNumber(summary?.expired ?? 0)}`}
        />
        <KpiCard
          label="Conversión"
          value={formatPercent(conversionRatio)}
          tone={conversionRatio < 0.1 ? 'warning' : 'accent'}
          loading={loading}
          hint="Convertidos / total periodo"
        />
      </section>

      <div className={styles.grid}>
        <Section title="Demanda por evento" description="Volumen de registros en lista de espera.">
          <Card padding="md">
            {metricsQ.isPending && waitlistQ.isPending ? (
              <Skeleton height={240} />
            ) : demandChart.length === 0 ? (
              <EmptyState
                size="sm"
                title="Sin demanda registrada"
                description="Cuando un evento se agote, los fans aparecerán aquí."
                illustration="chart"
                action={
                  <Link href="/events">
                    <Button type="button" size="sm" variant="secondary">
                      Ver eventos
                    </Button>
                  </Link>
                }
                secondaryAction={
                  <Link href="/inventory">
                    <Button type="button" size="sm" variant="ghost">
                      Inventario
                    </Button>
                  </Link>
                }
              />
            ) : (
              <BarChart
                label="Demanda por evento"
                series={[{ id: 'demand', name: 'Registros', data: demandChart }]}
                height={240}
                formatValue={(v) => formatNumber(v)}
              />
            )}
          </Card>
        </Section>

        <Section title="Embudo de conversión" description="De lista a compra.">
          <Card padding="md">
            {metricsQ.isPending ? (
              <Skeleton height={240} />
            ) : funnelStages.length === 0 || funnelStages.every((s) => s.value === 0) ? (
              <EmptyState
                size="sm"
                title="Sin embudo"
                description="Aún no hay suficientes etapas con volumen."
                illustration="chart"
              />
            ) : (
              <FunnelChart
                label="Embudo de lista de espera"
                stages={funnelStages}
                conversionBase="total"
              />
            )}
          </Card>
        </Section>
      </div>

      <Section
        title="Demanda por zona / oferta"
        description="Agrupación por oferta preferida cuando el fan la indicó al unirse."
      >
        <Card padding="md">
          {waitlistQ.isPending ? (
            <Skeleton height={100} />
          ) : zoneBuckets.length === 0 ? (
            <p className={styles.muted}>Sin registros para desglosar por zona.</p>
          ) : (
            <div className={styles.zoneGrid}>
              {zoneBuckets.slice(0, 8).map((zone) => (
                <article key={zone.key} className={styles.zoneCard}>
                  <span>{zone.label}</span>
                  <strong>{formatNumber(zone.quantity)}</strong>
                  <p className={styles.muted}>
                    {formatNumber(zone.count)} registros
                  </p>
                </article>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section
        title="Oportunidades de notificación"
        description="Eventos con cola pendiente listos para liberar cupo."
      >
        <Card padding="md">
          {waitlistQ.isPending ? (
            <Skeleton height={140} />
          ) : opportunities.length === 0 ? (
            <EmptyState
              size="sm"
              title="Sin oportunidades abiertas"
              description="No hay eventos con al menos 3 fans pendientes."
              illustration="inbox"
              action={
                <Link href="/events">
                  <Button type="button" size="sm" variant="secondary">
                    Revisar eventos
                  </Button>
                </Link>
              }
              secondaryAction={
                <Link href="/inventory">
                  <Button type="button" size="sm" variant="ghost">
                    Ver cupos
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className={styles.recs}>
              {opportunities.map((opp) => (
                <li key={opp.eventId} className={styles.opportunity}>
                  <strong>{opp.title}</strong>
                  <p className={styles.muted}>
                    {formatNumber(opp.pending)} pendientes · demanda{' '}
                    {formatNumber(opp.demand)} · conversión local{' '}
                    {formatPercent(opp.conversion)}
                  </p>
                  <div className={styles.resolutionActions}>
                    <Button
                      size="sm"
                      loading={
                        notifyMutation.isPending &&
                        notifyMutation.variables?.eventId === opp.eventId
                      }
                      disabled={!organizationId}
                      onClick={() => void notifyEvent(opp.eventId, opp.title)}
                    >
                      Notificar lote
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section
        title="Registros"
        description="Cola operativa por fan, evento y zona."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void waitlistQ.refetch();
              void metricsQ.refetch();
            }}
          >
            Actualizar
          </Button>
        }
      >
        <Card padding="md" className={styles.panelBody}>
          <FilterBar
            filters={filterDefs}
            value={filters}
            onChange={setFilters}
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Buscar email, nombre o evento…',
            }}
          />

          {waitlistQ.isPending ? (
            <Skeleton height={280} />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              title="Sin registros"
              description="No hay entradas en lista de espera para tu organización con estos filtros."
              illustration="seats"
              hints={[
                'Publica eventos que puedan agotarse',
                'Limpia filtros de estado o evento',
                'Amplía el periodo de métricas',
              ]}
              action={
                rows.length === 0 ? (
                  <Link href="/events/new">
                    <Button type="button">Crear evento</Button>
                  </Link>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setFilters({});
                      setSearch('');
                    }}
                  >
                    Limpiar filtros
                  </Button>
                )
              }
              secondaryAction={
                rows.length === 0 ? (
                  <Link href="/inventory">
                    <Button type="button" variant="secondary">
                      Ver inventario
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              label="Registros de lista de espera"
              columns={columns}
              data={filteredRows}
              rowKey={(row) => row.id}
              defaultSort={{ key: 'createdAt', direction: 'desc' }}
              maxHeight={420}
            />
          )}
        </Card>
      </Section>

      <div className={styles.grid}>
        <Section title="Actividad" description="Altas, notificaciones y conversiones recientes.">
          <Card padding="md">
            <ActivityFeed
              label="Actividad de lista de espera"
              items={activityItems}
              loading={waitlistQ.isPending}
              empty={
                <EmptyState
                  size="sm"
                  title="Sin actividad"
                  description="Todavía no hay movimiento en la lista de espera."
                  illustration="inbox"
                  action={
                    <Link href="/events">
                      <Button type="button" size="sm" variant="secondary">
                        Ir a eventos
                      </Button>
                    </Link>
                  }
                />
              }
            />
          </Card>
        </Section>

        <Section title="Recomendaciones" description="Próximos pasos basados en demanda real.">
          <Card padding="md">
            {recommendations.length === 0 ? (
              <EmptyState
                size="sm"
                title="Sin acciones urgentes"
                description="La demanda y la conversión están en rangos normales."
                illustration="success"
                tone="success"
              />
            ) : (
              <ul className={styles.recs}>
                {recommendations.map((rec) => (
                  <li key={rec.id} className={styles.rec}>
                    <Badge
                      tone={
                        rec.severity === 'critical'
                          ? 'danger'
                          : rec.severity === 'warning'
                            ? 'warning'
                            : 'info'
                      }
                    >
                      {rec.severity}
                    </Badge>
                    <p className={styles.recTitle}>{rec.title}</p>
                    <p className={styles.recBody}>{rec.explanation}</p>
                    <p className={styles.recAction}>{rec.suggestedAction}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      </div>
    </div>
  );
}
