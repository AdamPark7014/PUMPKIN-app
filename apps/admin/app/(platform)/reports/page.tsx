'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, EmptyState } from '@boletera/ui';
import { DataTable, type DataTableColumn } from '@boletera/ui/src/components/DataTable';
import { KpiCard } from '@boletera/ui/src/components/KpiCard';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import { Section } from '@boletera/ui/src/components/Section';
import { SegmentedControl } from '@boletera/ui/src/components/SegmentedControl';
import { QueryError, QueryLoading } from '@/components/QueryStates';
import {
  exportSalesReport,
  useSalesReport,
  useZReports,
  type SalesBucket,
  type ZReport,
} from '@/lib/queries/reports';
import { useSession } from '@/lib/use-session';
import { downloadBlob, toCsv } from './_lib/download';
import {
  RANGE_OPTIONS,
  channelLabel,
  formatCount,
  formatDateTime,
  isMetricsRangeKey,
  metricsRangeIso,
  money,
  zReportTotal,
} from './_lib/format';
import type { MetricsRangeKey } from './_lib/types';
import styles from './reports.module.scss';

/**
 * Reporte de ventas del evento.
 *
 * Dos vistas según quién mira:
 *  - Promotor: boletos vendidos y ventas a valor nominal — lo que le toca.
 *  - Interno (nosotros): además el cargo por servicio y el total cobrado.
 * La API decide la vista por rol; aquí sólo se pintan los campos que llegan.
 */

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  SPEI: 'Transferencia',
  OXXO: 'OXXO',
  COMP: 'Cortesía',
};

