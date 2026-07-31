'use client';

import { useMemo, useState } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  DataTable,
  DonutChart,
  Drawer,
  EmptyState,
  FilterBar,
  formatDateTime,
  formatNumber,
  formatPercent,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
  type ActivityItem,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import type { MetricsAlert } from '@boletera/shared';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  useFraudFlags,
  useFraudMetrics,
  useMetricsAlerts,
  useResolveFraudFlag,
  type FraudFlag,
} from '@/lib/queries';
import { fraudTypeLabel, severityRank, severityTone, statusTone } from './_lib/labels';
import {
  SUITE_RANGE_OPTIONS,
  buildSuiteRange,
  type SuiteRangeKey,
} from './_lib/range';
import styles from './suite.module.scss';

const FLAG_LIMIT = 100;

/** Campos adicionales que devuelve GET /fraud/flags. */
type FraudFlagRow = FraudFlag & {
  orderId?: string | null;
  eventId?: string | null;
  userId?: string | null;
  createdAt?: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
  order?: { publicId: string } | null;
  user?: { email: string } | null;
};

type ResolutionKind = 'confirmed' | 'false_positive' | 'monitor';

const RESOLUTION_PRESETS: Record<ResolutionKind, string> = {
  confirmed: 'Fraude confirmado tras revisión manual.',
  false_positive: 'Falso positivo: señal descartada tras verificación.',
  monitor: 'En monitoreo: sin acción inmediata; se mantiene vigilancia.',
};

function isOpenStatus(status: string): boolean {
  const s = status.toUpperCase();
  return s === 'FLAGGED' || s === 'INVESTIGATING' || s === 'OPEN';
}

function alertTone(severity: MetricsAlert['severity']): 'danger' | 'warning' | 'info' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
}

