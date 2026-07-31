'use client';

import Link from 'next/link';
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
  Skeleton,
  formatNumber,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import type { EgressOverviewVenue } from '@/lib/platform-api';
import { useEgressOverview, useVenues } from '@/lib/queries/venues';
import { useSession } from '@/lib/use-session';
import { CreateVenueModal } from './_components/CreateVenueModal';
import { VenueInspector } from './_components/VenueInspector';
import {
  buildPortfolioRows,
  formatCapacity,
  formatClearance,
  formatRelativeDate,
  HEALTH_LABEL,
  healthRank,
  healthTone,
  venueMatchesQuery,
} from './_lib/format';
import type { VenuePortfolioRow, ViewMode } from './_lib/types';
import { useVenuesUrlState } from './_lib/use-venues-url-state';
import styles from './venues.module.scss';

function VenuesPortfolioSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Cargando portafolio de venues">
      <Skeleton shape="text" width="40%" height={28} />
      <Skeleton shape="text" width="70%" height={14} delay={60} />
      <Section columns={4} gap="sm" aria-label="Indicadores en carga">
        <Skeleton shape="rect" height={96} />
        <Skeleton shape="rect" height={96} delay={40} />
        <Skeleton shape="rect" height={96} delay={80} />
        <Skeleton shape="rect" height={96} delay={120} />
      </Section>
    </div>
  );
}

