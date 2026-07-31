'use client';

import { Suspense, useDeferredValue, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  type DataTableColumn,
} from '@boletera/ui';
import { DonutChart } from '@boletera/ui/src/components/DonutChart';
import { FilterBar, type FilterDefinition } from '@boletera/ui/src/components/FilterBar';
import { KpiCard } from '@boletera/ui/src/components/KpiCard';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import { Section } from '@boletera/ui/src/components/Section';
import { SegmentedControl } from '@boletera/ui/src/components/SegmentedControl';
import {
  useCancelOrder,
  useOrders,
  useResendOrderEmail,
  type OrderRow,
} from '@/lib/queries/orders';
import { useOrdersMetrics } from '@/lib/queries/metrics';
import { useToast } from '@/components/Toast/ToastProvider';
import { ChannelBadge, OrderStatusBadge } from './_components/OrderBadges';
import { OrdersBulkBar } from './_components/OrdersBulkBar';
import { OrdersExceptions } from './_components/OrdersExceptions';
import { OrdersPageSkeleton } from './_components/OrdersPageSkeleton';
import { ConfirmActionModal } from './_lib/ConfirmActionModal';
import {
  RANGE_OPTIONS,
  STATUS_META,
  CHANNEL_LABELS,
  canCancel,
  canResendEmail,
  collectExceptions,
  formatKpiValue,
  formatShortDate,
  kpiDeltaRatio,
  metricsRangeIso,
  money,
  orderMatchesQuery,
} from './_lib/format';
import type { MetricsRangeKey } from './_lib/types';
import { useOrdersUrlState } from './_lib/use-orders-url-state';
import styles from './orders.module.scss';

type BulkIntent = 'resend' | 'cancel' | null;

