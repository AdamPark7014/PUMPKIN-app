'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { Badge, Button, EmptyState } from '@boletera/ui';
import {
  DataTable,
  type DataTableColumn,
} from '@boletera/ui/src/components/DataTable';
import { FilterBar, type FilterDefinition, type FilterSelection } from '@boletera/ui/src/components/FilterBar';
import { KpiCard } from '@boletera/ui/src/components/KpiCard';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import { Section } from '@boletera/ui/src/components/Section';
import { Timeline, type TimelineItem } from '@boletera/ui/src/components/Timeline';
import { QueryError, QueryLoading } from '@/components/QueryStates';
import { useAuditLog } from '@/lib/queries/audit';
import { useSession } from '@/lib/use-session';
import {
  detectAnomalies,
  describeEntry,
  summarizeSensitive,
  type AuditAnomaly,
  type AuditRecord,
} from './_lib/anomalies';
import { downloadAuditCsv } from './_lib/export';
import {
  actionLabel,
  actionTone,
  entityLabel,
  isSensitiveAction,
  timelineTone,
} from './_lib/labels';
import styles from './audit.module.scss';

const LIMIT_OPTIONS = [50, 80, 150, 300] as const;

function anomalyClass(severity: AuditAnomaly['severity']): string {
  if (severity === 'critical') return `${styles.anomalyCard} ${styles.anomalyCritical}`;
  if (severity === 'warning') return `${styles.anomalyCard} ${styles.anomalyWarning}`;
  return styles.anomalyCard;
}

