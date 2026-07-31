'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ActivityFeed,
  AreaChart,
  Badge,
  Button,
  Card,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
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
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { queryKeys } from '@/lib/query-keys';
import {
  useMetricsAlerts,
  useResaleListings,
  useResaleMetrics,
  type ResaleListing,
} from '@/lib/queries';
import { resaleStatusLabel, statusTone } from '../fraud/_lib/labels';
import {
  SUITE_RANGE_OPTIONS,
  buildSuiteRange,
  type SuiteRangeKey,
} from '../fraud/_lib/range';
import styles from '../fraud/suite.module.scss';

const LISTING_LIMIT = 80;
const MARKUP_ANOMALY_PCT = 40;

type ResaleListingRow = ResaleListing & {
  sellerName?: string;
  fee?: string | number;
  listedAt?: string;
  soldAt?: string | null;
  delisted?: boolean;
  delistedReason?: string | null;
  pendingOffers?: number;
  priceComparison?: {
    originalPrice: number;
    resalePrice: number;
    markup: string;
  };
  ticket?: {
    code: string;
    event?: { id: string; title: string } | null;
    offer?: { name?: string; basePrice?: string | number } | null;
  };
};

function markupValue(listing: ResaleListingRow): number {
  const raw = listing.priceComparison?.markup;
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function askingAmount(listing: ResaleListingRow): number {
  const n = Number(listing.askingPrice);
  return Number.isFinite(n) ? n : 0;
}

export default function ResaleAdminPage() {
  const toast = useToast();
  const client = useQueryClient();
  const [rangeKey, setRangeKey] = useState<SuiteRangeKey>('30d');
  const range = useMemo(() => buildSuiteRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({ from: range.from, to: range.to }),
    [range.from, range.to],
  );

  const [filters, setFilters] = useState<FilterSelection>({});
  const [search, setSearch] = useState('');

  const metricsQ = useResaleMetrics(metricsParams);
  const listingsQ = useResaleListings(LISTING_LIMIT);
  const alertsQ = useMetricsAlerts(metricsParams);

  const cancelMutation = useMutation({
    mutationFn: (listingId: string) =>
      http(`/resale/listings/${listingId}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Listado cancelado');
      await client.invalidateQueries({ queryKey: queryKeys.resale.listings(LISTING_LIMIT) });
      await metricsQ.refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'No se pudo cancelar el listado');
    },
  });

  const listings = useMemo(
    () => (listingsQ.data ?? []) as ResaleListingRow[],
    [listingsQ.data],
  );
  const summary = metricsQ.data?.summary;
  const statusBreakdown = metricsQ.data?.statusBreakdown;
  const series = metricsQ.data?.series?.[0];

  const liquidity =
    summary && summary.activeListings + summary.soldListings > 0
      ? summary.soldListings / (summary.activeListings + summary.soldListings)
      : 0;

  const avgMarkup = useMemo(() => {
    if (!listings.length) return 0;
    const values = listings.map(markupValue).filter((n) => Number.isFinite(n));
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [listings]);

  const anomalies = useMemo(
    () =>
      listings
        .filter((l) => markupValue(l) >= MARKUP_ANOMALY_PCT && l.status.toUpperCase() === 'ACTIVE')
        .sort((a, b) => markupValue(b) - markupValue(a)),
    [listings],
  );

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const statuses = Array.from(new Set(listings.map((l) => l.status))).sort();
    return [
      {
        id: 'status',
        label: 'Estado',
        multiple: true,
        options: statuses.map((value) => ({
          value,
          label: resaleStatusLabel(value),
          count: listings.filter((l) => l.status === value).length,
        })),
      },
      {
        id: 'anomaly',
        label: 'Anomalías',
        multiple: false,
        options: [
          {
            value: 'high_markup',
            label: `Markup ≥ ${MARKUP_ANOMALY_PCT}%`,
            count: anomalies.length,
          },
        ],
      },
    ];
  }, [anomalies.length, listings]);

  const filtered = useMemo(() => {
    const statusFilter = filters.status ?? [];
    const anomalyOnly = (filters.anomaly ?? []).includes('high_markup');
    const q = search.trim().toLowerCase();
    return listings.filter((listing) => {
      if (statusFilter.length && !statusFilter.includes(listing.status)) return false;
      if (anomalyOnly && markupValue(listing) < MARKUP_ANOMALY_PCT) return false;
      if (!q) return true;
      const hay = [
        listing.id,
        listing.ticket?.code,
        listing.sellerName,
        listing.ticket?.event?.title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filters, listings, search]);

  const chartData = useMemo<ChartDatum[]>(() => {
    if (!series?.points.length) return [];
    return series.points.map((p) => ({
      label: formatDateTime(p.bucket).split(',')[0] ?? p.bucket.slice(5, 10),
      value: p.value,
    }));
  }, [series]);

  const statusSlices = useMemo(
    () =>
      (statusBreakdown?.rows ?? []).map((row) => ({
        id: row.key,
        label: resaleStatusLabel(row.label),
        value: row.value,
      })),
    [statusBreakdown],
  );

  const resaleAlerts = useMemo(
    () => (alertsQ.data?.alerts ?? []).filter((a) => a.domain === 'resale'),
    [alertsQ.data],
  );

  const recommendations = useMemo(() => {
    const items = [...resaleAlerts];
    if (anomalies.length > 0) {
      items.push({
        id: 'markup-anomalies',
        domain: 'resale',
        severity: anomalies.length >= 5 ? 'warning' : 'info',
        title: `${anomalies.length} listados con markup elevado`,
        explanation: `Hay listados activos con markup ≥ ${MARKUP_ANOMALY_PCT}% respecto al precio original.`,
        suggestedAction:
          'Revisa anti-scalping, cancela listados abusivos o ajusta el tope de markup del evento.',
        metricValue: anomalies.length,
        detectedAt: new Date().toISOString(),
      });
    }
    if (summary && summary.activeListings > 0 && liquidity < 0.15) {
      items.push({
        id: 'low-liquidity',
        domain: 'resale',
        severity: 'info',
        title: 'Liquidez baja en marketplace',
        explanation: `Solo se liquidó el ${formatPercent(liquidity)} de la oferta activa+vendida.`,
        suggestedAction:
          'Promueve el marketplace en confirmaciones de compra o revisa precios fuera de mercado.',
        metricValue: liquidity * 100,
        detectedAt: new Date().toISOString(),
      });
    }
    if (summary && summary.soldListings > 0 && summary.platformFees === 0) {
      items.push({
        id: 'fees-zero',
        domain: 'resale',
        severity: 'info',
        title: 'Sin fees de plataforma en el periodo',
        explanation: 'Hubo ventas de reventa pero las comisiones reportadas son 0.',
        suggestedAction: 'Verifica la configuración de fee de reventa en la organización.',
        detectedAt: new Date().toISOString(),
      });
    }
    return items.slice(0, 6);
  }, [anomalies.length, liquidity, resaleAlerts, summary]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    return [...listings]
      .sort((a, b) => {
        const ta = new Date(a.listedAt ?? 0).getTime();
        const tb = new Date(b.listedAt ?? 0).getTime();
        return tb - ta;
      })
      .slice(0, 14)
      .map((listing) => ({
        id: listing.id,
        actor: listing.sellerName ?? 'Vendedor',
        action:
          listing.status.toUpperCase() === 'SOLD'
            ? 'vendió'
            : listing.status.toUpperCase() === 'CANCELLED'
              ? 'canceló'
              : 'listó',
        target: listing.ticket?.code ?? listing.id,
        timestamp: listing.soldAt ?? listing.listedAt ?? new Date().toISOString(),
        detail: `${formatCurrency(askingAmount(listing))} · markup ${formatNumber(markupValue(listing), 1)}%`,
      }));
  }, [listings]);

  const columns = useMemo<DataTableColumn<ResaleListingRow>[]>(
    () => [
      {
        key: 'ticket',
        header: 'Boleto',
        width: 140,
        sortValue: (row) => row.ticket?.code ?? row.id,
        render: (row) => row.ticket?.code ?? row.id.slice(0, 8),
      },
      {
        key: 'event',
        header: 'Evento',
        width: 200,
        sortValue: (row) => row.ticket?.event?.title ?? '',
        render: (row) => row.ticket?.event?.title ?? '—',
      },
      {
        key: 'asking',
        header: 'Precio',
        width: 110,
        align: 'right',
        sortValue: (row) => askingAmount(row),
        render: (row) => formatCurrency(askingAmount(row)),
      },
      {
        key: 'markup',
        header: 'Markup',
        width: 100,
        align: 'right',
        sortValue: (row) => markupValue(row),
        render: (row) => {
          const m = markupValue(row);
          const anomalous = m >= MARKUP_ANOMALY_PCT;
          return (
            <span className={anomalous ? styles.anomaly : undefined}>
              {formatNumber(m, 1)}%
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Estado',
        width: 120,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={statusTone(row.status)} variant="outline">
            {resaleStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        key: 'offers',
        header: 'Ofertas',
        width: 90,
        align: 'right',
        sortValue: (row) => row.pendingOffers ?? 0,
        render: (row) => formatNumber(row.pendingOffers ?? 0),
      },
      {
        key: 'controls',
        header: 'Control',
        width: 120,
        resizable: false,
        render: (row) =>
          row.status.toUpperCase() === 'ACTIVE' ? (
            <Button
              size="sm"
              variant="danger"
              loading={cancelMutation.isPending && cancelMutation.variables === row.id}
              onClick={() => {
                if (
                  window.confirm(
                    `¿Cancelar el listado ${row.ticket?.code ?? row.id}? Esta acción retira la oferta del marketplace.`,
                  )
                ) {
                  cancelMutation.mutate(row.id);
                }
              }}
            >
              Cancelar
            </Button>
          ) : (
            <span className={styles.muted}>—</span>
          ),
      },
    ],
    [cancelMutation],
  );

  const loading = metricsQ.isPending && listingsQ.isPending;
  const error = metricsQ.error ?? listingsQ.error;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Riesgo y mercado"
        title="Reventa"
        description="Volumen, markup, liquidez del marketplace, listados, anomalías y controles."
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
          title="No se pudo cargar reventa"
          description={error instanceof Error ? error.message : 'Error desconocido'}
          illustration="error"
          tone="danger"
          action={
            <Button
              onClick={() => {
                void metricsQ.refetch();
                void listingsQ.refetch();
              }}
            >
              Reintentar
            </Button>
          }
        />
      ) : null}

      <section className={styles.kpiGrid} aria-label="Indicadores de reventa">
        <KpiCard
          label="GMV reventa"
          value={formatCurrency(summary?.grossGmv ?? 0, 0)}
          unit="MXN"
          tone="accent"
          loading={loading}
          hint={range.comparisonLabel}
        />
        <KpiCard
          label="Markup medio"
          value={`${formatNumber(avgMarkup, 1)}%`}
          tone={avgMarkup >= MARKUP_ANOMALY_PCT ? 'warning' : 'neutral'}
          loading={loading}
          hint="Sobre precio original"
        />
        <KpiCard
          label="Liquidez"
          value={formatPercent(liquidity)}
          tone={liquidity < 0.15 ? 'warning' : 'success'}
          loading={loading}
          hint="Vendidos / (activos + vendidos)"
        />
        <KpiCard
          label="Listados activos"
          value={formatNumber(summary?.activeListings ?? 0)}
          tone="info"
          loading={loading}
          hint={`Vendidos: ${formatNumber(summary?.soldListings ?? 0)} · Fees: ${formatCurrency(summary?.platformFees ?? 0, 0)}`}
        />
      </section>

      <div className={styles.grid}>
        <Section
          title="Volumen de listados"
          description="Nuevos listados diarios en el marketplace."
        >
          <Card padding="md">
            {metricsQ.isPending ? (
              <Skeleton height={220} />
            ) : chartData.length === 0 ? (
              <EmptyState
                size="sm"
                title="Sin serie temporal"
                description="Aún no hay listados en el periodo seleccionado."
                illustration="chart"
              />
            ) : (
              <AreaChart
                label="Nuevos listados diarios"
                series={[{ id: 'listings', name: 'Listados', data: chartData }]}
                height={220}
                formatValue={(v) => formatNumber(v)}
              />
            )}
          </Card>
        </Section>

        <Section title="Estado del marketplace" description="Composición de listados del periodo.">
          <Card padding="md">
            {metricsQ.isPending ? (
              <Skeleton height={220} />
            ) : statusSlices.length === 0 ? (
              <EmptyState
                size="sm"
                title="Sin desglose"
                description="No hay listados agregados en este periodo."
                illustration="chart"
              />
            ) : (
              <DonutChart
                label="Listados por estado"
                slices={statusSlices}
                centerLabel="Total"
                height={220}
              />
            )}
          </Card>
        </Section>
      </div>

      <Section
        title="Anomalías de markup"
        description={`Listados activos con markup ≥ ${MARKUP_ANOMALY_PCT}% respecto al precio original.`}
      >
        <Card padding="md">
          {listingsQ.isPending ? (
            <Skeleton height={120} />
          ) : anomalies.length === 0 ? (
            <EmptyState
              size="sm"
              title="Sin anomalías detectadas"
              description="Ningún listado activo supera el umbral de markup configurado."
              illustration="success"
              tone="success"
            />
          ) : (
            <ul className={styles.recs}>
              {anomalies.slice(0, 8).map((listing) => (
                <li key={listing.id} className={styles.rec}>
                  <div className={styles.tableMeta}>
                    <strong>{listing.ticket?.code ?? listing.id}</strong>
                    <Badge tone="danger">
                      {formatNumber(markupValue(listing), 1)}% markup
                    </Badge>
                  </div>
                  <p className={styles.recBody}>
                    {listing.ticket?.event?.title ?? 'Evento'} ·{' '}
                    {formatCurrency(askingAmount(listing))} vs original{' '}
                    {formatCurrency(listing.priceComparison?.originalPrice ?? 0)}
                    {listing.sellerName ? ` · ${listing.sellerName}` : ''}
                  </p>
                  <div className={styles.resolutionActions}>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={
                        cancelMutation.isPending && cancelMutation.variables === listing.id
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Cancelar el listado anómalo ${listing.ticket?.code ?? listing.id}?`,
                          )
                        ) {
                          cancelMutation.mutate(listing.id);
                        }
                      }}
                    >
                      Cancelar listado
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section
        title="Listados"
        description="Inventario del marketplace con controles de moderación."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void listingsQ.refetch();
              void metricsQ.refetch();
            }}
          >
            Actualizar
          </Button>
        }
      >
        <Card padding="md" className={styles.panelBody}>
          <div className={styles.tableMeta}>
            <FilterBar
              filters={filterDefs}
              value={filters}
              onChange={setFilters}
              search={{
                value: search,
                onChange: setSearch,
                placeholder: 'Buscar boleto, evento o vendedor…',
              }}
            />
            <ul className={styles.inlineStats}>
              <li>
                Precio medio pedido:{' '}
                <strong>{formatCurrency(summary?.averageAskingPrice ?? 0, 0)}</strong>
              </li>
              <li>
                Precio medio vendido:{' '}
                <strong>{formatCurrency(summary?.averageSoldPrice ?? 0, 0)}</strong>
              </li>
            </ul>
          </div>

          {listingsQ.isPending ? (
            <Skeleton height={280} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Sin listados"
              description="No hay listados que coincidan con los filtros actuales."
              illustration="inbox"
              hints={[
                'Amplía el periodo de métricas',
                'Quita el filtro de anomalías',
                'Verifica que la reventa esté habilitada en la organización',
              ]}
            />
          ) : (
            <DataTable
              label="Listados de reventa"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              defaultSort={{ key: 'markup', direction: 'desc' }}
              maxHeight={420}
            />
          )}
        </Card>
      </Section>

      <div className={styles.grid}>
        <Section title="Actividad" description="Altas, ventas y cancelaciones recientes.">
          <Card padding="md">
            <ActivityFeed
              label="Actividad de reventa"
              items={activityItems}
              loading={listingsQ.isPending}
              empty={
                <EmptyState
                  size="sm"
                  title="Sin actividad"
                  description="Todavía no hay listados en el marketplace."
                  illustration="inbox"
                />
              }
            />
          </Card>
        </Section>

        <Section title="Recomendaciones" description="Acciones sugeridas del mercado secundario.">
          <Card padding="md">
            {recommendations.length === 0 ? (
              <EmptyState
                size="sm"
                title="Mercado saludable"
                description="Volumen y markup dentro de rangos esperados."
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