export default function FraudPage() {
  const toast = useToast();
  const [rangeKey, setRangeKey] = useState<SuiteRangeKey>('30d');
  const range = useMemo(() => buildSuiteRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({ from: range.from, to: range.to }),
    [range.from, range.to],
  );

  const [filters, setFilters] = useState<FilterSelection>({});
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionKind, setResolutionKind] = useState<ResolutionKind>('confirmed');

  const metricsQ = useFraudMetrics(metricsParams);
  const flagsQ = useFraudFlags(FLAG_LIMIT);
  const alertsQ = useMetricsAlerts(metricsParams);
  const resolveMutation = useResolveFraudFlag(FLAG_LIMIT);

  const flags = useMemo(
    () => (flagsQ.data ?? []) as FraudFlagRow[],
    [flagsQ.data],
  );

  const summary = metricsQ.data?.summary;
  const bySeverity = metricsQ.data?.bySeverity;
  const byType = metricsQ.data?.byType;
  const recentSignals = metricsQ.data?.recentSignals ?? [];

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const severities = Array.from(new Set(flags.map((f) => f.severity))).sort(
      (a, b) => severityRank(a) - severityRank(b),
    );
    const statuses = Array.from(new Set(flags.map((f) => f.status))).sort();
    const types = Array.from(new Set(flags.map((f) => f.type))).sort();
    return [
      {
        id: 'severity',
        label: 'Severidad',
        multiple: true,
        options: severities.map((value) => ({
          value,
          label: value,
          count: flags.filter((f) => f.severity === value).length,
        })),
      },
      {
        id: 'status',
        label: 'Estado',
        multiple: true,
        options: statuses.map((value) => ({
          value,
          label: value,
          count: flags.filter((f) => f.status === value).length,
        })),
      },
      {
        id: 'type',
        label: 'Tipo',
        multiple: true,
        options: types.map((value) => ({
          value,
          label: fraudTypeLabel(value),
          count: flags.filter((f) => f.type === value).length,
        })),
      },
    ];
  }, [flags]);

  const queue = useMemo(() => {
    const severityFilter = filters.severity ?? [];
    const statusFilter = filters.status ?? [];
    const typeFilter = filters.type ?? [];
    const q = search.trim().toLowerCase();

    return [...flags]
      .filter((flag) => {
        if (severityFilter.length && !severityFilter.includes(flag.severity)) return false;
        if (statusFilter.length && !statusFilter.includes(flag.status)) return false;
        if (typeFilter.length && !typeFilter.includes(flag.type)) return false;
        if (!q) return true;
        const hay = [
          flag.id,
          flag.type,
          flag.reason,
          flag.order?.publicId,
          flag.user?.email,
          flag.orderId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const openDelta = Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status));
        if (openDelta !== 0) return openDelta;
        const sev = severityRank(a.severity) - severityRank(b.severity);
        if (sev !== 0) return sev;
        return b.score - a.score;
      });
  }, [flags, filters, search]);

  const selected = useMemo(
    () => queue.find((f) => f.id === selectedId) ?? flags.find((f) => f.id === selectedId) ?? null,
    [flags, queue, selectedId],
  );

  const severitySlices = useMemo(
    () =>
      (bySeverity?.rows ?? []).map((row) => ({
        id: row.key,
        label: row.label,
        value: row.value,
      })),
    [bySeverity],
  );

  const typeRows = byType?.rows ?? [];
  const typeMax = Math.max(1, ...typeRows.map((r) => r.value));

  const fraudAlerts = useMemo(
    () => (alertsQ.data?.alerts ?? []).filter((a) => a.domain === 'fraud'),
    [alertsQ.data],
  );

  const recommendations = useMemo(() => {
    const items: MetricsAlert[] = [...fraudAlerts];
    if (summary && summary.criticalFlags > 0 && !items.some((a) => a.id === 'fraud-critical')) {
      items.push({
        id: 'local-critical',
        domain: 'fraud',
        severity: 'critical',
        title: 'Cola crítica sin resolver',
        explanation: `Hay ${summary.criticalFlags} banderas críticas y ${summary.openFlags} señales abiertas en el periodo.`,
        suggestedAction:
          'Abre la cola priorizada, revisa score alto primero y deja nota auditable al resolver.',
        metricValue: summary.criticalFlags,
        detectedAt: new Date().toISOString(),
      });
    }
    if (summary && summary.averageRiskScore >= 60) {
      items.push({
        id: 'local-score',
        domain: 'fraud',
        severity: 'warning',
        title: 'Score de riesgo elevado',
        explanation: `El score promedio del periodo es ${formatNumber(summary.averageRiskScore, 1)}.`,
        suggestedAction:
          'Revisa patrones por tipo (velocidad, bots, chargeback) y refuerza reglas en canales afectados.',
        metricValue: summary.averageRiskScore,
        detectedAt: new Date().toISOString(),
      });
    }
    if (summary && summary.openFlags === 0 && summary.totalFlags > 0) {
      items.push({
        id: 'local-clear',
        domain: 'fraud',
        severity: 'info',
        title: 'Cola limpia',
        explanation: 'No hay señales abiertas en el periodo seleccionado.',
        suggestedAction: 'Mantén monitoreo y revisa falsos positivos para afinar el modelo.',
        detectedAt: new Date().toISOString(),
      });
    }
    return items.slice(0, 6);
  }, [fraudAlerts, summary]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    const fromSignals = recentSignals.slice(0, 12).map((signal) => ({
      id: `signal-${signal.id}`,
      actor: 'Motor antifraude',
      action: 'detectó',
      target: fraudTypeLabel(signal.type),
      timestamp: signal.createdAt,
      detail: `${signal.severity} · score ${formatNumber(signal.score, 0)} — ${signal.reason}`,
    }));
    const resolved = flags
      .filter((f) => f.resolvedAt || f.status.toUpperCase() === 'RESOLVED')
      .slice(0, 8)
      .map((f) => ({
        id: `resolved-${f.id}`,
        actor: f.resolvedBy ?? 'Analista',
        action: 'resolvió',
        target: fraudTypeLabel(f.type),
        timestamp: f.resolvedAt ?? f.createdAt ?? new Date().toISOString(),
        detail: f.resolution ?? 'Sin nota de resolución',
      }));
    return [...fromSignals, ...resolved]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 16);
  }, [flags, recentSignals]);

  const columns = useMemo<DataTableColumn<FraudFlagRow>[]>(
    () => [
      {
        key: 'severity',
        header: 'Severidad',
        width: 120,
        sortValue: (row) => severityRank(row.severity),
        render: (row) => (
          <Badge tone={severityTone(row.severity)} dot>
            {row.severity}
          </Badge>
        ),
      },
      {
        key: 'score',
        header: 'Score',
        width: 88,
        align: 'right',
        sortValue: (row) => row.score,
        render: (row) => formatNumber(row.score, 0),
      },
      {
        key: 'type',
        header: 'Tipo',
        width: 180,
        sortValue: (row) => row.type,
        render: (row) => fraudTypeLabel(row.type),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 130,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={statusTone(row.status)} variant="outline">
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'reason',
        header: 'Motivo',
        width: 280,
        sortValue: (row) => row.reason,
        render: (row) => row.reason,
      },
      {
        key: 'order',
        header: 'Orden',
        width: 120,
        sortValue: (row) => row.order?.publicId ?? row.orderId ?? '',
        render: (row) => row.order?.publicId ?? row.orderId ?? '—',
      },
      {
        key: 'actions',
        header: 'Detalle',
        width: 100,
        resizable: false,
        render: (row) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedId(row.id);
              setResolutionNote('');
              setResolutionKind('confirmed');
            }}
          >
            Revisar
          </Button>
        ),
      },
    ],
    [],
  );

  const loading = metricsQ.isPending && flagsQ.isPending;
  const error = metricsQ.error ?? flagsQ.error;

  async function submitResolution() {
    if (!selected) return;
    const note = resolutionNote.trim() || RESOLUTION_PRESETS[resolutionKind];
    const prefix =
      resolutionKind === 'false_positive'
        ? '[FALSO_POSITIVO] '
        : resolutionKind === 'monitor'
          ? '[MONITOREO] '
          : '[CONFIRMADO] ';
    try {
      await resolveMutation.mutateAsync({
        flagId: selected.id,
        resolution: `${prefix}${note}`,
      });
      toast.success('Resolución registrada con nota auditable');
      setSelectedId(null);
      void metricsQ.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo resolver la señal');
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Riesgo y mercado"
        title="Fraude y compliance"
        description="Scorecard de riesgo, tendencia de señales, cola priorizada y resolución auditable."
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
          title="No se pudo cargar fraude"
          description={error instanceof Error ? error.message : 'Error desconocido'}
          illustration="error"
          tone="danger"
          action={
            <Button
              onClick={() => {
                void metricsQ.refetch();
                void flagsQ.refetch();
              }}
            >
              Reintentar
            </Button>
          }
        />
      ) : null}

      <section className={styles.kpiGrid} aria-label="Indicadores de fraude">
        <KpiCard
          label="Señales abiertas"
          value={formatNumber(summary?.openFlags ?? 0)}
          tone="warning"
          loading={loading}
          hint={range.comparisonLabel}
        />
        <KpiCard
          label="Críticas"
          value={formatNumber(summary?.criticalFlags ?? 0)}
          tone="danger"
          loading={loading}
          hint="Severidad CRITICAL"
        />
        <KpiCard
          label="Score promedio"
          value={formatNumber(summary?.averageRiskScore ?? 0, 1)}
          tone="accent"
          loading={loading}
          hint="Escala 0–100"
        />
        <KpiCard
          label="Resueltas / FP"
          value={`${formatNumber(summary?.resolvedFlags ?? 0)} / ${formatNumber(summary?.falsePositives ?? 0)}`}
          tone="success"
          loading={loading}
          hint={`Total periodo: ${formatNumber(summary?.totalFlags ?? 0)}`}
        />
      </section>

      <div className={styles.grid}>
        <Section
          title="Señales por severidad"
          description="Distribución del riesgo en el periodo seleccionado."
        >
          <Card padding="md">
            {metricsQ.isPending ? (
              <Skeleton height={220} />
            ) : severitySlices.length === 0 ? (
              <EmptyState
                size="sm"
                title="Sin señales en el periodo"
                description="Cuando el motor detecte actividad sospechosa aparecerá aquí."
                illustration="chart"
              />
            ) : (
              <DonutChart
                label="Señales de fraude por severidad"
                slices={severitySlices}
                centerLabel="Total"
                height={220}
              />
            )}
          </Card>
        </Section>

        <Section title="Tipos de señal" description="Volumen relativo por categoría.">
          <Card padding="md">
            {metricsQ.isPending ? (
              <div className={styles.stack}>
                <Skeleton height={18} />
                <Skeleton height={18} />
                <Skeleton height={18} />
              </div>
            ) : typeRows.length === 0 ? (
              <p className={styles.muted}>Sin desglose por tipo.</p>
            ) : (
              <div className={styles.breakdown} role="list" aria-label="Tipos de fraude">
                {typeRows.map((row) => (
                  <div key={row.key} className={styles.breakdownRow} role="listitem">
                    <div className={styles.breakdownMeta}>
                      <span>{fraudTypeLabel(row.label)}</span>
                      <strong>{formatNumber(row.value)}</strong>
                    </div>
                    <div className={styles.track} aria-hidden>
                      <div
                        className={styles.fill}
                        style={{ width: `${Math.round((row.value / typeMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Section>
      </div>

      <Section
        title="Cola priorizada"
        description="Abiertas primero, luego por severidad y score."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void flagsQ.refetch();
              void metricsQ.refetch();
            }}
          >
            Actualizar
          </Button>
        }
      >
        <Card padding="md" className={styles.panelBody}>
          <FilterBar
            filters={filterDefs}
            value={filters}
            onChange={setFilters}
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Buscar por motivo, orden o email…',
            }}
          />

          {flagsQ.isPending ? (
            <Skeleton height={280} />
          ) : queue.length === 0 ? (
            <EmptyState
              title="Sin alertas en la cola"
              description="No hay señales que coincidan con los filtros. Prueba ampliar el periodo o limpiar filtros."
              illustration="inbox"
              hints={[
                'Revisa el periodo en el encabezado',
                'Limpia filtros de severidad o estado',
                'Confirma que el motor antifraude esté activo',
              ]}
            />
          ) : (
            <DataTable
              label="Cola de señales de fraude"
              columns={columns}
              data={queue}
              rowKey={(row) => row.id}
              defaultSort={{ key: 'severity', direction: 'asc' }}
              maxHeight={420}
            />
          )}
        </Card>
      </Section>

      <div className={styles.grid}>
        <Section title="Actividad reciente" description="Detecciones del motor y resoluciones humanas.">
          <Card padding="md">
            <ActivityFeed
              label="Actividad de fraude"
              items={activityItems}
              loading={metricsQ.isPending && flagsQ.isPending}
              empty={
                <EmptyState
                  size="sm"
                  title="Sin actividad"
                  description="Aún no hay señales ni resoluciones en este periodo."
                  illustration="inbox"
                />
              }
            />
          </Card>
        </Section>

        <Section title="Recomendaciones" description="Acciones sugeridas a partir de métricas reales.">
          <Card padding="md">
            {recommendations.length === 0 ? (
              <EmptyState
                size="sm"
                title="Sin recomendaciones"
                description="El riesgo está dentro de umbrales normales."
                illustration="success"
                tone="success"
              />
            ) : (
              <ul className={styles.recs}>
                {recommendations.map((rec) => (
                  <li key={rec.id} className={styles.rec}>
                    <Badge tone={alertTone(rec.severity)} size="sm">
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

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? fraudTypeLabel(selected.type) : 'Detalle'}
        description="Revisión manual con nota auditable de resolución."
        size="lg"
        footer={
          selected && isOpenStatus(selected.status) ? (
            <div className={styles.resolutionActions}>
              <Button variant="ghost" onClick={() => setSelectedId(null)}>
                Cerrar
              </Button>
              <Button
                loading={resolveMutation.isPending}
                onClick={() => void submitResolution()}
              >
                Registrar resolución
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              Cerrar
            </Button>
          )
        }
      >
        {selected ? (
          <div className={styles.detail}>
            <dl>
              <dt>Severidad</dt>
              <dd>
                <Badge tone={severityTone(selected.severity)} dot>
                  {selected.severity}
                </Badge>
              </dd>
              <dt>Score</dt>
              <dd>{formatNumber(selected.score, 0)}</dd>
              <dt>Estado</dt>
              <dd>
                <Badge tone={statusTone(selected.status)} variant="outline">
                  {selected.status}
                </Badge>
              </dd>
              <dt>Motivo</dt>
              <dd>{selected.reason}</dd>
              <dt>Orden</dt>
              <dd>{selected.order?.publicId ?? selected.orderId ?? '—'}</dd>
              <dt>Usuario</dt>
              <dd>{selected.user?.email ?? selected.userId ?? '—'}</dd>
              <dt>IP</dt>
              <dd>{selected.ipAddress ?? '—'}</dd>
              <dt>Dispositivo</dt>
              <dd>{selected.deviceFingerprint ?? '—'}</dd>
              <dt>Detectada</dt>
              <dd>
                {selected.createdAt ? formatDateTime(selected.createdAt) : '—'}
              </dd>
              {selected.resolution ? (
                <>
                  <dt>Resolución previa</dt>
                  <dd>{selected.resolution}</dd>
                </>
              ) : null}
              {selected.resolvedAt ? (
                <>
                  <dt>Resuelta</dt>
                  <dd>
                    {formatDateTime(selected.resolvedAt)}
                    {selected.resolvedBy ? ` · ${selected.resolvedBy}` : ''}
                  </dd>
                </>
              ) : null}
            </dl>

            {isOpenStatus(selected.status) ? (
              <div className={styles.resolutionBox}>
                <p className={styles.muted}>
                  La nota queda registrada en el flag para auditoría. Elige el resultado y
                  documenta el criterio.
                </p>
                <SegmentedControl
                  label="Resultado de revisión"
                  size="sm"
                  value={resolutionKind}
                  onValueChange={setResolutionKind}
                  options={[
                    { value: 'confirmed', label: 'Confirmado' },
                    { value: 'false_positive', label: 'Falso positivo' },
                    { value: 'monitor', label: 'Monitoreo' },
                  ]}
                />
                <label>
                  <span className={styles.srOnly}>Nota de resolución</span>
                  <textarea
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder={RESOLUTION_PRESETS[resolutionKind]}
                    aria-label="Nota auditable de resolución"
                  />
                </label>
              </div>
            ) : (
              <p className={styles.muted}>
                Esta señal ya está cerrada. Score de referencia del periodo:{' '}
                {formatPercent((summary?.averageRiskScore ?? 0) / 100)}.
                {summary?.criticalFlags
                  ? ` Críticas abiertas: ${formatNumber(summary.criticalFlags)}.`
                  : null}
              </p>
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
