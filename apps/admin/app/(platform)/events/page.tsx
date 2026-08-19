'use client';

import {
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  useReducedMotion,
  type BadgeTone,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
  type SortState,
} from '@boletera/ui';
import type { EventSalesPaceRow } from '@boletera/shared';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { useEvents, useEventSalesPace } from '@/lib/queries';
import { queryKeys } from '@/lib/query-keys';
import type { EventRow } from '@/lib/platform-api';
import { useSession } from '@/lib/use-session';
import styles from './events.module.scss';

const EVENT_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'COMPLETED',
  'CANCELLED',
  'RESCHEDULED',
] as const;

type EventStatus = (typeof EVENT_STATUSES)[number];

const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Borrador',
  SCHEDULED: 'Programado',
  LIVE: 'En vivo',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
  RESCHEDULED: 'Reprogramado',
};

const KIND_LABEL: Record<string, string> = {
  single: 'Único',
  series: 'Serie',
  residency: 'Residencia',
  tour: 'Gira',
  season: 'Temporada',
  festival: 'Festival',
};

type EventListRow = EventRow & {
  pace: EventSalesPaceRow | null;
};

type UrlState = {
  q: string;
  statuses: readonly EventStatus[];
  kinds: readonly string[];
  riskOnly: boolean;
  filterSelection: FilterSelection;
};

function isEventStatus(value: string): value is EventStatus {
  return (EVENT_STATUSES as readonly string[]).includes(value);
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function eventKind(event: EventRow): string {
  const meta = event.metadata;
  if (!meta || typeof meta !== 'object') return 'single';
  const kind = meta.eventKind;
  return typeof kind === 'string' && kind.length > 0 ? kind : 'single';
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'LIVE':
    case 'SCHEDULED':
      return 'success';
    case 'RESCHEDULED':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    case 'DRAFT':
    case 'COMPLETED':
    default:
      return 'neutral';
  }
}

function riskTone(level: EventSalesPaceRow['riskLevel'] | undefined): BadgeTone {
  switch (level) {
    case 'critical':
    case 'at_risk':
      return 'danger';
    case 'watch':
      return 'warning';
    case 'on_track':
      return 'success';
    default:
      return 'neutral';
  }
}

function riskLabel(level: EventSalesPaceRow['riskLevel']): string {
  switch (level) {
    case 'critical':
      return 'Crítico';
    case 'at_risk':
      return 'En riesgo';
    case 'watch':
      return 'Atención';
    case 'on_track':
      return 'En ritmo';
  }
}

function daysUntil(startsAt: string, nowMs: number): number | null {
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.ceil((start - nowMs) / 86_400_000);
}

