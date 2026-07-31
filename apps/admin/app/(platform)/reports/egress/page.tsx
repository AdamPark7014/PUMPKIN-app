'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, EmptyState } from '@boletera/ui';
import {
  DataTable,
  type DataTableColumn,
} from '@boletera/ui/src/components/DataTable';
import { KpiCard } from '@boletera/ui/src/components/KpiCard';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import { Section } from '@boletera/ui/src/components/Section';
import { QueryError, QueryLoading } from '@/components/QueryStates';
import { downloadEgressOverviewCsv, type EgressOverviewVenue } from '@/lib/platform-api';
import { useEgressOverview } from '@/lib/queries/venues';
import { useSession } from '@/lib/use-session';
import {
  STATUS_LABEL,
  fmtNum,
  prioritizeRisks,
  severityLabel,
  severityRank,
  statusTone,
  type EgressStatus,
} from './_lib/risk';
import styles from './egress.module.scss';

type StatusFilter = 'all' | EgressStatus;

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'critical', label: 'Críticos' },
  { key: 'warn', label: 'Alertas' },
  { key: 'ok', label: 'OK' },
  { key: 'no-network', label: 'Sin red' },
  { key: 'empty', label: 'Vacíos' },
];

function riskCardClass(status: EgressStatus): string {
  if (status === 'critical') return `${styles.riskCard} ${styles.riskCritical}`;
  if (status === 'warn') return `${styles.riskCard} ${styles.riskWarn}`;
  if (status === 'no-network') return `${styles.riskCard} ${styles.riskNetwork}`;
  if (status === 'empty') return `${styles.riskCard} ${styles.riskEmpty}`;
  return styles.riskCard;
}