function VenuesPortfolioPage() {
  const { can } = useSession();
  const canManage = can('venue:manage');
  const url = useVenuesUrlState();
  const deferredQ = useDeferredValue(url.q);

  const venuesQuery = useVenues();
  const egressQuery = useEgressOverview();
  const [createOpen, setCreateOpen] = useState(false);

  const egressByVenueId = useMemo(() => {
    const map = new Map<string, EgressOverviewVenue>();
    for (const row of egressQuery.data?.venues ?? []) {
      map.set(row.venueId, row);
    }
    return map;
  }, [egressQuery.data]);

  const rows = useMemo(
    () => buildPortfolioRows(venuesQuery.data ?? [], egressByVenueId),
    [venuesQuery.data, egressByVenueId],
  );

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.city, (counts.get(row.city) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es-MX'))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [rows]);

  const filters = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'health',
        label: 'Salud',
        options: (Object.keys(HEALTH_LABEL) as Array<keyof typeof HEALTH_LABEL>).map((value) => ({
          value,
          label: HEALTH_LABEL[value],
          count: rows.filter((row) => row.health === value).length,
        })),
      },
      {
        id: 'map',
        label: 'Mapa',
        options: [
          {
            value: 'with',
            label: 'Con mapa activo',
            count: rows.filter((row) => row.hasActiveMap).length,
          },
          {
            value: 'without',
            label: 'Sin mapa activo',
            count: rows.filter((row) => !row.hasActiveMap).length,
          },
        ],
      },
      {
        id: 'city',
        label: 'Ciudad',
        options: cityOptions,
      },
    ],
    [cityOptions, rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!venueMatchesQuery(row, deferredQ)) return false;
      if (url.health.length && (row.health == null || !url.health.includes(row.health))) {
        return false;
      }
      if (url.maps.length) {
        const wantsWith = url.maps.includes('with');
        const wantsWithout = url.maps.includes('without');
        if (wantsWith && !wantsWithout && !row.hasActiveMap) return false;
        if (wantsWithout && !wantsWith && row.hasActiveMap) return false;
      }
      if (url.cities.length && !url.cities.includes(row.city)) return false;
      return true;
    });
  }, [deferredQ, rows, url.cities, url.health, url.maps]);

  const kpis = useMemo(() => {
    const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
    const withMaps = rows.filter((row) => row.hasActiveMap).length;
    const events = rows.reduce((sum, row) => sum + row.events, 0);
    const counts = egressQuery.data?.counts;
    const healthy = counts?.ok ?? rows.filter((row) => row.health === 'ok').length;
    const attention =
      counts == null
        ? rows.filter((row) => row.health != null && row.health !== 'ok').length
        : (counts.warn ?? 0) +
          (counts.critical ?? 0) +
          (counts.noNetwork ?? 0) +
          (counts.empty ?? 0);
    return {
      venues: rows.length,
      capacity,
      withMaps,
      events,
      healthy,
      attention,
    };
  }, [egressQuery.data?.counts, rows]);

  const selectedRow = useMemo(
    () => (url.selectedId ? (rows.find((row) => row.id === url.selectedId) ?? null) : null),
    [rows, url.selectedId],
  );

  const columns = useMemo<DataTableColumn<VenuePortfolioRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Venue',
        width: 220,
        sortValue: (row) => row.name,
        render: (row) => (
          <div className={styles.nameCell}>
            <strong>{row.name}</strong>
            <code>{row.slug}</code>
          </div>
        ),
      },
      {
        key: 'city',
        header: 'Ciudad',
        width: 140,
        sortValue: (row) => row.city,
      },
      {
        key: 'capacity',
        header: 'Aforo',
        width: 110,
        align: 'right',
        sortValue: (row) => row.capacity,
        render: (row) => formatCapacity(row.capacity),
      },
      {
        key: 'mapCount',
        header: 'Mapas',
        width: 100,
        align: 'right',
        sortValue: (row) => row.mapCount,
        render: (row) => (
          <Badge tone={row.hasActiveMap ? 'accent' : 'neutral'} variant="soft" size="sm">
            {row.hasActiveMap ? formatNumber(row.mapCount) : 'Ninguno'}
          </Badge>
        ),
      },
      {
        key: 'events',
        header: 'Eventos',
        width: 100,
        align: 'right',
        sortValue: (row) => row.events,
        render: (row) => formatNumber(row.events),
      },
      {
        key: 'health',
        header: 'Salud',
        width: 170,
        sortValue: (row) => healthRank(row.health),
        render: (row) => (
          <div>
            <Badge tone={healthTone(row.health)} variant="soft" size="sm" dot>
              {row.health ? HEALTH_LABEL[row.health] : 'Pendiente'}
            </Badge>
            {row.healthReason ? <div className={styles.reason}>{row.healthReason}</div> : null}
          </div>
        ),
      },
      {
        key: 'clearanceMinutes',
        header: 'Vaciado',
        width: 110,
        align: 'right',
        sortValue: (row) => row.clearanceMinutes ?? -1,
        render: (row) => formatClearance(row.clearanceMinutes),
      },
      {
        key: 'layoutUpdatedAt',
        header: 'Layout',
        width: 160,
        sortValue: (row) => row.layoutUpdatedAt ?? '',
        render: (row) => formatRelativeDate(row.layoutUpdatedAt),
      },
      {
        key: 'actions',
        header: 'Layouts',
        width: 170,
        resizable: false,
        render: (row) => (
          <div className={styles.actionGroup}>
            <Link
              href={`/venues/${row.id}/map`}
              className={styles.mapLink}
              onClick={(event) => event.stopPropagation()}
            >
              Layout
            </Link>
            <Link
              href={`/venues/${row.id}/3d`}
              className={styles.mapLink}
              onClick={(event) => event.stopPropagation()}
            >
              3D
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  const loading = venuesQuery.isPending;
  const egressLoading = egressQuery.isPending;
  const listError = venuesQuery.error;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones · Espacios"
        title="Portafolio de venues"
        description="Aforo, layouts activos, vista 3D y salud de circulación por recinto."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Venues' },
        ]}
        actions={
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={venuesQuery.isFetching && egressQuery.isFetching}
              onClick={() => {
                void venuesQuery.refetch();
                void egressQuery.refetch();
              }}
            >
              Actualizar
            </Button>
            {canManage ? (
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                Nuevo venue
              </Button>
            ) : null}
          </div>
        }
      />

      <Section columns={4} gap="sm" aria-label="Indicadores del portafolio">
        <KpiCard
          label="Venues"
          value={loading ? '—' : formatNumber(kpis.venues)}
          hint={`${formatNumber(kpis.events)} eventos ligados`}
          loading={loading}
          tone="accent"
        />
        <KpiCard
          label="Aforo total"
          value={loading ? '—' : formatCapacity(kpis.capacity)}
          hint="Suma de aforo declarado"
          loading={loading}
          tone="info"
        />
        <KpiCard
          label="Mapas activos"
          value={loading ? '—' : formatNumber(kpis.withMaps)}
          hint="Layouts activos asociados"
          loading={loading}
          tone="success"
        />
        <KpiCard
          label="Salud de config."
          value={
            loading || egressLoading
              ? '—'
              : `${formatNumber(kpis.healthy)} / ${formatNumber(kpis.attention)}`
          }
          hint="Saludables / requieren atención"
          loading={loading || egressLoading}
          tone={kpis.attention > 0 ? 'warning' : 'success'}
          href="/reports/egress"
        />
      </Section>

      {listError ? (
        <QueryError error={listError} onRetry={() => void venuesQuery.refetch()} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.mainCol}>
            <div className={styles.toolbar}>
              <FilterBar
                filters={filters}
                value={url.filterSelection}
                onChange={url.setFilterSelection}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar por nombre, slug o ciudad…',
                }}
              >
                <SegmentedControl<ViewMode>
                  label="Vista del portafolio"
                  value={url.view}
                  onValueChange={url.setView}
                  options={[
                    { value: 'table', label: 'Tabla' },
                    { value: 'cards', label: 'Tarjetas' },
                  ]}
                  size="sm"
                />
              </FilterBar>
              <div className={styles.filterMeta} role="status">
                <span>
                  {formatNumber(filtered.length)} de {formatNumber(rows.length)} venues
                </span>
                {url.q || url.health.length || url.maps.length || url.cities.length ? (
                  <Button type="button" variant="ghost" size="sm" onClick={url.clearFilters}>
                    Limpiar filtros
                  </Button>
                ) : null}
              </div>
            </div>

            {loading ? (
              <DataTable
                label="Portafolio de venues"
                columns={columns}
                data={[]}
                rowKey={(row) => row.id}
                loading
                loadingRows={8}
                maxHeight={520}
              />
            ) : filtered.length === 0 ? (
              rows.length === 0 ? (
                <EmptyState
                  title="Sin venues"
                  description="Crea el primer recinto para gestionar aforo, mapas y salud de configuración."
                  action={
                    canManage ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        Nuevo venue
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <EmptyState
                  title="Sin resultados"
                  description="Ajusta la búsqueda o los filtros de salud, mapa y ciudad."
                  action={
                    <Button type="button" variant="secondary" onClick={url.clearFilters}>
                      Limpiar filtros
                    </Button>
                  }
                />
              )
            ) : url.view === 'cards' ? (
              <div className={styles.cardGrid} role="list" aria-label="Tarjetas de venues">
                {filtered.map((row) => {
                  const selected = row.id === url.selectedId;
                  return (
                    <article
                      key={row.id}
                      role="listitem"
                      className={
                        selected
                          ? `${styles.venueCard} ${styles.venueCardSelected}`
                          : styles.venueCard
                      }
                    >
                      <button
                        type="button"
                        className={styles.cardButton}
                        aria-pressed={selected}
                        onClick={() => url.setSelectedId(selected ? null : row.id)}
                      >
                        <div className={styles.cardTop}>
                          <div>
                            <h3 className={styles.cardTitle}>{row.name}</h3>
                            <p className={styles.cardMeta}>
                              {row.city} · {row.slug}
                            </p>
                          </div>
                          <Badge tone={healthTone(row.health)} variant="soft" size="sm" dot>
                            {row.health ? HEALTH_LABEL[row.health] : 'Pendiente'}
                          </Badge>
                        </div>
                        <ul className={styles.cardStats}>
                          <li>
                            <span>Aforo</span>
                            <strong>{formatCapacity(row.capacity)}</strong>
                          </li>
                          <li>
                            <span>Mapas</span>
                            <strong>{formatNumber(row.mapCount)}</strong>
                          </li>
                          <li>
                            <span>Eventos</span>
                            <strong>{formatNumber(row.events)}</strong>
                          </li>
                        </ul>
                      </button>
                      <div className={styles.cardFooter}>
                        <span className={styles.muted}>
                          {row.hasActiveMap
                            ? `Layout ${formatRelativeDate(row.layoutUpdatedAt)}`
                            : 'Sin layout activo'}
                        </span>
                        <div className={styles.actionGroup}>
                          <Link href={`/venues/${row.id}/map`} className={styles.mapLink}>
                            Layout
                          </Link>
                          <Link href={`/venues/${row.id}/3d`} className={styles.mapLink}>
                            3D
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <DataTable
                label="Portafolio de venues"
                columns={columns}
                data={filtered}
                rowKey={(row) => row.id}
                maxHeight={520}
                density="compact"
                defaultSort={{ key: 'health', direction: 'desc' }}
                onRowClick={(row) =>
                  url.setSelectedId(row.id === url.selectedId ? null : row.id)
                }
              />
            )}

            {egressQuery.error ? (
              <p className={styles.muted} role="status">
                La salud de egress no pudo cargarse; el aforo y los mapas siguen disponibles.{' '}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => void egressQuery.refetch()}
                >
                  Reintentar salud
                </Button>
              </p>
            ) : null}
          </div>

          <VenueInspector row={selectedRow} onClose={() => url.setSelectedId(null)} />
        </div>
      )}

      {canManage ? (
        <CreateVenueModal open={createOpen} onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}

export default function VenuesPage() {
  return (
    <Suspense fallback={<VenuesPortfolioSkeleton />}>
      <VenuesPortfolioPage />
    </Suspense>
  );
}