function occupancyFromEvent(event: EventRow): number | null {
  const tickets = event._count?.tickets;
  const capacity = event.totalCapacity;
  if (typeof tickets !== 'number' || !capacity || capacity <= 0) return null;
  return (tickets / capacity) * 100;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function downloadCsv(filename: string, rows: readonly EventListRow[]) {
  const header = [
    'id',
    'title',
    'slug',
    'status',
    'startsAt',
    'venue',
    'capacity',
    'kind',
    'tickets',
    'orders',
    'occupancyPercent',
    'grossRevenue',
    'daysUntilEvent',
    'riskLevel',
  ];
  const lines = rows.map((row) => {
    const occupancy =
      row.pace?.occupancyPercent ?? occupancyFromEvent(row) ?? '';
    return [
      row.id,
      row.title,
      row.slug,
      row.status,
      row.startsAt,
      row.venue?.name ?? '',
      row.totalCapacity ?? '',
      eventKind(row),
      row._count?.tickets ?? '',
      row._count?.orders ?? '',
      occupancy,
      row.pace?.grossRevenue ?? '',
      row.pace?.daysUntilEvent ?? daysUntil(row.startsAt, Date.now()) ?? '',
      row.pace?.riskLevel ?? '',
    ]
      .map((cell) => {
        const text = String(cell);
        return `"${text.replaceAll('"', '""')}"`;
      })
      .join(',');
  });
  const blob = new Blob([[header.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function useEventsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<UrlState>(() => {
    const q = searchParams.get('q') ?? '';
    const statuses = parseList(searchParams.get('status')).filter(isEventStatus);
    const kinds = parseList(searchParams.get('kind'));
    const riskOnly = searchParams.get('risk') === '1';
    const filterSelection: FilterSelection = {
      ...(statuses.length ? { status: statuses } : {}),
      ...(kinds.length ? { kind: kinds } : {}),
      ...(riskOnly ? { risk: ['at_risk'] } : {}),
    };
    return { q, statuses, kinds, riskOnly, filterSelection };
  }, [searchParams]);

  const replaceParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setSearch = useCallback(
    (q: string) => replaceParams({ q: q || null }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      replaceParams({
        status: selection.status?.length ? selection.status.join(',') : null,
        kind: selection.kind?.length ? selection.kind.join(',') : null,
        risk: selection.risk?.includes('at_risk') ? '1' : null,
      });
    },
    [replaceParams],
  );

  return { ...state, setSearch, setFilterSelection };
}

function EventsPageSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Cargando eventos">
      <div className={styles.skeletonHeader}>
        <Skeleton shape="text" width="28%" height={28} />
        <Skeleton shape="text" width="48%" height={14} delay={60} />
      </div>
      <div className={styles.kpiGrid}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} shape="rect" height={96} delay={i * 40} />
        ))}
      </div>
      <Skeleton shape="rect" height={48} />
      <Skeleton shape="rect" height={360} delay={80} />
    </div>
  );
}

