'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  formatCurrency,
  formatNumber,
} from '@boletera/ui';
import {
  DataTable,
  type DataTableColumn,
} from '@boletera/ui/src/components/DataTable';
import { DonutChart } from '@boletera/ui/src/components/DonutChart';
import { KpiCard } from '@boletera/ui/src/components/KpiCard';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import { Section } from '@boletera/ui/src/components/Section';
import { SegmentedControl } from '@boletera/ui/src/components/SegmentedControl';
import { QueryError, QueryLoading } from '@/components/QueryStates';
import {
  exportSalesReport,
  useSalesReport,
  useZReports,
  type SalesReportRow,
  type ZReport,
} from '@/lib/queries/reports';
import {
  useAccessMetrics,
  useEventSalesPace,
  useExecutiveMetrics,
} from '@/lib/queries/metrics';
import { useSettlementReport } from '@/lib/queries/payouts';
import { useSession } from '@/lib/use-session';
import { REPORT_CATALOG } from './_lib/catalog';
import { downloadBlob, toCsv } from './_lib/download';
import {
  RANGE_OPTIONS,
  SETTLEMENT_OPTIONS,
  channelLabel,
  formatCount,
  formatDateTime,
  formatKpiValue,
  formatPercent,
  isMetricsRangeKey,
  isSettlementPeriod,
  kpiDeltaRatio,
  metricsRangeIso,
  money,
  paceRiskLabel,
  paceRiskTone,
  zReportTotal,
} from './_lib/format';
import type { MetricsRangeKey, SettlementPeriod } from './_lib/types';
import styles from './reports.module.scss';
import type { EventSalesPaceRow } from '@boletera/shared';

/** DataTable exige `Record<string, unknown>`; las interfaces de shared no lo traen. */
type PaceTableRow = EventSalesPaceRow & Record<string, unknown>;