function OrdersOperationsCenter() {
  const router = useRouter();
  const toast = useToast();
  const url = useOrdersUrlState();
  const deferredQ = useDeferredValue(url.q);

  const metricsRange = metricsRangeIso(url.range);
  const ordersQuery = useOrders({});
  const metricsQuery = useOrdersMetrics(metricsRange);
  const cancelMutation = useCancelOrder();
  const resendMutation = useResendOrderEmail();

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkIntent, setBulkIntent] = useState<BulkIntent>(null);
  const [pending, startTransition] = useTransition();

  const orders = ordersQuery.data ?? [];

  const filtered = orders.filter((order) => {
    if (url.statuses.length && !url.statuses.includes(order.status)) return false;
    if (url.channels.length && !url.channels.includes(order.channel)) return false;
    return orderMatchesQuery(order, deferredQ);
  });

  const exceptions = collectExceptions(orders);

  const selectedOrders = orders.filter((order) => selectedKeys.includes(order.id));
  const canBulkResend =
    selectedOrders.length > 0 && selectedOrders.every(canResendEmail);
  const canBulkCancel =
    selectedOrders.length > 0 && selectedOrders.every(canCancel);

  const statusFilters: FilterDefinition[] = [
    {
      id: 'status',
      label: 'Estado',
      multiple: true,
      options: Object.entries(STATUS_META).map(([value, meta]) => ({
        value,
        label: meta.label,
        count: orders.filter((o) => o.status === value).length,
      })),
    },
    {
      id: 'channel',
      label: 'Canal',
      multiple: true,
      options: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({
        value,
        label,
        count: orders.filter((o) => o.channel === value).length,
      })),
    },
  ];

  const columns: DataTableColumn<OrderRow>[] = [
    {
      key: 'publicId',
      header: 'Referencia',
      width: 150,
      sortValue: (row) => row.publicId,
      render: (row) => (
        <div className={styles.refCell}>
          <Link href={`/orders/${row.id}`} className={styles.refLink}>
            <code className={styles.code}>{row.publicId}</code>
          </Link>
          <time dateTime={row.createdAt} className={styles.muted}>
            {formatShortDate(row.createdAt)}
          </time>
        </div>
      ),
    },
    {
      key: 'event',
      header: 'Evento',
      width: 200,
      sortValue: (row) => row.event.title,
      render: (row) => <span className={styles.eventTitle}>{row.event.title}</span>,
    },
    {
      key: 'buyer',
      header: 'Comprador',
      width: 200,
      sortValue: (row) => row.buyerName || row.buyerEmail,
      render: (row) => (
        <div className={styles.buyerCell}>
          <strong>{row.buyerName || '—'}</strong>
          <span className={styles.muted}>{row.buyerEmail}</span>
        </div>
      ),
    },
    {
      key: 'channel',
      header: 'Canal',
      width: 110,
      sortValue: (row) => row.channel,
      render: (row) => <ChannelBadge channel={row.channel} />,
    },
    {
      key: 'payment',
      header: 'Pago',
      width: 130,
      sortValue: (row) => row.payment?.gateway ?? '',
      render: (row) =>
        row.payment ? (
          <span className={styles.gateway}>
            {row.payment.gateway}
            <small>{row.payment.status}</small>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    {
      key: 'totalAmount',
      header: 'Total',
      width: 120,
      align: 'right',
      sortValue: (row) => Number(row.totalAmount),
      render: (row) => (
        <span className={styles.amount}>{money(row.totalAmount, row.currency)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 150,
      sortValue: (row) => row.status,
      render: (row) => <OrderStatusBadge status={row.status} />,
    },
  ];

  const metrics = metricsQuery.data;
  const volumeSlices =
    metrics?.volumeByStatus.rows.map((row) => ({
      id: row.key,
      label: row.label,
      value: row.value,
    })) ?? [];
  const methodSlices =
    metrics?.paymentMethodBreakdown.rows.map((row) => ({
      id: row.key,
      label: row.label,
      value: row.value,
    })) ?? [];

  const busy = cancelMutation.isPending || resendMutation.isPending || pending;
  const hasActiveFilters =
    Boolean(url.q) || url.statuses.length > 0 || url.channels.length > 0;

  async function runBulk() {
    if (!bulkIntent || selectedOrders.length === 0) return;
    const ids = selectedOrders.map((o) => o.id);
    startTransition(async () => {
      try {
        if (bulkIntent === 'resend') {
          await Promise.all(ids.map((id) => resendMutation.mutateAsync(id)));
          toast.success(
            ids.length === 1
              ? 'Email reenviado'
              : `${ids.length} emails reenviados`,
          );
        } else {
          await Promise.all(ids.map((id) => cancelMutation.mutateAsync(id)));
          toast.success(
            ids.length === 1
              ? 'Orden cancelada'
              : `${ids.length} órdenes canceladas`,
          );
        }
        setSelectedKeys([]);
        setBulkIntent(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo completar la acción');
      }
    });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Centro de órdenes"
        description="Monitorea cobros, excepciones y acciones seguras sobre el ciclo de vida de cada compra."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Órdenes' },
        ]}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void ordersQuery.refetch();
              void metricsQuery.refetch();
            }}
          >
            Actualizar
          </Button>
        }
      >
        <SegmentedControl<MetricsRangeKey>
          label="Rango de métricas"
          size="sm"
          value={url.range}
          onValueChange={url.setRange}
          options={RANGE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </PageHeader>

      <Section columns={4} gap="md" className={styles.kpiSection} aria-label="Indicadores">
        <KpiCard
          label={metrics?.kpis.completedOrders.label ?? 'Órdenes completadas'}
          value={
            metrics
              ? formatKpiValue(
                  metrics.kpis.completedOrders.value,
                  metrics.kpis.completedOrders.unit,
                )
              : '—'
          }
          delta={kpiDeltaRatio(metrics?.kpis.completedOrders.deltaPercent)}
          loading={metricsQuery.isPending}
          tone="success"
        />
        <KpiCard
          label={metrics?.kpis.grossRevenue.label ?? 'Ingreso bruto'}
          value={
            metrics
              ? formatKpiValue(metrics.kpis.grossRevenue.value, metrics.kpis.grossRevenue.unit)
              : '—'
          }
          delta={kpiDeltaRatio(metrics?.kpis.grossRevenue.deltaPercent)}
          loading={metricsQuery.isPending}
          tone="accent"
        />
        <KpiCard
          label={metrics?.kpis.approvalRate.label ?? 'Tasa de aprobación'}
          value={
            metrics
              ? formatKpiValue(metrics.kpis.approvalRate.value, metrics.kpis.approvalRate.unit)
              : '—'
          }
          delta={kpiDeltaRatio(metrics?.kpis.approvalRate.deltaPercent)}
          loading={metricsQuery.isPending}
          tone="info"
        />
        <KpiCard
          label={metrics?.kpis.refundRate.label ?? 'Tasa de reembolso'}
          value={
            metrics
              ? formatKpiValue(metrics.kpis.refundRate.value, metrics.kpis.refundRate.unit)
              : '—'
          }
          delta={kpiDeltaRatio(metrics?.kpis.refundRate.deltaPercent)}
          invertDelta
          loading={metricsQuery.isPending}
          tone="warning"
          hint={
            metrics
              ? `${formatKpiValue(
                  metrics.kpis.chargebackCount.value,
                  metrics.kpis.chargebackCount.unit,
                )} contracargos`
              : undefined
          }
        />
      </Section>

      <div className={styles.trendsRow}>
        <section className={styles.chartCard} aria-label="Volumen por estado">
          <header className={styles.chartHead}>
            <h2>Volumen por estado</h2>
            <Badge tone="neutral" variant="outline" size="sm">
              Tendencia
            </Badge>
          </header>
          {metricsQuery.isPending ? (
            <div className={styles.shellBlock} style={{ height: 180 }} role="status" aria-busy="true" />
          ) : metricsQuery.error ? (
            <EmptyState
              title="No se pudo cargar la tendencia"
              description={
                metricsQuery.error instanceof Error
                  ? metricsQuery.error.message
                  : 'Error al consultar métricas de volumen.'
              }
              illustration="error"
              tone="danger"
              size="sm"
              action={
                <Button variant="secondary" size="sm" onClick={() => void metricsQuery.refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : volumeSlices.length === 0 ? (
            <EmptyState
              title="Sin volumen"
              description="Aún no hay órdenes en el rango seleccionado."
              illustration="chart"
              size="sm"
            />
          ) : (
            <DonutChart
              label="Volumen de órdenes por estado"
              slices={volumeSlices}
              height={200}
              centerLabel="Órdenes"
            />
          )}
        </section>

        <section className={styles.chartCard} aria-label="Métodos de pago">
          <header className={styles.chartHead}>
            <h2>Métodos de pago</h2>
            <Badge tone="neutral" variant="outline" size="sm">
              Mix
            </Badge>
          </header>
          {metricsQuery.isPending ? (
            <div className={styles.shellBlock} style={{ height: 180 }} role="status" aria-busy="true" />
          ) : metricsQuery.error ? (
            <EmptyState
              title="No se pudo cargar el mix"
              description={
                metricsQuery.error instanceof Error
                  ? metricsQuery.error.message
                  : 'Error al consultar métodos de pago.'
              }
              illustration="error"
              tone="danger"
              size="sm"
              action={
                <Button variant="secondary" size="sm" onClick={() => void metricsQuery.refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : methodSlices.length === 0 ? (
            <EmptyState
              title="Sin métodos"
              description="No hay desglose de pagos en este periodo."
              illustration="chart"
              size="sm"
            />
          ) : (
            <DonutChart
              label="Desglose por método de pago"
              slices={methodSlices}
              height={200}
              centerLabel="Pagos"
            />
          )}
        </section>

        <OrdersExceptions exceptions={exceptions} />
      </div>

      <Section
        title="Órdenes"
        description={`${filtered.length} de ${orders.length} visibles`}
        className={styles.tableSection}
        actions={
          selectedKeys.length > 0 ? (
            <Badge tone="accent" variant="soft" size="sm">
              {selectedKeys.length} seleccionadas
            </Badge>
          ) : null
        }
      >
        <FilterBar
          filters={statusFilters}
          value={url.filterSelection}
          onChange={url.setFilterSelection}
          search={{
            value: url.q,
            onChange: url.setSearch,
            placeholder: 'Buscar por orden, comprador o evento…',
          }}
        />

        <OrdersBulkBar
          count={selectedKeys.length}
          canResend={canBulkResend}
          canCancel={canBulkCancel}
          busy={busy}
          onResend={() => setBulkIntent('resend')}
          onCancel={() => setBulkIntent('cancel')}
          onClear={() => setSelectedKeys([])}
        />

        <DataTable
          label="Listado de órdenes"
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          loading={ordersQuery.isPending}
          error={
            ordersQuery.error instanceof Error
              ? ordersQuery.error.message
              : ordersQuery.error
                ? 'No se pudieron cargar las órdenes'
                : null
          }
          onRetry={() => void ordersQuery.refetch()}
          onRowClick={(row) => router.push(`/orders/${row.id}`)}
          maxHeight={520}
          rowHeight={56}
          virtualizeFrom={40}
          density="default"
          empty={
            <EmptyState
              title={orders.length === 0 ? 'Sin órdenes' : 'Sin resultados'}
              description={
                orders.length === 0
                  ? 'Cuando se registren compras aparecerán aquí en tiempo casi real.'
                  : 'Prueba otro criterio de búsqueda o limpia los filtros de la URL.'
              }
              illustration={orders.length === 0 ? 'inbox' : 'search'}
              action={
                hasActiveFilters ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      url.setSearch('');
                      url.setFilterSelection({});
                    }}
                  >
                    Limpiar filtros
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Section>

      <ConfirmActionModal
        open={bulkIntent !== null}
        title={
          bulkIntent === 'cancel'
            ? 'Cancelar órdenes pendientes'
            : 'Reenviar emails de confirmación'
        }
        description={
          bulkIntent === 'cancel'
            ? `Se cancelarán ${selectedOrders.length} orden(es) en estado pendiente o fallido. Esta acción no se puede deshacer desde aquí.`
            : `Se reenviará el correo de confirmación a ${selectedOrders.length} comprador(es).`
        }
        confirmLabel={bulkIntent === 'cancel' ? 'Cancelar órdenes' : 'Reenviar emails'}
        tone={bulkIntent === 'cancel' ? 'danger' : 'primary'}
        busy={busy}
        onClose={() => setBulkIntent(null)}
        onConfirm={() => void runBulk()}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<OrdersPageSkeleton variant="list" />}>
      <OrdersOperationsCenter />
    </Suspense>
  );
}