function EventsPortfolioPage() {
  const toast = useToast();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const url = useEventsUrlState();
  const deferredQ = useDeferredValue(url.q);
  const router = useRouter();

  const canWrite = can('event:write');
  const canExport = can('data:export');
  const canSelect = canWrite || canExport;

  const eventsQuery = useEvents();
  const salesPaceQuery = useEventSalesPace({});

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState | null>({
    key: 'startsAt',
    direction: 'asc',
  });
  const [pending, startTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);

  const nowMs = useMemo(() => Date.now(), []);

  const paceById = useMemo(() => {
    const map = new Map<string, EventSalesPaceRow>();
    for (const row of salesPaceQuery.data?.events ?? []) {
      map.set(row.eventId, row);
    }
    return map;
  }, [salesPaceQuery.data?.events]);

  const atRiskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of salesPaceQuery.data?.atRisk ?? []) {
      ids.add(row.eventId);
    }
    return ids;
  }, [salesPaceQuery.data?.atRisk]);

  const hasPaceData = Boolean(salesPaceQuery.data);

  const rows = useMemo<EventListRow[]>(() => {
    return (eventsQuery.data ?? []).map((event) => ({
      ...event,
      pace: paceById.get(event.id) ?? null,
    }));
  }, [eventsQuery.data, paceById]);

  const filtered = useMemo(() => {
    const q = deferredQ.trim().toLowerCase();
    return rows.filter((row) => {
      if (url.statuses.length && !url.statuses.includes(row.status as EventStatus)) {
        return false;
      }
      if (url.kinds.length && !url.kinds.includes(eventKind(row))) return false;
      if (url.riskOnly) {
        if (!hasPaceData) return false;
        if (!atRiskIds.has(row.id) && row.pace?.riskLevel !== 'at_risk' && row.pace?.riskLevel !== 'critical') {
          return false;
        }
      }
      if (!q) return true;
      const hay = [row.title, row.slug, row.venue?.name ?? '', eventKind(row)]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [atRiskIds, deferredQ, hasPaceData, rows, url.kinds, url.riskOnly, url.statuses]);

  const portfolioKpis = useMemo(() => {
    const paceEvents = salesPaceQuery.data?.events ?? [];
    const atRiskCount = salesPaceQuery.data?.atRisk.length;
    const top = salesPaceQuery.data?.topPerformers[0] ?? null;

    const occupancyValues = paceEvents
      .map((e) => e.occupancyPercent)
      .filter((n) => Number.isFinite(n));
    const fallbackOccupancy = rows
      .map(occupancyFromEvent)
      .filter((n): n is number => n !== null);

    const occupancyAvg = average(
      occupancyValues.length > 0 ? occupancyValues : fallbackOccupancy,
    );

    const daysValues = paceEvents
      .map((e) => e.daysUntilEvent)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const fallbackDays = rows
      .map((e) => daysUntil(e.startsAt, nowMs))
      .filter((n): n is number => n !== null && n >= 0);

    const nearestDays =
      (daysValues.length > 0 ? Math.min(...daysValues) : null) ??
      (fallbackDays.length > 0 ? Math.min(...fallbackDays) : null);

    const revenueTotal =
      paceEvents.length > 0
        ? paceEvents.reduce((sum, e) => sum + (Number.isFinite(e.grossRevenue) ? e.grossRevenue : 0), 0)
        : null;

    const bestLabel = top
      ? top.title
      : (() => {
          const withOcc = rows
            .map((r) => ({ title: r.title, occ: occupancyFromEvent(r) }))
            .filter((r): r is { title: string; occ: number } => r.occ !== null)
            .sort((a, b) => b.occ - a.occ);
          return withOcc[0]?.title ?? null;
        })();

    return {
      atRiskCount: hasPaceData ? (atRiskCount ?? 0) : null,
      bestLabel,
      bestHint: top
        ? `${formatPercent(top.actualPace)} ritmo · ${formatNumber(top.occupancyPercent, 1)} % ocupación`
        : bestLabel
          ? 'Según ocupación disponible'
          : null,
      occupancyAvg,
      nearestDays,
      revenueTotal,
      activeCount: rows.filter((r) => r.status === 'LIVE' || r.status === 'SCHEDULED').length,
      totalCount: rows.length,
    };
  }, [hasPaceData, nowMs, rows, salesPaceQuery.data]);

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const statusCounts = new Map<string, number>();
    const kindCounts = new Map<string, number>();
    for (const row of rows) {
      statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
      const kind = eventKind(row);
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    }

    const defs: FilterDefinition[] = [
      {
        id: 'status',
        label: 'Estado',
        multiple: true,
        options: EVENT_STATUSES.filter((status) => (statusCounts.get(status) ?? 0) > 0 || url.statuses.includes(status)).map(
          (status) => ({
            value: status,
            label: STATUS_LABEL[status],
            count: statusCounts.get(status) ?? 0,
          }),
        ),
      },
      {
        id: 'kind',
        label: 'Tipo',
        multiple: true,
        options: Array.from(kindCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({
            value,
            label: KIND_LABEL[value] ?? value,
            count,
          })),
      },
    ];

    if (hasPaceData) {
      defs.push({
        id: 'risk',
        label: 'Ritmo',
        multiple: false,
        options: [
          {
            value: 'at_risk',
            label: 'En riesgo / bajo ritmo',
            count: salesPaceQuery.data?.atRisk.length ?? 0,
          },
        ],
      });
    }

    return defs;
  }, [hasPaceData, rows, salesPaceQuery.data?.atRisk.length, url.statuses]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.id)),
    [rows, selectedKeys],
  );

  const draftSelected = selectedRows.filter((row) => row.status === 'DRAFT');
  const canBulkPublish = canWrite && draftSelected.length > 0;
  const canBulkExport = canExport && selectedRows.length > 0;

  const columns = useMemo<DataTableColumn<EventListRow>[]>(() => {
    const cols: DataTableColumn<EventListRow>[] = [
      {
        key: 'title',
        header: 'Evento',
        width: 260,
        sortValue: (row) => row.title,
        render: (row) => (
          <div className={styles.eventCell}>
            <span className={styles.thumb} aria-hidden="true">
              {row.title.charAt(0).toUpperCase()}
            </span>
            <div className={styles.eventText}>
              <Link href={`/events/${row.id}`} className={styles.eventLink}>
                {row.title}
              </Link>
              <span className={styles.muted}>{row.slug}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'startsAt',
        header: 'Fecha',
        width: 150,
        sortValue: (row) => new Date(row.startsAt).getTime(),
        render: (row) => {
          const days = row.pace?.daysUntilEvent ?? daysUntil(row.startsAt, nowMs);
          return (
            <div className={styles.stackCell}>
              <time dateTime={row.startsAt}>{formatDateTime(row.startsAt)}</time>
              {days !== null && days >= 0 ? (
                <span className={styles.muted}>
                  {days === 0 ? 'Hoy' : `${formatNumber(days)} d restantes`}
                </span>
              ) : days !== null && days < 0 ? (
                <span className={styles.muted}>Pasado</span>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'venue',
        header: 'Venue',
        width: 160,
        sortValue: (row) => row.venue?.name ?? '',
        render: (row) => (
          <span className={styles.venue}>{row.venue?.name ?? '—'}</span>
        ),
      },
      {
        key: 'capacity',
        header: 'Capacidad',
        width: 110,
        align: 'right',
        sortValue: (row) => row.totalCapacity ?? 0,
        render: (row) =>
          row.totalCapacity != null ? formatNumber(row.totalCapacity) : '—',
      },
      {
        key: 'occupancy',
        header: 'Ocupación',
        width: 120,
        align: 'right',
        sortValue: (row) =>
          row.pace?.occupancyPercent ?? occupancyFromEvent(row) ?? -1,
        render: (row) => {
          const occ = row.pace?.occupancyPercent ?? occupancyFromEvent(row);
          if (occ == null) return <span className={styles.muted}>—</span>;
          return (
            <span className={styles.metric}>{formatPercent(occ / 100)}</span>
          );
        },
      },
      {
        key: 'revenue',
        header: 'Ingresos',
        width: 130,
        align: 'right',
        sortValue: (row) => row.pace?.grossRevenue ?? -1,
        render: (row) =>
          row.pace && Number.isFinite(row.pace.grossRevenue) ? (
            <span className={styles.metric}>
              {formatCurrency(row.pace.grossRevenue, 0)}
            </span>
          ) : (
            <span className={styles.muted}>—</span>
          ),
      },
      {
        key: 'kind',
        header: 'Tipo',
        width: 110,
        sortValue: (row) => eventKind(row),
        render: (row) => {
          const kind = eventKind(row);
          return (
            <Badge tone="neutral" variant="outline" size="sm">
              {KIND_LABEL[kind] ?? kind}
            </Badge>
          );
        },
      },
      {
        key: 'status',
        header: 'Estado',
        width: 150,
        sortValue: (row) => row.status,
        render: (row) => {
          const status = isEventStatus(row.status) ? row.status : null;
          return (
            <div className={styles.statusCell}>
              <Badge tone={statusTone(row.status)} variant="soft" size="sm" dot>
                {status ? STATUS_LABEL[status] : row.status}
              </Badge>
              {row.pace &&
              (row.pace.riskLevel === 'at_risk' ||
                row.pace.riskLevel === 'critical' ||
                row.pace.riskLevel === 'watch') ? (
                <Badge
                  tone={riskTone(row.pace.riskLevel)}
                  variant="outline"
                  size="sm"
                >
                  {riskLabel(row.pace.riskLevel)}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
    ];
    return cols;
  }, [nowMs]);

  const hasActiveFilters =
    Boolean(url.q) ||
    url.statuses.length > 0 ||
    url.kinds.length > 0 ||
    url.riskOnly;

  const listLoading = eventsQuery.isPending;
  const listError = eventsQuery.error;
  const paceLoading = salesPaceQuery.isPending;

  async function publishDrafts(ids: string[]) {
    setPublishing(true);
    try {
      await Promise.all(
        ids.map((id) =>
          http<{ totalSeats: number; sections: number }>(`/events/${id}/publish`, {
            method: 'POST',
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      toast.success(
        ids.length === 1
          ? 'Evento publicado'
          : `${ids.length} eventos publicados`,
      );
      setSelectedKeys([]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo publicar',
      );
    } finally {
      setPublishing(false);
    }
  }

  function handleExport(target: readonly EventListRow[]) {
    if (!canExport || target.length === 0) return;
    downloadCsv(
      `eventos-${new Date().toISOString().slice(0, 10)}.csv`,
      target,
    );
    toast.success(
      target.length === 1
        ? '1 evento exportado'
        : `${target.length} eventos exportados`,
    );
  }

  const primaryAction: ReactNode = canWrite ? (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => router.push('/events')}
    >
      Crear evento
    </Button>
  ) : null;

  return (
    <div
      className={styles.page}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
    >
      <PageHeader
        eyebrow="Portafolio"
        title="Eventos"
        description={`${formatNumber(portfolioKpis.totalCount)} en catálogo · ${formatNumber(portfolioKpis.activeCount)} operando · MXN · es-MX`}
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Eventos' },
        ]}
        actions={
          <div className={styles.headerActions}>
            {canExport ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={filtered.length === 0}
                onClick={() => handleExport(filtered)}
              >
                Exportar
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void eventsQuery.refetch();
                void salesPaceQuery.refetch();
              }}
            >
              Actualizar
            </Button>
            {primaryAction}
          </div>
        }
      />

      <section className={styles.kpiSection} aria-label="Indicadores del portafolio">
        <div className={styles.kpiGrid}>
          <KpiCard
            label="En riesgo"
            value={
              portfolioKpis.atRiskCount == null
                ? '—'
                : formatNumber(portfolioKpis.atRiskCount)
            }
            hint={
              portfolioKpis.atRiskCount == null
                ? 'Ritmo de venta no disponible'
                : 'Bajo ritmo vs. expectativa'
            }
            loading={paceLoading && !hasPaceData}
            tone={
              portfolioKpis.atRiskCount != null && portfolioKpis.atRiskCount > 0
                ? 'danger'
                : 'neutral'
            }
          />
          <KpiCard
            label="Mejor desempeño"
            value={portfolioKpis.bestLabel ?? '—'}
            hint={portfolioKpis.bestHint ?? 'Sin métrica comparable'}
            loading={listLoading && paceLoading}
            tone="success"
          />
          <KpiCard
            label="Ocupación media"
            value={
              portfolioKpis.occupancyAvg == null
                ? '—'
                : formatPercent(portfolioKpis.occupancyAvg / 100)
            }
            hint={
              portfolioKpis.occupancyAvg == null
                ? 'Sin datos de boletos'
                : 'Sobre capacidad conocida'
            }
            loading={listLoading && paceLoading}
            tone="accent"
          />
          <KpiCard
            label="Días restantes"
            value={
              portfolioKpis.nearestDays == null
                ? '—'
                : portfolioKpis.nearestDays === 0
                  ? 'Hoy'
                  : formatNumber(portfolioKpis.nearestDays)
            }
            unit={
              portfolioKpis.nearestDays != null && portfolioKpis.nearestDays > 0
                ? 'al próximo'
                : undefined
            }
            hint={
              portfolioKpis.nearestDays == null
                ? 'Sin fechas próximas'
                : 'Hasta el evento más cercano'
            }
            loading={listLoading && paceLoading}
            tone="info"
          />
          <KpiCard
            label="Ingresos"
            value={
              portfolioKpis.revenueTotal == null
                ? '—'
                : formatCurrency(portfolioKpis.revenueTotal, 0)
            }
            hint={
              portfolioKpis.revenueTotal == null
                ? 'Métrica de ritmo no disponible'
                : 'Bruto del portafolio medido'
            }
            loading={paceLoading && !hasPaceData}
            tone="accent"
          />
        </div>
      </section>

      {salesPaceQuery.error && !salesPaceQuery.data ? (
        <Card className={styles.notice} padding="sm" role="status">
          <p>
            El ritmo de venta no está disponible. Los KPIs de riesgo e ingresos
            se omiten; el listado sigue operativo.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void salesPaceQuery.refetch()}
          >
            Reintentar métricas
          </Button>
        </Card>
      ) : null}

      <Section
        title="Catálogo"
        description={
          hasActiveFilters
            ? `${formatNumber(filtered.length)} de ${formatNumber(rows.length)} eventos`
            : `${formatNumber(rows.length)} eventos`
        }
        actions={
          <div className={styles.headerActions}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.push('/reports')}
            >
              Reportes
            </Button>
          </div>
        }
        className={styles.tableSection}
      >
        <FilterBar
          filters={filterDefs}
          value={url.filterSelection}
          onChange={(next) => {
            startTransition(() => url.setFilterSelection(next));
          }}
          search={{
            value: url.q,
            onChange: (value) => {
              startTransition(() => url.setSearch(value));
            },
            placeholder: 'Buscar por título, slug o venue…',
          }}
        />

        {canSelect && selectedKeys.length > 0 ? (
          <div className={styles.bulkBar} role="region" aria-label="Acciones masivas">
            <p className={styles.bulkCount}>
              <strong>{formatNumber(selectedKeys.length)}</strong>{' '}
              {selectedKeys.length === 1
                ? 'evento seleccionado'
                : 'eventos seleccionados'}
              {draftSelected.length > 0
                ? ` · ${formatNumber(draftSelected.length)} borrador${draftSelected.length === 1 ? '' : 'es'}`
                : null}
            </p>
            <div className={styles.bulkActions}>
              {canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!canBulkPublish || publishing || pending}
                  onClick={() =>
                    void publishDrafts(draftSelected.map((row) => row.id))
                  }
                >
                  Publicar borradores
                </Button>
              ) : null}
              {canExport ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!canBulkExport || publishing || pending}
                  onClick={() => handleExport(selectedRows)}
                >
                  Exportar selección
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={publishing || pending}
                onClick={() => setSelectedKeys([])}
              >
                Limpiar
              </Button>
            </div>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          label="Listado de eventos"
          sort={sort}
          onSortChange={setSort}
          selectable={canSelect}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          loading={listLoading}
          error={
            listError
              ? listError instanceof Error
                ? listError.message
                : 'No se pudieron cargar los eventos'
              : null
          }
          onRetry={() => void eventsQuery.refetch()}
          onRowClick={(row) => router.push(`/events/${row.id}`)}
          density="compact"
          maxHeight={560}
          rowHeight={52}
          virtualizeFrom={40}
          empty={
            <EmptyState
              size="md"
              tone="neutral"
              illustration={hasActiveFilters ? 'search' : 'seats'}
              title={
                hasActiveFilters
                  ? 'Sin resultados con estos filtros'
                  : 'Aún no hay eventos'
              }
              description={
                hasActiveFilters
                  ? 'Ajusta la búsqueda o limpia los filtros para ver el portafolio completo.'
                  : 'Crea el primer evento para empezar a vender boletos.'
              }
              action={
                hasActiveFilters ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      url.setSearch('');
                      url.setFilterSelection({});
                    }}
                  >
                    Limpiar filtros
                  </Button>
                ) : canWrite ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => router.push('/events')}
                  >
                    Crear el primero
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Section>
    </div>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<EventsPageSkeleton />}>
      <EventsPortfolioPage />
    </Suspense>
  );
}