export default function ReportsPage() {
  const { organizationId } = useSession();
  const [range, setRange] = useState<MetricsRangeKey>('30d');
  const [period, setPeriod] = useState<SettlementPeriod>('WEEKLY');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [pending, startTransition] = useTransition();

  const rangeIso = metricsRangeIso(range);
  const metricsParams = {
    ...rangeIso,
    organizationId: organizationId ?? undefined,
  };

  const executive = useExecutiveMetrics(metricsParams);
  const access = useAccessMetrics(metricsParams);
  const pace = useEventSalesPace(metricsParams);
  const sales = useSalesReport();
  const settlement = useSettlementReport(organizationId, period);
  const zReports = useZReports(organizationId);

  const kpis = executive.data?.kpis;
  const channelRows = sales.data ?? [];
  const channelSlices = channelRows
    .map((row) => ({
      id: row.channel,
      label: channelLabel(row.channel),
      value: Number(row._sum.totalAmount ?? 0),
    }))
    .filter((slice) => slice.value > 0);

  const executiveChannelSlices =
    executive.data?.revenueByChannel.rows.map((row) => ({
      id: row.key,
      label: row.label || channelLabel(row.key),
      value: row.value,
    })) ?? [];

  const donutSlices = channelSlices.length ? channelSlices : executiveChannelSlices;

  const accessPoints =
    access.data?.trafficByAccessPoint.rows.map((row) => ({
      id: row.key,
      label: row.label,
      value: row.value,
    })) ?? [];

  const salesColumns: DataTableColumn<SalesReportRow>[] = [
    {
      key: 'channel',
      header: 'Canal',
      width: 160,
      sortValue: (row) => row.channel,
      render: (row) => channelLabel(row.channel),
    },
    {
      key: 'orders',
      header: 'Órdenes',
      width: 120,
      align: 'right',
      sortValue: (row) => row._count,
      render: (row) => formatCount(row._count),
    },
    {
      key: 'total',
      header: 'Total',
      width: 140,
      align: 'right',
      sortValue: (row) => Number(row._sum.totalAmount ?? 0),
      render: (row) => money(row._sum.totalAmount),
    },
  ];

  const paceColumns: DataTableColumn<PaceTableRow>[] = [
    {
      key: 'title',
      header: 'Evento',
      width: 220,
      sortValue: (row) => row.title,
      render: (row) => (
        <div className={styles.refCell}>
          <strong>{row.title}</strong>
          <span className={styles.muted}>{formatDateTime(row.startsAt)}</span>
        </div>
      ),
    },
    {
      key: 'occupancy',
      header: 'Ocupación',
      width: 110,
      align: 'right',
      sortValue: (row) => row.occupancyPercent,
      render: (row) => formatPercent(row.occupancyPercent),
    },
    {
      key: 'sold',
      header: 'Vendidos',
      width: 120,
      align: 'right',
      sortValue: (row) => row.ticketsSold,
      render: (row) => `${formatCount(row.ticketsSold)} / ${formatCount(row.totalCapacity)}`,
    },
    {
      key: 'revenue',
      header: 'Ingreso',
      width: 120,
      align: 'right',
      sortValue: (row) => row.grossRevenue,
      render: (row) => money(row.grossRevenue),
    },
    {
      key: 'risk',
      header: 'Riesgo',
      width: 120,
      sortValue: (row) => row.riskLevel,
      render: (row) => (
        <Badge tone={paceRiskTone(row.riskLevel)} dot>
          {paceRiskLabel(row.riskLevel)}
        </Badge>
      ),
    },
  ];

  const zColumns: DataTableColumn<ZReport>[] = [
    {
      key: 'terminal',
      header: 'Terminal',
      width: 160,
      sortValue: (row) => row.terminalName ?? row.sessionId,
      render: (row) => row.terminalName || row.sessionId.slice(0, 8),
    },
    {
      key: 'cashier',
      header: 'Cajero',
      width: 140,
      sortValue: (row) => row.cashierId,
      render: (row) => <code className={styles.code}>{row.cashierId.slice(0, 10)}</code>,
    },
    {
      key: 'endedAt',
      header: 'Cierre',
      width: 170,
      sortValue: (row) => row.endedAt ?? '',
      render: (row) => formatDateTime(row.endedAt),
    },
    {
      key: 'total',
      header: 'Total',
      width: 120,
      align: 'right',
      sortValue: (row) => zReportTotal(row.report),
      render: (row) => money(zReportTotal(row.report)),
    },
  ];

  const paymentMethodRows = Object.entries(settlement.data?.paymentMethods ?? {}).map(
    ([gateway, value]) => ({
      id: gateway,
      gateway,
      count: value.count,
      amount: value.amount,
    }),
  );

  type PaymentMethodRow = (typeof paymentMethodRows)[number];

  const paymentColumns: DataTableColumn<PaymentMethodRow>[] = [
    {
      key: 'gateway',
      header: 'Gateway',
      width: 160,
      sortValue: (row) => row.gateway,
      render: (row) => row.gateway,
    },
    {
      key: 'count',
      header: 'Transacciones',
      width: 140,
      align: 'right',
      sortValue: (row) => row.count,
      render: (row) => formatCount(row.count),
    },
    {
      key: 'amount',
      header: 'Monto',
      width: 140,
      align: 'right',
      sortValue: (row) => row.amount,
      render: (row) => money(row.amount),
    },
  ];

  async function handleExportSales() {
    if (!organizationId) {
      setExportError('Selecciona una organización para exportar.');
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      const csv = await exportSalesReport(organizationId);
      downloadBlob(`ventas-${organizationId}.csv`, csv);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo exportar el CSV.');
    } finally {
      setExporting(false);
    }
  }

  function handleExportChannels() {
    const csv = toCsv(
      ['Canal', 'Órdenes', 'Total'],
      channelRows.map((row) => [
        channelLabel(row.channel),
        row._count,
        row._sum.totalAmount ?? 0,
      ]),
    );
    downloadBlob(`canales-${range}.csv`, csv);
  }

  function refreshAll() {
    startTransition(() => {
      void executive.refetch();
      void access.refetch();
      void pace.refetch();
      void sales.refetch();
      void settlement.refetch();
      void zReports.refetch();
    });
  }

  const anyPending =
    executive.isPending ||
    access.isPending ||
    pace.isPending ||
    sales.isPending ||
    settlement.isPending ||
    zReports.isPending;

  const firstError =
    executive.error || access.error || pace.error || sales.error || settlement.error || zReports.error;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Cumplimiento y analítica"
        title="Centro de reportes"
        description="Catálogo vivo de ventas, canales, asistencia, liquidación y cortes de taquilla con datos reales del periodo."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Reportes' },
        ]}
        actions={
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending || anyPending}
              onClick={refreshAll}
            >
              Actualizar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={exporting || !organizationId}
              onClick={() => void handleExportSales()}
            >
              {exporting ? 'Exportando…' : 'Exportar ventas CSV'}
            </Button>
          </div>
        }
      >
        <SegmentedControl
          label="Rango de métricas"
          size="sm"
          value={range}
          onValueChange={(value) => {
            if (isMetricsRangeKey(value)) setRange(value);
          }}
          options={RANGE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </PageHeader>

      {exportError ? (
        <p role="alert" className={styles.muted}>
          {exportError}
        </p>
      ) : null}

      <Section
        title="Catálogo de reportes"
        description="Accesos directos a cada vista del centro. Los indicadores se actualizan con el rango seleccionado."
      >
        <nav className={styles.catalog} aria-label="Catálogo de reportes">
          {REPORT_CATALOG.map((item) => (
            <Link key={item.id} href={item.href} className={styles.catalogCard}>
              <div className={styles.catalogMeta}>
                <Badge tone={item.tone} size="sm" dot={item.live}>
                  {item.live ? 'En vivo' : 'Archivo'}
                </Badge>
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </Link>
          ))}
        </nav>
      </Section>

      <Section
        id="executive"
        columns={4}
        gap="md"
        title="Indicadores del periodo"
        description={`Comparativo vs. periodo anterior · ${RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range}`}
        aria-label="Indicadores ejecutivos"
      >
        <KpiCard
          label={kpis?.grossRevenue.label ?? 'Ingreso bruto'}
          value={kpis ? formatKpiValue(kpis.grossRevenue.value, kpis.grossRevenue.unit) : '—'}
          delta={kpiDeltaRatio(kpis?.grossRevenue.deltaPercent)}
          loading={executive.isPending}
          tone="accent"
        />
        <KpiCard
          label={kpis?.ticketsSold.label ?? 'Boletos vendidos'}
          value={kpis ? formatKpiValue(kpis.ticketsSold.value, kpis.ticketsSold.unit) : '—'}
          delta={kpiDeltaRatio(kpis?.ticketsSold.deltaPercent)}
          loading={executive.isPending}
          tone="success"
        />
        <KpiCard
          label={kpis?.ordersCompleted.label ?? 'Órdenes'}
          value={kpis ? formatKpiValue(kpis.ordersCompleted.value, kpis.ordersCompleted.unit) : '—'}
          delta={kpiDeltaRatio(kpis?.ordersCompleted.deltaPercent)}
          loading={executive.isPending}
          tone="info"
        />
        <KpiCard
          label={kpis?.conversionRate.label ?? 'Conversión'}
          value={kpis ? formatKpiValue(kpis.conversionRate.value, kpis.conversionRate.unit) : '—'}
          delta={kpiDeltaRatio(kpis?.conversionRate.deltaPercent)}
          loading={executive.isPending}
          tone="neutral"
        />
      </Section>

      {firstError && anyPending === false && !executive.data && !sales.data ? (
        <QueryError error={firstError} onRetry={refreshAll} />
      ) : null}

      <div className={styles.chartsRow} id="channels">
        <section className={styles.panel} aria-labelledby="channels-title">
          <div className={styles.panelHead}>
            <h2 id="channels-title">Ventas por canal</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={!channelRows.length}
              onClick={handleExportChannels}
            >
              Exportar tabla
            </Button>
          </div>
          {sales.isPending ? (
            <QueryLoading label="Cargando ventas por canal…" />
          ) : sales.error ? (
            <QueryError error={sales.error} onRetry={() => void sales.refetch()} />
          ) : channelRows.length === 0 && donutSlices.length === 0 ? (
            <EmptyState
              title="Sin ventas en el periodo"
              description="Cuando haya órdenes completadas aparecerán aquí por canal."
            />
          ) : (
            <>
              {donutSlices.length > 0 ? (
                <DonutChart
                  label="Distribución de ingresos por canal"
                  slices={donutSlices}
                  centerLabel="Ingreso"
                  formatValue={(value) => formatCurrency(value)}
                  height={210}
                />
              ) : null}
              {channelRows.length > 0 ? (
                <DataTable
                  label="Tabla de ventas por canal"
                  columns={salesColumns}
                  data={channelRows}
                  rowKey={(row) => row.channel}
                  maxHeight={320}
                  defaultSort={{ key: 'total', direction: 'desc' }}
                />
              ) : null}
            </>
          )}
        </section>

        <section className={styles.panel} id="attendance" aria-labelledby="attendance-title">
          <div className={styles.panelHead}>
            <h2 id="attendance-title">Asistencia y acceso</h2>
          </div>
          {access.isPending ? (
            <QueryLoading label="Cargando asistencia…" />
          ) : access.error ? (
            <QueryError error={access.error} onRetry={() => void access.refetch()} />
          ) : !access.data ? (
            <EmptyState
              title="Sin datos de acceso"
              description="Los check-ins del periodo aparecerán cuando haya eventos con escaneo."
            />
          ) : (
            <>
              <div className={styles.statStrip} role="group" aria-label="Resumen de asistencia">
                <article className={styles.statItem}>
                  <span>Vendidos</span>
                  <strong>{formatCount(access.data.ticketsSold)}</strong>
                </article>
                <article className={styles.statItem}>
                  <span>Check-in</span>
                  <strong>{formatCount(access.data.ticketsCheckedIn)}</strong>
                </article>
                <article className={styles.statItem}>
                  <span>No-show</span>
                  <strong>{formatCount(access.data.ticketsNoShow)}</strong>
                </article>
                <article className={styles.statItem}>
                  <span>Tasa no-show</span>
                  <strong>{formatPercent(access.data.noShowRate * 100)}</strong>
                </article>
              </div>
              {accessPoints.length > 0 ? (
                <DonutChart
                  label="Tráfico por punto de acceso"
                  slices={accessPoints}
                  centerLabel="Accesos"
                  formatValue={(value) => formatNumber(value)}
                  height={200}
                />
              ) : (
                <p className={styles.muted}>Sin desglose por punto de acceso en este periodo.</p>
              )}
            </>
          )}
        </section>
      </div>

      <section className={styles.panel} id="pace" aria-labelledby="pace-title">
        <div className={styles.panelHead}>
          <h2 id="pace-title">Ritmo de ventas</h2>
          {pace.data?.atRisk.length ? (
            <Badge tone="warning" dot>
              {pace.data.atRisk.length} en riesgo
            </Badge>
          ) : null}
        </div>
        {pace.isPending ? (
          <QueryLoading label="Calculando ritmo de ventas…" />
        ) : pace.error ? (
          <QueryError error={pace.error} onRetry={() => void pace.refetch()} />
        ) : !pace.data?.events.length ? (
          <EmptyState
            title="Sin eventos activos"
            description="El ritmo de sell-through aparecerá cuando haya eventos con inventario."
          />
        ) : (
          <DataTable
            label="Eventos por ritmo de venta"
            columns={paceColumns}
            data={pace.data.events as PaceTableRow[]}
            rowKey={(row) => row.eventId}
            maxHeight={360}
            defaultSort={{ key: 'risk', direction: 'desc' }}
          />
        )}
      </section>

      <section className={styles.panel} id="settlement" aria-labelledby="settlement-title">
        <div className={styles.panelHead}>
          <h2 id="settlement-title">Liquidación a promotores</h2>
          <SegmentedControl
            label="Periodo de liquidación"
            size="sm"
            value={period}
            onValueChange={(value) => {
              if (isSettlementPeriod(value)) setPeriod(value);
            }}
            options={SETTLEMENT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
        </div>
        {settlement.isPending ? (
          <QueryLoading label="Cargando liquidación…" />
        ) : settlement.error ? (
          <QueryError error={settlement.error} onRetry={() => void settlement.refetch()} />
        ) : !settlement.data?.summary ? (
          <EmptyState
            title="Sin liquidación"
            description="No hay resumen de liquidación para este periodo."
          />
        ) : (
          <>
            <div className={styles.statStrip} role="group" aria-label="Resumen de liquidación">
              <article className={styles.statItem}>
                <span>Bruto</span>
                <strong>{money(settlement.data.summary.grossRevenue)}</strong>
              </article>
              <article className={styles.statItem}>
                <span>Comisión</span>
                <strong>{money(settlement.data.summary.commission)}</strong>
              </article>
              <article className={styles.statItem}>
                <span>Neto</span>
                <strong>{money(settlement.data.summary.netRevenue)}</strong>
              </article>
              <article className={styles.statItem}>
                <span>Órdenes</span>
                <strong>{formatCount(settlement.data.summary.totalOrders)}</strong>
              </article>
            </div>
            {paymentMethodRows.length > 0 ? (
              <DataTable
                label="Métodos de pago en liquidación"
                columns={paymentColumns}
                data={paymentMethodRows}
                rowKey={(row) => row.id}
                maxHeight={280}
                defaultSort={{ key: 'amount', direction: 'desc' }}
              />
            ) : (
              <p className={styles.muted}>Sin desglose por gateway.</p>
            )}
          </>
        )}
      </section>

      <section className={styles.panel} id="z-reports" aria-labelledby="z-title">
        <div className={styles.panelHead}>
          <h2 id="z-title">Z-reports de taquilla</h2>
        </div>
        {!organizationId ? (
          <EmptyState
            title="Organización requerida"
            description="Inicia sesión con una organización para ver los cortes de caja."
          />
        ) : zReports.isPending ? (
          <QueryLoading label="Cargando Z-reports…" />
        ) : zReports.error ? (
          <QueryError error={zReports.error} onRetry={() => void zReports.refetch()} />
        ) : !(zReports.data?.length) ? (
          <EmptyState
            title="Sin cortes archivados"
            description="Los cierres de terminal aparecerán aquí cuando la taquilla archive un Z-report."
          />
        ) : (
          <DataTable
            label="Cortes Z de taquilla"
            columns={zColumns}
            data={zReports.data}
            rowKey={(row) => row.sessionId}
            maxHeight={360}
            defaultSort={{ key: 'endedAt', direction: 'desc' }}
          />
        )}
      </section>

      {executive.data?.generatedAt ? (
        <p className={styles.footerNote}>
          Métricas generadas {formatDateTime(executive.data.generatedAt)}
        </p>
      ) : null}
    </div>
  );
}
