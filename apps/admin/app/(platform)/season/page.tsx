'use client';

import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { useCreateSeasonPass, useSeasonPasses, type SeasonPass } from '@/lib/queries/season';
import { useSession } from '@/lib/use-session';
import { AdoptionPanel } from './_components/AdoptionPanel';
import { CreatePassModal, type CreatePassPayload } from './_components/CreatePassModal';
import { InventoryHealth } from './_components/InventoryHealth';
import {
  formatCount,
  formatMoney,
  formatMoneyPrecise,
  formatRatio,
} from './_lib/money';
import {
  adoptionBySeason,
  adoptionRate,
  buildSeasonAlerts,
  computeSeasonKpis,
  filterAndSortPasses,
  inventoryHealth,
  passPriceCents,
  passStatusMeta,
  remaining,
  revenueCents,
  seasonLabelsOf,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  statusOf,
  type SortKey,
  type StatusFilter,
} from './_lib/passes';
import { useSeasonUrlState } from './_lib/use-season-url-state';
import styles from './season.module.scss';

function SeasonCockpit() {
  const { organizationId } = useSession();
  const toast = useToast();
  const url = useSeasonUrlState();
  const deferredQ = useDeferredValue(url.q);

  const passesQuery = useSeasonPasses(organizationId);
  const createPass = useCreateSeasonPass(organizationId ?? '');
  const [createOpen, setCreateOpen] = useState(false);

  const passes = passesQuery.data ?? [];
  const kpis = useMemo(() => computeSeasonKpis(passes), [passes]);
  const alerts = useMemo(() => buildSeasonAlerts(passes), [passes]);
  const buckets = useMemo(() => adoptionBySeason(passes), [passes]);
  const inventory = useMemo(() => inventoryHealth(passes), [passes]);
  const seasonLabels = useMemo(() => seasonLabelsOf(passes), [passes]);

  const filtered = useMemo(
    () =>
      filterAndSortPasses(passes, {
        query: deferredQ,
        season: url.season,
        status: url.status,
        sort: url.sort,
      }),
    [deferredQ, passes, url.season, url.sort, url.status],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const next: Record<string, readonly string[]> = {};
    if (url.status !== 'all') next.status = [url.status];
    if (url.season !== 'all') next.season = [url.season];
    return next;
  }, [url.season, url.status]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: STATUS_FILTER_OPTIONS.filter((option) => option.value !== 'all').map(
          (option) => ({ value: option.value, label: option.label }),
        ),
      },
      {
        id: 'season',
        label: 'Temporada',
        multiple: false,
        options: seasonLabels.map((label) => ({ value: label, label })),
      },
    ],
    [seasonLabels],
  );

  async function onCreate(payload: CreatePassPayload) {
    if (!organizationId) return;
    await createPass.mutateAsync(payload);
    setCreateOpen(false);
    toast.success(`Abono «${payload.name}» publicado`);
  }

  const columns: DataTableColumn<SeasonPass>[] = [
    {
      key: 'name',
      header: 'Abono',
      width: 220,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className={styles.passMeta}>
          <strong>{row.name}</strong>
          <small>
            {row.seasonLabel} · {row.slug}
          </small>
        </div>
      ),
    },
    {
      key: 'adoption',
      header: 'Adopción',
      width: 160,
      sortValue: (row) => adoptionRate(row),
      render: (row) => {
        const rate = adoptionRate(row);
        return (
          <div className={styles.adoptionCell}>
            <strong>{formatRatio(rate)}</strong>
            <div
              className={styles.bar}
              role="meter"
              aria-label={`Adopción ${Math.round(rate * 100)}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rate * 100)}
            >
              <span
                className={styles.bar_estable}
                style={{ width: `${Math.min(rate * 100, 100)}%` }}
              />
            </div>
            <small>
              {formatCount(row.soldQuantity)}/{formatCount(row.maxQuantity)} vendidos
            </small>
          </div>
        );
      },
    },
    {
      key: 'inventory',
      header: 'Inventario',
      width: 110,
      align: 'right',
      sortValue: (row) => remaining(row),
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatCount(remaining(row))}</strong>
          <small>disponibles</small>
        </div>
      ),
    },
    {
      key: 'revenue',
      header: 'Ingreso',
      width: 130,
      align: 'right',
      sortValue: (row) => revenueCents(row),
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatMoney(revenueCents(row))}</strong>
          <small>{formatMoneyPrecise(passPriceCents(row))} c/u</small>
        </div>
      ),
    },
    {
      key: 'events',
      header: 'Eventos',
      width: 90,
      align: 'right',
      sortValue: (row) => row.events?.length ?? 0,
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatCount(row.events?.length ?? 0)}</strong>
          <small>ligados</small>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 120,
      sortValue: (row) => statusOf(row),
      render: (row) => {
        const meta = passStatusMeta(statusOf(row));
        return (
          <Badge tone={meta.tone} variant="soft" size="sm" dot>
            {meta.label}
          </Badge>
        );
      },
    },
  ];

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
          illustration="error"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Temporadas"
        title="Abonos"
        description="Adopción, renovación e inventario de pases de temporada vinculados a eventos."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Crear abono
          </Button>
        }
      />

      {alerts.length > 0 ? (
        <div className={styles.alerts} aria-label="Alertas de inventario">
          {alerts.map((alert) => (
            <div key={alert.id} className={styles.alert} role="status">
              <Badge tone={alert.tone} variant="soft" size="sm" dot>
                Atención
              </Badge>
              <span>{alert.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      <Section columns={4} gap="sm" aria-label="Indicadores de abonos">
        <KpiCard
          label="Ingresos estimados"
          value={formatMoney(kpis.revenueCents)}
          loading={passesQuery.isPending}
          hint={`${formatCount(kpis.sold)} abonos vendidos`}
          tone="success"
        />
        <KpiCard
          label="Adopción"
          value={formatRatio(kpis.adoption)}
          loading={passesQuery.isPending}
          hint={`${formatCount(kpis.sold)}/${formatCount(kpis.capacity)} del cupo`}
          tone={kpis.adoption >= 0.7 ? 'success' : kpis.adoption >= 0.4 ? 'warning' : 'info'}
        />
        <KpiCard
          label="Inventario libre"
          value={formatCount(kpis.inventory)}
          loading={passesQuery.isPending}
          hint={`${formatCount(kpis.active)} abonos activos`}
        />
        <KpiCard
          label="Candidatos a renovar"
          value={formatCount(kpis.renewable)}
          loading={passesQuery.isPending}
          hint="≥70% adopción y cupo disponible"
          tone="info"
        />
      </Section>

      {passesQuery.error ? (
        <QueryError error={passesQuery.error} onRetry={() => void passesQuery.refetch()} />
      ) : (
        <div className={styles.layout}>
          <Section
            title="Catálogo de abonos"
            description="Filtra por temporada, estado y ordena por adopción o inventario."
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void passesQuery.refetch()}
              >
                Actualizar
              </Button>
            }
          >
            <div className={styles.filters}>
              <FilterBar
                filters={filterDefs}
                value={filterSelection}
                onChange={(next) => {
                  const status = (next.status?.[0] as StatusFilter | undefined) ?? 'all';
                  const season = next.season?.[0] ?? 'all';
                  url.setStatus(status);
                  url.setSeason(season);
                }}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar por nombre, slug o temporada',
                }}
              >
                <SegmentedControl
                  label="Filtro rápido de estado"
                  size="sm"
                  value={
                    url.status === 'all' || url.status === 'active' || url.status === 'soldout'
                      ? url.status
                      : 'all'
                  }
                  onValueChange={(value) => url.setStatus(value)}
                  options={[
                    { value: 'all', label: 'Todos' },
                    { value: 'active', label: 'En venta' },
                    { value: 'soldout', label: 'Agotados' },
                  ]}
                />
                <select
                  className={styles.sortSelect}
                  aria-label="Ordenar abonos"
                  value={url.sort}
                  onChange={(e) => url.setSort(e.target.value as SortKey)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterBar>
            </div>

            <div className={styles.tableMeta}>
              <span className={styles.muted}>
                {formatCount(filtered.length)} de {formatCount(passes.length)} resultados
              </span>
            </div>

            <DataTable
              label="Catálogo de abonos de temporada"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={passesQuery.isPending}
              maxHeight={520}
              rowHeight={64}
              empty={
                <EmptyState
                  title={passes.length === 0 ? 'Sin abonos' : 'Sin resultados'}
                  description={
                    passes.length === 0
                      ? 'Crea el primer abono para empezar a medir adopción.'
                      : 'Ajusta filtros o limpia la URL.'
                  }
                  illustration={passes.length === 0 ? 'seats' : 'search'}
                  action={
                    passes.length === 0 ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        Crear abono
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={url.clearFilters}
                      >
                        Limpiar filtros
                      </Button>
                    )
                  }
                />
              }
            />
          </Section>

          <div className={styles.stack}>
            <AdoptionPanel buckets={buckets} loading={passesQuery.isPending} />
            <InventoryHealth rows={inventory} loading={passesQuery.isPending} />
          </div>
        </div>
      )}

      <CreatePassModal
        open={createOpen}
        busy={createPass.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
      />
    </div>
  );
}

export default function SeasonPassesPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando abonos…
        </div>
      }
    >
      <SeasonCockpit />
    </Suspense>
  );
}
