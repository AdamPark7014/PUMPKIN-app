'use client';

import { Suspense, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  SegmentedControl,
  Timeline,
  type DataTableColumn,
  type FilterDefinition,
  type TimelineItem,
  type TimelineTone,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import {
  useMetricsTimeseries,
  usePayouts,
  useSettlementReport,
  useSettlementsMetrics,
} from '@/lib/queries';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/lib/use-session';
import { AgingPanel } from './_components/AgingPanel';
import { CompletePayoutModal } from './_components/CompletePayoutModal';
import { PayoutCalendar } from './_components/PayoutCalendar';
import { PayoutDetailDrawer } from './_components/PayoutDetailDrawer';
import { ReconciliationPanel } from './_components/ReconciliationPanel';
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatRatio,
  toCents,
} from './_lib/money';
import {
  buildAging,
  buildCalendar,
  buildReconciliation,
  canCompletePayout,
  normalizeChannels,
  normalizePayouts,
  PAYOUT_STATUS_META,
  PAYOUT_STATUSES,
  payoutMatchesQuery,
  payoutTotals,
} from './_lib/payouts';
import { PERIOD_OPTIONS, periodRange } from './_lib/period';
import { alignSeries, toChartSeries } from './_lib/series';
import type { ChannelRow, PayoutRow, PayoutStatus, SettlementPeriod } from './_lib/types';
import { usePayoutsUrlState } from './_lib/use-payouts-url-state';
import styles from './payouts.module.scss';

/** Espejo de `@Roles('ADMIN', 'SUPER_ADMIN')` en `POST /admin/payouts/:id/complete`. */
const MANAGE_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

const STATUS_FILTERS: FilterDefinition[] = [
  {
    id: 'status',
    label: 'Estado',
    multiple: true,
    options: PAYOUT_STATUSES.map((status) => ({
      value: status,
      label: PAYOUT_STATUS_META[status].label,
    })),
  },
];

function timelineTone(status: PayoutStatus): TimelineTone {
  return PAYOUT_STATUS_META[status].tone;
}