export default function EgressOverviewPage() {
  const { token } = useSession();
  const overview = useEgressOverview();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const data = overview.data;
  const counts = data?.counts;

  const rows = useMemo(() => {
    const list = data?.venues ?? [];
    if (filter === 'all') return list;
    return list.filter((venue) => venue.status === filter);
  }, [data, filter]);

  const risks = useMemo(() => prioritizeRisks(data?.venues ?? []), [data]);

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          severityRank(b.status) - severityRank(a.status) ||
          a.venueName.localeCompare(b.venueName, 'es'),
      ),
    [rows],
  );

  const columns: DataTableColumn<EgressOverviewVenue>[] = [
    {
      key: 'status',
      header: 'Estado',
      width: 170,
      sortValue: (row) => severityRank(row.status),
      render: (row) => (
        <div>
          <Badge tone={statusTone(row.status)} dot>
            {STATUS_LABEL[row.status]}
          </Badge>
          <div className={styles.reason}>{row.statusReason}</div>
        </div>
      ),
    },
    {
      key: 'venue',
      header: 'Venue',
      width: 200,
      sortValue: (row) => row.venueName,
      render: (row) => (
        <div className={styles.venueCell}>
          <strong>{row.venueName}</strong>
          <span className={styles.muted}>{severityLabel(severityRank(row.status))}</span>
        </div>
      ),
    },
    {
      key: 'sections',
      header: 'Secciones',
      width: 100,
      align: 'right',
      sortValue: (row) => row.sections,
      render: (row) => row.sections,
    },
    {
      key: 'unreachable',
      header: 'Sin acceso',
      width: 110,
      align: 'right',
      sortValue: (row) => row.unreachable,
      render: (row) => row.unreachable,
    },
    {
      key: 'clearance',
      header: 'Vaciado (min)',
      width: 120,
      align: 'right',
      sortValue: (row) => row.clearanceMinutes ?? -1,
      render: (row) => fmtNum(row.clearanceMinutes),
    },
    {
      key: 'path',
      header: 'Ruta máx.',
      width: 110,
      align: 'right',
      sortValue: (row) => row.maxPathLength ?? -1,
      render: (row) => fmtNum(row.maxPathLength, 0),
    },
    {
      key: 'bottleneck',
      header: 'Bottleneck',
      width: 150,
      sortValue: (row) => row.topBottleneckUtilization ?? -1,
      render: (row) => (
        <span>
          {row.topBottleneckUtilization != null
            ? `${Math.round(row.topBottleneckUtilization * 100)}%`
            : '—'}
          {row.topBottleneckKind ? (
            <span className={styles.muted}> · {row.topBottleneckKind}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acción',
      width: 130,
      render: (row) => (
        <Link href={`/venues/${row.venueId}/map`} className={styles.mapLink}>
          Abrir mapa
        </Link>
      ),
    },
  ];

  async function handleExport() {
    if (!token) {
      setExportError('Inicia sesión para exportar.');
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      await downloadEgressOverviewCsv(token);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo exportar el CSV');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <PageHeader
        eyebrow="Cumplimiento"
        title="Egress por venue"
        description="Salud de circulación y vaciado: severidades, narrativa de riesgo y acciones recomendadas sobre los layouts de la organización."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Reportes', href: '/reports' },
          { label: 'Egress' },
        ]}
        actions={
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
            >
              Actualizar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={exporting || !data}
              onClick={() => void handleExport()}
            >
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </Button>
          </div>
        }
      />

      {exportError ? (
        <p role="alert" className={styles.error}>
          {exportError}
        </p>
      ) : null}

      <Section columns={4} gap="md" aria-label="Resumen de severidad">
        <KpiCard
          label="OK"
          value={counts?.ok ?? '—'}
          loading={overview.isPending}
          tone="success"
          hint="Layouts con circulación válida"
        />
        <KpiCard
          label="Alertas"
          value={counts?.warn ?? '—'}
          loading={overview.isPending}
          tone="warning"
          hint="Severidad media · revisar rutas"
        />
        <KpiCard
          label="Críticos"
          value={counts?.critical ?? '—'}
          loading={overview.isPending}
          tone="danger"
          hint="Severidad alta · acción inmediata"
        />
        <KpiCard
          label="Sin red / vacío"
          value={
            counts == null ? '—' : (counts.noNetwork ?? 0) + (counts.empty ?? 0)
          }
          loading={overview.isPending}
          tone="neutral"
          hint="Configuración incompleta o sin layout"
        />
      </Section>

      {overview.isPending ? (
        <QueryLoading label="Analizando layouts de egress…" />
      ) : overview.error ? (
        <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
      ) : !data?.venues.length ? (
        <EmptyState
          title="Sin venues"
          description="Cuando existan venues con layout, el análisis de egress aparecerá aquí."
        />
      ) : (
        <>
          <section className={styles.panel} aria-labelledby="risk-title">
            <div className={styles.panelHead}>
              <h2 id="risk-title">Riesgos y narrativa</h2>
              <Badge tone={risks.length ? 'warning' : 'success'} dot>
                {risks.length ? `${risks.length} con atención` : 'Sin hallazgos'}
              </Badge>
            </div>
            {!risks.length ? (
              <p className={styles.muted}>
                Todos los venues analizados están en estado OK. Conserva evidencia periódica
                exportando el CSV.
              </p>
            ) : (
              <div className={styles.riskGrid}>
                {risks.map((card) => (
                  <article
                    key={card.venueId}
                    className={riskCardClass(card.status)}
                    aria-label={`${card.venueName}: ${card.headline}`}
                  >
                    <div className={styles.riskFooter}>
                      <Badge tone={statusTone(card.status)} dot>
                        {STATUS_LABEL[card.status]}
                      </Badge>
                      <span className={styles.muted}>{severityLabel(card.severity)}</span>
                    </div>
                    <h3 className={styles.riskTitle}>{card.venueName}</h3>
                    <p className={styles.riskNarrative}>{card.narrative}</p>
                    <ol className={styles.actionList}>
                      {card.actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ol>
                    <div className={styles.riskFooter}>
                      <Link href={`/venues/${card.venueId}/map`} className={styles.mapLink}>
                        Corregir en mapa
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className={styles.filters} role="tablist" aria-label="Filtrar por estado">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? styles.tabOn : styles.tab}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <section className={styles.panel} aria-labelledby="tech-title">
            <div className={styles.panelHead}>
              <h2 id="tech-title">Detalle técnico</h2>
              <span className={styles.muted}>
                {sortedRows.length} venue{sortedRows.length === 1 ? '' : 's'}
              </span>
            </div>
            {!sortedRows.length ? (
              <EmptyState
                title="Sin venues en este filtro"
                description="Prueba otro estado o limpia el filtro."
              />
            ) : (
              <DataTable
                label="Overview técnico de egress"
                columns={columns}
                data={sortedRows}
                rowKey={(row) => row.venueId}
                maxHeight={480}
                defaultSort={{ key: 'status', direction: 'desc' }}
              />
            )}
            {data.generatedAt ? (
              <p className={styles.footer}>
                Generado {new Date(data.generatedAt).toLocaleString('es-MX')}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