function anomalyTone(severity: AuditAnomaly['severity']): 'danger' | 'warning' | 'info' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AuditPage() {
  const { organizationId } = useSession();
  const [limit, setLimit] = useState<(typeof LIMIT_OPTIONS)[number]>(80);
  const [filters, setFilters] = useState<FilterSelection>({});
  const [query, setQuery] = useState('');
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const deferredQuery = useDeferredValue(query);

  const auditQuery = useAuditLog(organizationId, limit);
  const entries = useMemo<AuditRecord[]>(
    () => (auditQuery.data ?? []) as AuditRecord[],
    [auditQuery.data],
  );

  const summary = useMemo(() => summarizeSensitive(entries), [entries]);
  const anomalies = useMemo(() => detectAnomalies(entries), [entries]);

  const filterDefs: FilterDefinition[] = useMemo(() => {
    const actionCounts = new Map<string, number>();
    const entityCounts = new Map<string, number>();
    const actorCounts = new Map<string, number>();
    for (const entry of entries) {
      actionCounts.set(entry.action, (actionCounts.get(entry.action) ?? 0) + 1);
      entityCounts.set(entry.entityType, (entityCounts.get(entry.entityType) ?? 0) + 1);
      const actor = entry.userId ?? entry.ipAddress ?? 'system';
      actorCounts.set(actor, (actorCounts.get(actor) ?? 0) + 1);
    }
    return [
      {
        id: 'action',
        label: 'Acción',
        multiple: true,
        options: [...actionCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([value, count]) => ({
            value,
            label: actionLabel(value),
            count,
          })),
      },
      {
        id: 'entity',
        label: 'Recurso',
        multiple: true,
        options: [...entityCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({
            value,
            label: entityLabel(value),
            count,
          })),
      },
      {
        id: 'actor',
        label: 'Actor',
        multiple: true,
        options: [...actorCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([value, count]) => ({
            value,
            label: value === 'system' ? 'Sistema' : value,
            count,
          })),
      },
    ];
  }, [entries]);

  const filtered = useMemo(() => {
    const actions = filters.action ?? [];
    const entities = filters.entity ?? [];
    const actors = filters.actor ?? [];
    const needle = deferredQuery.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return entries.filter((entry) => {
      const actor = entry.userId ?? entry.ipAddress ?? 'system';
      const createdAt = new Date(entry.createdAt).getTime();
      if (sensitiveOnly && !isSensitiveAction(entry.action)) return false;
      if (actions.length && !actions.includes(entry.action)) return false;
      if (entities.length && !entities.includes(entry.entityType)) return false;
      if (actors.length && !actors.includes(actor)) return false;
      if (fromTime != null && createdAt < fromTime) return false;
      if (toTime != null && createdAt > toTime) return false;
      if (!needle) return true;
      const haystack = [
        entry.action,
        actionLabel(entry.action),
        entry.entityType,
        entry.entityId ?? '',
        entry.userId ?? '',
        entry.ipAddress ?? '',
        entry.metadata ? JSON.stringify(entry.metadata) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [dateFrom, dateTo, deferredQuery, entries, filters, sensitiveOnly]);

  const timelineItems: TimelineItem[] = useMemo(() => {
    const source = (sensitiveOnly ? filtered : entries.filter((e) => isSensitiveAction(e.action)))
      .slice(0, 12);
    return source.map((entry, index) => ({
      id: entry.id,
      title: actionLabel(entry.action),
      description: describeEntry(entry),
      timestamp: entry.createdAt,
      tone: timelineTone(entry.action),
      current: index === 0,
      children: (
        <Badge tone={actionTone(entry.action)} size="sm">
          {entityLabel(entry.entityType)}
        </Badge>
      ),
    }));
  }, [entries, filtered, sensitiveOnly]);

  const columns: DataTableColumn<AuditRecord>[] = [
    {
      key: 'createdAt',
      header: 'Fecha',
      width: 170,
      sortValue: (row) => row.createdAt,
      render: (row) => (
        <time dateTime={row.createdAt}>{formatWhen(row.createdAt)}</time>
      ),
    },
    {
      key: 'action',
      header: 'Acción',
      width: 200,
      sortValue: (row) => row.action,
      render: (row) => (
        <div className={styles.metaCell}>
          <Badge tone={actionTone(row.action)} dot={isSensitiveAction(row.action)}>
            {actionLabel(row.action)}
          </Badge>
          <code className={styles.code}>{row.action}</code>
        </div>
      ),
    },
    {
      key: 'entity',
      header: 'Recurso',
      width: 160,
      sortValue: (row) => row.entityType,
      render: (row) => (
        <div className={styles.metaCell}>
          <strong>{entityLabel(row.entityType)}</strong>
          <code className={styles.code}>
            {row.entityId ? `${row.entityId.slice(0, 12)}…` : '—'}
          </code>
        </div>
      ),
    },
    {
      key: 'actor',
      header: 'Actor / IP',
      width: 150,
      sortValue: (row) => row.userId ?? row.ipAddress ?? '',
      render: (row) => (
        <div className={styles.metaCell}>
          <code className={styles.code}>{row.userId ? row.userId.slice(0, 12) : 'sistema'}</code>
          <span className={styles.muted}>{row.ipAddress ?? '—'}</span>
        </div>
      ),
    },
  ];

  function handleExport() {
    if (!organizationId || !filtered.length) return;
    downloadAuditCsv(filtered, organizationId);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Cumplimiento"
        title="Auditoría"
        description="Trail inmutable de acciones críticas: filtros, timeline sensible, anomalías y exportación forense."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Auditoría' },
        ]}
        actions={
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={auditQuery.isFetching || !organizationId}
              onClick={() => void auditQuery.refetch()}
            >
              Actualizar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!organizationId || !filtered.length}
              onClick={handleExport}
            >
              Exportar CSV
            </Button>
          </div>
        }
      >
        <div className={styles.toggleRow}>
          <label className={styles.limitSelect}>
            Límite
            <select
              value={limit}
              onChange={(event) => {
                const next = Number(event.target.value);
                if ((LIMIT_OPTIONS as readonly number[]).includes(next)) {
                  setLimit(next as (typeof LIMIT_OPTIONS)[number]);
                }
              }}
              aria-label="Cantidad de eventos a cargar"
            >
              {LIMIT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={sensitiveOnly}
              onChange={(event) => setSensitiveOnly(event.target.checked)}
            />
            Solo actividad sensible
          </label>
          <label className={styles.dateField}>
            Desde
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label className={styles.dateField}>
            Hasta
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>
      </PageHeader>

      {!organizationId ? (
        <EmptyState
          title="Organización requerida"
          description="Inicia sesión con una organización para consultar el trail de auditoría."
        />
      ) : (
        <>
          <Section columns={4} gap="md" aria-label="Resumen de auditoría">
            <KpiCard
              label="Eventos cargados"
              value={summary.total}
              loading={auditQuery.isPending}
              tone="neutral"
            />
            <KpiCard
              label="Sensibles"
              value={summary.sensitive}
              loading={auditQuery.isPending}
              tone="warning"
              hint="Reembolsos, auth, equipo, cancelaciones"
            />
            <KpiCard
              label="Tipos de entidad"
              value={summary.entities}
              loading={auditQuery.isPending}
              tone="info"
            />
            <KpiCard
              label="Anomalías"
              value={anomalies.length}
              loading={auditQuery.isPending}
              tone={anomalies.some((a) => a.severity === 'critical') ? 'danger' : 'accent'}
              hint={
                summary.latestSensitiveAt
                  ? `Última sensible · ${formatWhen(summary.latestSensitiveAt)}`
                  : 'Sin actividad sensible'
              }
            />
          </Section>

          {auditQuery.isPending ? (
            <QueryLoading label="Cargando trail de auditoría…" />
          ) : auditQuery.error ? (
            <QueryError error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
          ) : !entries.length ? (
            <EmptyState
              title="Sin eventos aún"
              description="Cuando ocurran acciones auditables aparecerán en este centro."
            />
          ) : (
            <>
              <FilterBar
                filters={filterDefs}
                value={filters}
                onChange={setFilters}
                search={{
                  value: query,
                  onChange: setQuery,
                  placeholder: 'Buscar acción, entidad, usuario o IP…',
                }}
              />

              <div className={styles.layout}>
                <section className={styles.panel} aria-labelledby="trail-title">
                  <div className={styles.panelHead}>
                    <h2 id="trail-title">Trail filtrado</h2>
                    <span className={styles.muted}>
                      {filtered.length} de {entries.length}
                    </span>
                  </div>
                  {!filtered.length ? (
                    <EmptyState
                      title="Sin coincidencias"
                      description="Ajusta filtros o la búsqueda para ver eventos."
                    />
                  ) : (
                    <DataTable
                      label="Registro de auditoría"
                      columns={columns}
                      data={filtered}
                      rowKey={(row) => row.id}
                      maxHeight={520}
                      defaultSort={{ key: 'createdAt', direction: 'desc' }}
                      renderExpanded={(row) => (
                        <pre className={styles.code} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                          {row.metadata
                            ? JSON.stringify(row.metadata, null, 2)
                            : 'Sin metadata adicional'}
                        </pre>
                      )}
                    />
                  )}
                </section>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <section className={styles.panel} aria-labelledby="timeline-title">
                    <div className={styles.panelHead}>
                      <h2 id="timeline-title">Timeline sensible</h2>
                    </div>
                    {!timelineItems.length ? (
                      <p className={styles.muted}>No hay actividad sensible en la vista actual.</p>
                    ) : (
                      <Timeline items={timelineItems} density="sm" label="Actividad sensible" />
                    )}
                  </section>

                  <section className={styles.panel} aria-labelledby="anomaly-title">
                    <div className={styles.panelHead}>
                      <h2 id="anomaly-title">Anomalías</h2>
                      <Badge tone={anomalies.length ? 'warning' : 'success'} dot>
                        {anomalies.length ? `${anomalies.length} detectadas` : 'Sin hallazgos'}
                      </Badge>
                    </div>
                    {!anomalies.length ? (
                      <p className={styles.muted}>
                        Sin patrones anómalos en el trail cargado (ráfagas, reuso de token o
                        volumen sensible).
                      </p>
                    ) : (
                      <ul className={styles.anomalyList}>
                        {anomalies.map((item) => (
                          <li key={item.id} className={anomalyClass(item.severity)}>
                            <div className={styles.actions}>
                              <Badge tone={anomalyTone(item.severity)} dot>
                                {item.severity}
                              </Badge>
                              <span className={styles.muted}>×{item.count}</span>
                            </div>
                            <h3 className={styles.anomalyTitle}>{item.title}</h3>
                            <p className={styles.anomalyText}>{item.explanation}</p>
                            <p className={styles.anomalyAction}>
                              <strong>Acción:</strong> {item.suggestedAction}
                            </p>
                            <p className={styles.muted}>{formatWhen(item.detectedAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>

              <p className={styles.footerNote}>
                Exportación CSV generada en cliente a partir del trail cargado (la API no expone
                endpoint de export dedicado).
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