function PayoutsCockpit() {
  const session = useSession();
  const organizationId = session.organizationId;
  const canManage = MANAGE_ROLES.has(session.role?.toUpperCase() ?? '');
  const toast = useToast();
  const {
    period,
    statuses,
    q,
    selectedId,
    filterSelection,
    setPeriod,
    setSearch,
    setFilterSelection,
    setSelectedId,
  } = usePayoutsUrlState();

  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [confirming, setConfirming] = useState<PayoutRow | null>(null);

  const range = useMemo(() => periodRange(period), [period]);
  const metricsParams = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      from: range.from,
      to: range.to,
    }),
    [organizationId, range.from, range.to],
  );

  const payoutsQuery = usePayouts();
  const settlementsQuery = useSettlementsMetrics(metricsParams);
  const reportQuery = useSettlementReport(organizationId, period);
  const revenueSeriesQuery = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'revenue',
  });
  const refundsSeriesQuery = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'refunds',
  });
  const queryClient = useQueryClient();
  // useCompletePayout del shared query no envía referenceId; el backend lo exige.
  const completePayout = useMutation({
    mutationFn: ({
      payoutId,
      referenceId,
    }: {
      payoutId: string;
      referenceId: string;
    }) =>
      http(`/admin/payouts/${payoutId}/complete`, {
        method: 'POST',
        body: { referenceId },
      }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payouts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.metrics.all }),
      ]);
    },
  });

  const payouts = useMemo(
    () => normalizePayouts(payoutsQuery.data, settlementsQuery.data),
    [payoutsQuery.data, settlementsQuery.data],
  );
  const channels = useMemo(
    () => normalizeChannels(payoutsQuery.data),
    [payoutsQuery.data],
  );
  const totals = useMemo(() => payoutTotals(payouts), [payouts]);
  const aging = useMemo(() => buildAging(payouts), [payouts]);
  const calendar = useMemo(
    () => buildCalendar(payouts, calendarCursor),
    [calendarCursor, payouts],
  );

  const filteredPayouts = useMemo(() => {
    return payouts.filter((row) => {
      const statusOk = statuses.length === 0 || statuses.includes(row.status);
      return statusOk && payoutMatchesQuery(row, q);
    });
  }, [payouts, q, statuses]);

  const periodPayouts = useMemo(() => {
    const fromMs = new Date(range.from).getTime();
    const toMs = new Date(range.to).getTime();
    return payouts.filter((row) => {
      const end = row.periodEnd ? new Date(row.periodEnd).getTime() : NaN;
      return Number.isFinite(end) && end >= fromMs && end < toMs;
    });
  }, [payouts, range.from, range.to]);

  const reconciliation = useMemo(
    () =>
      buildReconciliation(
        reportQuery.data,
        settlementsQuery.data,
        channels,
        periodPayouts,
      ),
    [channels, periodPayouts, reportQuery.data, settlementsQuery.data],
  );

  const chartSeries = useMemo(
    () =>
      alignSeries([
        toChartSeries(revenueSeriesQuery.data, {
          id: 'revenue',
          name: 'Ingreso bruto',
          color: '#2563eb',
        }),
        toChartSeries(refundsSeriesQuery.data, {
          id: 'refunds',
          name: 'Reembolsos',
          color: '#f97316',
        }),
      ]),
    [refundsSeriesQuery.data, revenueSeriesQuery.data],
  );

  const selected = useMemo(
    () => payouts.find((row) => row.id === selectedId) ?? null,
    [payouts, selectedId],
  );

  const summary = settlementsQuery.data?.summary;
  const loading = payoutsQuery.isPending || settlementsQuery.isPending;
  const overdueAging = useMemo(
    () =>
      aging
        .filter((bucket) => bucket.fromDays >= 8)
        .reduce(
          (acc, bucket) => ({
            count: acc.count + bucket.count,
            amountCents: acc.amountCents + bucket.amountCents,
          }),
          { count: 0, amountCents: 0 },
        ),
    [aging],
  );

  const timelineItems = useMemo<TimelineItem[]>(
    () =>
      payouts.slice(0, 8).map((row) => ({
        id: row.id,
        title: `${PAYOUT_STATUS_META[row.status].label} · ${formatMoney(row.netCents)}`,
        description: row.referenceId
          ? `Ref. ${row.referenceId}`
          : 'Referencia bancaria pendiente',
        timestamp: row.processedAt ?? row.periodEnd ?? undefined,
        tone: timelineTone(row.status),
      })),
    [payouts],
  );

  type ChannelTableRow = ChannelRow & Record<string, unknown>;
  type PayoutTableRow = PayoutRow & Record<string, unknown>;
  const channelRows = channels as ChannelTableRow[];
  const payoutTableRows = filteredPayouts as PayoutTableRow[];

  const channelColumns = useMemo<DataTableColumn<ChannelTableRow>[]>(
    () => [
      {
        key: 'channel',
        header: 'Canal',
        width: 160,
        sortValue: (row) => row.channel,
        render: (row) => (
          <div className={styles.cellStack}>
            <strong>{row.channel}</strong>
            <small>{row.currency}</small>
          </div>
        ),
      },
      {
        key: 'orders',
        header: 'Órdenes',
        width: 100,
        align: 'right',
        sortValue: (row) => row.orders,
        render: (row) => formatCount(row.orders),
      },
      {
        key: 'gross',
        header: 'Bruto',
        width: 130,
        align: 'right',
        sortValue: (row) => row.grossCents,
        render: (row) => formatMoney(row.grossCents),
      },
      {
        key: 'fees',
        header: 'Fees',
        width: 120,
        align: 'right',
        sortValue: (row) => row.commissionCents,
        render: (row) => formatMoney(row.commissionCents),
      },
      {
        key: 'net',
        header: 'Neto',
        width: 130,
        align: 'right',
        sortValue: (row) => row.netCents,
        render: (row) => <span className={styles.amount}>{formatMoney(row.netCents)}</span>,
      },
      {
        key: 'take',
        header: 'Take rate',
        width: 110,
        align: 'right',
        sortValue: (row) =>
          row.grossCents === 0 ? 0 : row.commissionCents / row.grossCents,
        render: (row) =>
          row.grossCents === 0 ? '—' : formatRatio(row.commissionCents / row.grossCents),
      },
    ],
    [],
  );

  const payoutColumns = useMemo<DataTableColumn<PayoutTableRow>[]>(
    () => [
      {
        key: 'period',
        header: 'Periodo',
        width: 170,
        sortValue: (row) => row.periodEnd ?? '',
        render: (row) => (
          <div className={styles.cellStack}>
            <strong>
              {row.periodStart?.slice(0, 10) ?? '—'} → {row.periodEnd?.slice(0, 10) ?? '—'}
            </strong>
            <small>Cierre {row.periodEnd?.slice(0, 10) ?? '—'}</small>
          </div>
        ),
      },
      {
        key: 'net',
        header: 'Neto',
        width: 140,
        align: 'right',
        sortValue: (row) => row.netCents,
        render: (row) => (
          <div className={styles.cellStack}>
            <span className={styles.amount}>{formatMoney(row.netCents)}</span>
            <small>Bruto {formatMoney(row.grossCents)}</small>
          </div>
        ),
      },
      {
        key: 'fees',
        header: 'Fees',
        width: 110,
        align: 'right',
        sortValue: (row) => row.commissionCents,
        render: (row) => formatMoney(row.commissionCents),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 130,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={PAYOUT_STATUS_META[row.status].tone} variant="soft" size="sm" dot>
            {PAYOUT_STATUS_META[row.status].label}
          </Badge>
        ),
      },
      {
        key: 'reference',
        header: 'Referencia',
        width: 160,
        sortValue: (row) => row.referenceId ?? '',
        render: (row) => (
          <span className={styles.mono}>{row.referenceId ?? 'Pendiente'}</span>
        ),
      },
      {
        key: 'actions',
        header: <span className={styles.srOnly}>Acciones</span>,
        headerLabel: 'Acciones',
        width: 180,
        align: 'right',
        resizable: false,
        render: (row) => (
          <div className={styles.rowActions}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(row.id)}>
              Ver
            </Button>
            {canManage && canCompletePayout(row) ? (
              <Button variant="primary" size="sm" onClick={() => setConfirming(row)}>
                Pagar
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canManage, setSelectedId],
  );

  async function handleComplete(referenceId: string) {
    if (!confirming || !canManage) return;
    try {
      await completePayout.mutateAsync({
        payoutId: confirming.id,
        referenceId,
      });
      toast.success('Liquidación marcada como pagada');
      setConfirming(null);
      setSelectedId(null);
      void settlementsQuery.refetch();
      void payoutsQuery.refetch();
      void reportQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo completar la liquidación',
      );
    }
  }

  const openFeeRate =
    summary && summary.grossRevenue > 0
      ? summary.commission / summary.grossRevenue
      : null;
  const seriesLoading = revenueSeriesQuery.isPending || refundsSeriesQuery.isPending;

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Finanzas · Tesorería"
        title="Control de liquidaciones"
        description={`Posición de caja, aging, conciliación y confirmación SPEI · ${range.label}`}
        breadcrumbs={[{ label: 'Finanzas' }, { label: 'Liquidaciones' }]}
        actions={
          <div className={styles.headerActions}>
            {!canManage ? (
              <Badge tone="warning" variant="soft" size="sm">
                Solo lectura
              </Badge>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void payoutsQuery.refetch();
                void settlementsQuery.refetch();
                void reportQuery.refetch();
                void revenueSeriesQuery.refetch();
                void refundsSeriesQuery.refetch();
              }}
            >
              Actualizar
            </Button>
            <SegmentedControl<SettlementPeriod>
              label="Periodo de liquidación"
              size="sm"
              value={period}
              onValueChange={setPeriod}
              options={PERIOD_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </div>
        }
      />

      {!canManage ? (
        <p className={styles.permissionBanner} role="status">
          Puedes consultar liquidaciones y conciliación. Confirmar pagos SPEI requiere rol
          ADMIN o SUPER_ADMIN.
        </p>
      ) : null}

      <section className={styles.kpiGrid} aria-label="Indicadores de tesorería">
        <KpiCard
          label="Neto por liquidar"
          value={formatMoney(toCents(summary?.netPayable ?? 0))}
          hint={`${formatCount(totals.openCount)} abiertas`}
          tone="info"
          loading={loading}
        />
        <KpiCard
          label="Venta bruta"
          value={formatMoney(toCents(summary?.grossRevenue ?? 0))}
          hint={range.label}
          loading={loading}
        />
        <KpiCard
          label="Fees de plataforma"
          value={formatMoney(toCents(summary?.commission ?? 0))}
          hint={
            openFeeRate === null ? 'Sin take rate' : `${formatRatio(openFeeRate)} take rate`
          }
          loading={loading}
        />
        <KpiCard
          label="Saldo pendiente"
          value={formatMoney(totals.openCents)}
          hint={
            totals.settledRatio === null
              ? 'Sin liquidaciones'
              : `${formatRatio(totals.settledRatio)} liquidado`
          }
          tone={totals.openCents > 0 ? 'warning' : 'success'}
          loading={loading}
        />
        <KpiCard
          label="Aging > 7 días"
          value={formatCount(overdueAging.count)}
          hint={
            overdueAging.count
              ? `${formatMoney(overdueAging.amountCents)} en riesgo`
              : 'Sin partidas vencidas'
          }
          tone={overdueAging.count ? 'danger' : 'success'}
          loading={loading}
        />
      </section>

      <section className={styles.layout}>
        <div className={styles.stack}>
          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Flujo de ingresos</h2>
                <p className={styles.muted}>
                  Serie {range.granularity === 'hour' ? 'horaria' : 'diaria'} · bruto vs
                  reembolsos · MXN
                </p>
              </div>
              <strong className={styles.amount}>
                {formatMoney(toCents(summary?.grossRevenue ?? 0))}
              </strong>
            </header>
            {seriesLoading ? (
              <div className={styles.chartEmpty} role="status">
                Cargando serie…
              </div>
            ) : chartSeries.length ? (
              <AreaChart
                label="Ingresos y reembolsos del periodo"
                height={210}
                series={chartSeries}
                formatValue={(value) => formatMoney(toCents(value))}
                formatAxis={(value) => formatMoneyCompact(toCents(value))}
              />
            ) : (
              <div className={styles.chartEmpty}>Sin actividad en este periodo.</div>
            )}
          </article>

          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Liquidaciones</h2>
                <p className={styles.muted}>Seguimiento, filtros y evidencia bancaria</p>
              </div>
            </header>
            <div className={styles.filters}>
              <FilterBar
                filters={STATUS_FILTERS}
                value={filterSelection}
                onChange={setFilterSelection}
                search={{
                  value: q,
                  onChange: setSearch,
                  placeholder: 'ID, referencia o fecha',
                }}
              />
            </div>
            <div className={styles.tableMeta}>
              <span>
                {formatCount(filteredPayouts.length)} de {formatCount(payouts.length)}{' '}
                liquidaciones
              </span>
            </div>
            <DataTable
              className={styles.payoutTable}
              label="Liquidaciones a promotor"
              columns={payoutColumns}
              data={payoutTableRows}
              rowKey={(row) => row.id}
              maxHeight={420}
              loading={loading}
              onRowClick={(row) => setSelectedId(row.id)}
              empty={
                <EmptyState
                  title="Sin liquidaciones"
                  description="Ajusta los filtros o genera un settlement del periodo."
                  illustration="inbox"
                  size="sm"
                />
              }
            />
          </article>

          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Conciliación por canal</h2>
                <p className={styles.muted}>Órdenes COMPLETED acumuladas</p>
              </div>
            </header>
            <DataTable
              className={styles.channelTable}
              label="Ventas por canal"
              columns={channelColumns}
              data={channelRows}
              rowKey={(row) => row.id}
              maxHeight={280}
              loading={payoutsQuery.isPending}
              empty={
                <EmptyState
                  title="Sin ventas por canal"
                  description="Cuando haya órdenes completadas aparecerán aquí."
                  illustration="chart"
                  size="sm"
                />
              }
            />
          </article>
        </div>

        <aside className={styles.stack}>
          <AgingPanel buckets={aging} loading={loading} />
          <PayoutCalendar
            month={calendar}
            selectedId={selectedId}
            onSelect={(row) => setSelectedId(row.id)}
            onCursorChange={setCalendarCursor}
            onToday={() => setCalendarCursor(new Date())}
          />
          <ReconciliationPanel
            checks={reconciliation}
            periodLabel={range.label}
            loading={reportQuery.isPending || settlementsQuery.isPending}
            error={reportQuery.error}
            onRetry={() => {
              void reportQuery.refetch();
              void settlementsQuery.refetch();
            }}
          />
          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Timeline de tesorería</h2>
                <p className={styles.muted}>Últimos movimientos</p>
              </div>
            </header>
            {timelineItems.length ? (
              <Timeline label="Movimientos de tesorería" items={timelineItems} density="sm" />
            ) : (
              <div className={styles.emptyWrap}>
                <EmptyState
                  title="Sin movimientos"
                  description="Las liquidaciones aparecerán conforme se generen."
                  illustration="inbox"
                  size="sm"
                />
              </div>
            )}
          </article>
        </aside>
      </section>

      <PayoutDetailDrawer
        payout={selected}
        canManage={canManage}
        busy={completePayout.isPending}
        onClose={() => setSelectedId(null)}
        onComplete={(payout) => setConfirming(payout)}
      />

      <CompletePayoutModal
        payout={confirming}
        busy={completePayout.isPending}
        onConfirm={(referenceId) => {
          void handleComplete(referenceId);
        }}
        onClose={() => {
          if (!completePayout.isPending) setConfirming(null);
        }}
      />
    </main>
  );
}

function PayoutsFallback() {
  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Finanzas · Tesorería"
        title="Control de liquidaciones"
        description="Cargando cockpit financiero…"
      />
      <section className={styles.kpiGrid} aria-busy="true">
        <KpiCard label="Neto por liquidar" value="—" loading />
        <KpiCard label="Venta bruta" value="—" loading />
        <KpiCard label="Fees de plataforma" value="—" loading />
        <KpiCard label="Saldo pendiente" value="—" loading />
        <KpiCard label="Aging > 7 días" value="—" loading />
      </section>
    </main>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense fallback={<PayoutsFallback />}>
      <PayoutsCockpit />
    </Suspense>
  );
}