function paymentLabel(method: string): string {
  return PAYMENT_LABEL[method] ?? method;
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ReportsPage() {
  const { organizationId } = useSession();
  const [range, setRange] = useState<MetricsRangeKey>('30d');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [, startTransition] = useTransition();

  const rangeIso = metricsRangeIso(range);
  const sales = useSalesReport(range, rangeIso);
  const zReports = useZReports(organizationId);

  const report = sales.data;
  const internal = report?.view === 'internal';
  const totals: SalesBucket = report?.totals ?? { orders: 0, tickets: 0, gross: 0 };

  // Columnas comunes a todos los desgloses. Las de cargo/total sólo existen
  // en la vista interna — al promotor ni siquiera le llegan en el JSON.
  function moneyColumns<T extends SalesBucket>(): DataTableColumn<T>[] {
    const cols: DataTableColumn<T>[] = [
      {
        key: 'tickets',
        header: 'Boletos',
        width: 110,
        sortValue: (r) => r.tickets,
        render: (r) => formatCount(r.tickets),
      },
      {
        key: 'orders',
        header: 'Órdenes',
        width: 110,
        sortValue: (r) => r.orders,
        render: (r) => formatCount(r.orders),
      },
      {
        key: 'gross',
        header: internal ? 'Ventas (nominal)' : 'Ventas',
        width: 150,
        sortValue: (r) => r.gross,
        render: (r) => money(r.gross),
      },
    ];
    if (internal) {
      cols.push(
        {
          key: 'serviceFees',
          header: 'Cargo por servicio',
          width: 160,
          sortValue: (r) => r.serviceFees ?? 0,
          render: (r) => money(r.serviceFees ?? 0),
        },
        {
          key: 'total',
          header: 'Total cobrado',
          width: 150,
          sortValue: (r) => r.total ?? 0,
          render: (r) => <strong>{money(r.total ?? 0)}</strong>,
        },
      );
    }
    return cols;
  }

  const channelColumns: DataTableColumn<SalesBucket & { channel: string }>[] = [
    {
      key: 'channel',
      header: 'Canal',
      width: 160,
      sortValue: (r) => r.channel,
      render: (r) => (
        <Badge tone={r.channel === 'TAQUILLA' ? 'warning' : 'info'} size="sm">
          {channelLabel(r.channel)}
        </Badge>
      ),
    },
    ...moneyColumns<SalesBucket & { channel: string }>(),
  ];

  const methodColumns: DataTableColumn<SalesBucket & { paymentMethod: string }>[] = [
    {
      key: 'paymentMethod',
      header: 'Método de pago',
      width: 160,
      sortValue: (r) => r.paymentMethod,
      render: (r) => paymentLabel(r.paymentMethod),
    },
    ...moneyColumns<SalesBucket & { paymentMethod: string }>(),
  ];

  const terminalColumns: DataTableColumn<
    SalesBucket & { terminalId: string; terminalName: string }
  >[] = [
    {
      key: 'terminalName',
      header: 'Taquilla',
      width: 200,
      sortValue: (r) => r.terminalName,
      render: (r) => r.terminalName,
    },
    ...moneyColumns<SalesBucket & { terminalId: string; terminalName: string }>(),
  ];

  const dayColumns: DataTableColumn<SalesBucket & { date: string }>[] = [
    {
      key: 'date',
      header: 'Día',
      width: 160,
      sortValue: (r) => r.date,
      render: (r) => dayLabel(r.date),
    },
    ...moneyColumns<SalesBucket & { date: string }>(),
  ];

  const zColumns: DataTableColumn<ZReport>[] = [
    {
      key: 'terminalName',
      header: 'Taquilla',
      width: 180,
      render: (r) => r.terminalName ?? 'Terminal',
    },
    {
      key: 'endedAt',
      header: 'Cierre',
      width: 190,
      sortValue: (r) => r.endedAt ?? '',
      render: (r) => formatDateTime(r.endedAt),
    },
    {
      key: 'total',
      header: 'Efectivo esperado',
      width: 160,
      sortValue: (r) => zReportTotal(r.report),
      render: (r) => money(zReportTotal(r.report)),
    },
    {
      key: 'sessionId',
      header: 'Turno',
      width: 220,
      render: (r) => <code className={styles.code}>{r.sessionId}</code>,
    },
  ];

  async function exportCsv() {
    if (!report) return;
    setExporting(true);
    setExportError('');
    try {
      const flat = [
        ...report.byChannel.map((r) => ({ tipo: 'canal', clave: channelLabel(r.channel), ...r })),
        ...report.byPaymentMethod.map((r) => ({
          tipo: 'método',
          clave: paymentLabel(r.paymentMethod),
          ...r,
        })),
        ...report.byTerminal.map((r) => ({ tipo: 'taquilla', clave: r.terminalName, ...r })),
        ...report.byDay.map((r) => ({ tipo: 'día', clave: r.date, ...r })),
      ];
      // El CSV respeta la misma vista: sin columnas de cargo para el promotor.
      const headers = internal
        ? ['tipo', 'clave', 'boletos', 'ordenes', 'ventas', 'cargo_servicio', 'total_cobrado']
        : ['tipo', 'clave', 'boletos', 'ordenes', 'ventas'];
      const rows = flat.map((r) =>
        internal
          ? [r.tipo, r.clave, r.tickets, r.orders, r.gross, r.serviceFees ?? 0, r.total ?? 0]
          : [r.tipo, r.clave, r.tickets, r.orders, r.gross],
      );
      downloadBlob(
        `ventas-pumpkin-zone-${range}.csv`,
        new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }),
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  }

  async function exportFullCsv() {
    if (!organizationId) return;
    setExporting(true);
    setExportError('');
    try {
      const csv = await exportSalesReport(organizationId);
      downloadBlob('ordenes-pumpkin-zone.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          report ? (
            <Badge tone={internal ? 'warning' : 'neutral'} variant="outline" size="sm">
              {internal ? 'Vista interna · incluye cargo por servicio' : 'Vista del promotor'}
            </Badge>
          ) : null
        }
        title="Reporte de ventas"
        description="Boletos vendidos por canal, método de pago, taquilla y día. Los cortes de caja de cada turno están abajo."
        actions={
          <div className={styles.actions}>
            <SegmentedControl
              value={range}
              onValueChange={(value) => {
                if (isMetricsRangeKey(value)) startTransition(() => setRange(value));
              }}
              options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              label="Rango del reporte"
            />
            <Button variant="secondary" size="sm" onClick={exportCsv} loading={exporting}>
              Exportar resumen
            </Button>
            <Button variant="ghost" size="sm" onClick={exportFullCsv} loading={exporting}>
              Exportar órdenes
            </Button>
          </div>
        }
      />

      {exportError && (
        <p role="alert" className={styles.muted}>
          {exportError}
        </p>
      )}

      {sales.isLoading && <QueryLoading label="Calculando ventas…" />}
      {sales.isError && <QueryError error={sales.error} onRetry={() => sales.refetch()} />}

      {report && (
        <>
          <div className={styles.statStrip} role="group" aria-label="Totales del periodo">
            <KpiCard label="Boletos vendidos" value={formatCount(totals.tickets)} />
            <KpiCard label="Órdenes" value={formatCount(totals.orders)} />
            <KpiCard
              label={internal ? 'Ventas a valor nominal' : 'Ventas'}
              value={money(totals.gross)}
              unit="MXN"
            />
            {internal && (
              <>
                <KpiCard
                  label="Cargo por servicio"
                  value={money(totals.serviceFees ?? 0)}
                  unit="MXN"
                  hint="Ingreso de la plataforma. No visible para el promotor."
                />
                <KpiCard label="Total cobrado" value={money(totals.total ?? 0)} unit="MXN" />
              </>
            )}
          </div>

          <Section title="Por canal" description="Online vs. taquilla.">
            {report.byChannel.length ? (
              <DataTable
                label="Ventas por canal"
                columns={channelColumns}
                data={report.byChannel}
                rowKey={(r) => r.channel}
              />
            ) : (
              <EmptyState title="Sin ventas en el periodo" />
            )}
          </Section>

          <Section title="Por taquilla" description="Cada terminal de punto de venta.">
            {report.byTerminal.length ? (
              <DataTable
                label="Ventas por taquilla"
                columns={terminalColumns}
                data={report.byTerminal}
                rowKey={(r) => r.terminalId}
              />
            ) : (
              <EmptyState title="Aún no hay ventas en taquilla" />
            )}
          </Section>

          <Section title="Por método de pago">
            {report.byPaymentMethod.length ? (
              <DataTable
                label="Ventas por método de pago"
                columns={methodColumns}
                data={report.byPaymentMethod}
                rowKey={(r) => r.paymentMethod}
              />
            ) : (
              <EmptyState title="Sin ventas en el periodo" />
            )}
          </Section>

          <Section title="Por día">
            {report.byDay.length ? (
              <DataTable
                label="Ventas por día"
                columns={dayColumns}
                data={report.byDay}
                rowKey={(r) => r.date}
                defaultSort={{ key: 'date', direction: 'desc' }}
              />
            ) : (
              <EmptyState title="Sin ventas en el periodo" />
            )}
          </Section>
        </>
      )}

      <Section
        title="Cortes de caja"
        description="Cierre de cada turno de taquilla: efectivo esperado contra contado."
      >
        {zReports.isLoading && <QueryLoading label="Cargando cortes…" />}
        {zReports.isError && (
          <QueryError error={zReports.error} onRetry={() => zReports.refetch()} />
        )}
        {zReports.data && zReports.data.length > 0 ? (
          <DataTable
            label="Cortes de caja"
            columns={zColumns}
            data={zReports.data}
            rowKey={(r) => r.sessionId}
            defaultSort={{ key: 'endedAt', direction: 'desc' }}
          />
        ) : (
          zReports.data && <EmptyState title="Todavía no hay turnos cerrados" />
        )}
      </Section>
    </div>
  );
}
