'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AreaChart,
  Badge,
  Button,
  DonutChart,
  EmptyState,
  KpiCard,
  SegmentedControl,
  StatusDot,
} from '@boletera/ui';
import { formatCurrency, formatNumber } from '@boletera/ui';
import {
  useChannelHealth,
  useConfigureChannels,
  useEvents,
  useExecutiveMetrics,
  useMetricsAlerts,
  useMetricsTimeseries,
  useResaleMetrics,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import {
  DEFAULT_ALLOCATION,
  RANGE_KEYS,
  allocationTotal,
  buildChannelAlerts,
  buildRange,
  buildRevenueMix,
  formatCount,
  formatDateShort,
  formatMs,
  formatMxn,
  formatPercentPoints,
  formatRelative,
  formatSeconds,
  healthStatusMeta,
  parseAllocationFromMetadata,
  parseChannelHealth,
  severityMeta,
  summarizeHealth,
  toChannelConfiguration,
  validateAllocation,
  type AllocationForm,
  type RangeKey,
} from './model';
import styles from './channels.module.scss';

function statusTone(
  tone: ReturnType<typeof healthStatusMeta>['tone'],
): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  return tone === 'accent' ? 'info' : tone;
}

export default function ChannelsPage() {
  const { organizationId } = useSession();
  const eventsQuery = useEvents();
  const [eventId, setEventId] = useState('');
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [allocation, setAllocation] = useState<AllocationForm>(DEFAULT_ALLOCATION);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const range = useMemo(() => buildRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      organizationId: organizationId ?? undefined,
      eventId: eventId || undefined,
    }),
    [eventId, organizationId, range.from, range.to],
  );

  useEffect(() => {
    if (!eventId && eventsQuery.data?.[0]) {
      setEventId(eventsQuery.data[0].id);
    }
  }, [eventId, eventsQuery.data]);

  const selectedEvent = eventsQuery.data?.find((event) => event.id === eventId);

  useEffect(() => {
    if (!selectedEvent) return;
    setAllocation(parseAllocationFromMetadata(selectedEvent.metadata));
    setSaveMessage(null);
    setSaveError(null);
  }, [selectedEvent]);

  const healthQuery = useChannelHealth(eventId);
  const executive = useExecutiveMetrics(metricsParams);
  const timeseries = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'orders',
  });
  const resale = useResaleMetrics(metricsParams);
  const alertsQuery = useMetricsAlerts(metricsParams);
  const configure = useConfigureChannels(eventId);

  const healthCards = useMemo(
    () => parseChannelHealth(healthQuery.data),
    [healthQuery.data],
  );

  const healthSummary = useMemo(() => summarizeHealth(healthCards), [healthCards]);

  const mix = useMemo(() => {
    const breakdown = executive.data?.revenueByChannel;
    const rows = breakdown?.rows ?? [];
    const total = breakdown?.total ?? 0;
    const slices = buildRevenueMix(rows, total);

    // Incorpora reventa cuando el endpoint de métricas la reporta y el mix no la trae.
    const resaleGmv = resale.data?.summary.grossGmv ?? 0;
    if (resaleGmv > 0 && !slices.some((slice) => slice.id.toUpperCase() === 'RESALE')) {
      const nextTotal = total + resaleGmv;
      return [
        ...slices.map((slice) => ({
          ...slice,
          percent: nextTotal > 0 ? Math.round((slice.value / nextTotal) * 1000) / 10 : 0,
        })),
        {
          id: 'RESALE',
          label: 'Reventa',
          value: resaleGmv,
          orders: resale.data?.summary.soldListings ?? 0,
          percent: nextTotal > 0 ? Math.round((resaleGmv / nextTotal) * 1000) / 10 : 0,
        },
      ].sort((a, b) => b.value - a.value);
    }
    return slices;
  }, [executive.data?.revenueByChannel, resale.data?.summary]);

  const allocationIssue = useMemo(() => validateAllocation(allocation), [allocation]);
  const totalPct = allocationTotal(allocation);

  const localAlerts = useMemo(
    () => buildChannelAlerts(healthCards, mix, allocation, allocationIssue),
    [allocation, allocationIssue, healthCards, mix],
  );

  const metricAlerts = useMemo(() => {
    const list = alertsQuery.data?.alerts ?? [];
    return list
      .filter(
        (alert) =>
          alert.domain === 'orders' ||
          alert.domain === 'resale' ||
          alert.entityType === 'event',
      )
      .slice(0, 4);
  }, [alertsQuery.data?.alerts]);

  const ordersSeries = useMemo(() => {
    const points = timeseries.data?.series?.[0]?.points ?? [];
    return [
      {
        id: 'orders',
        name: 'Órdenes',
        data: points.map((point) => ({
          label: formatDateShort(point.bucket),
          value: point.value,
        })),
      },
    ];
  }, [timeseries.data?.series]);

  const donutSlices = useMemo(
    () =>
      mix.map((slice) => ({
        id: slice.id,
        label: slice.label,
        value: slice.value,
      })),
    [mix],
  );

  const noEvents = !eventsQuery.isPending && (eventsQuery.data?.length ?? 0) === 0;
  const anyError =
    healthQuery.error ||
    executive.error ||
    timeseries.error ||
    eventsQuery.error ||
    saveError;
  const generatedAt =
    executive.data?.generatedAt ??
    timeseries.data?.generatedAt ??
    alertsQuery.data?.generatedAt ??
    null;

  function updateAllocation<K extends keyof AllocationForm>(key: K, value: AllocationForm[K]) {
    setAllocation((current) => ({ ...current, [key]: value }));
    setSaveMessage(null);
    setSaveError(null);
  }

  async function handleSave() {
    if (!eventId) return;
    const issue = validateAllocation(allocation);
    if (issue) {
      setSaveError(issue.message);
      return;
    }
    setSaveError(null);
    setSaveMessage(null);
    try {
      await configure.mutateAsync(toChannelConfiguration(allocation));
      setSaveMessage('Asignación de canales guardada.');
      void eventsQuery.refetch();
      void healthQuery.refetch();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'No se pudo guardar la configuración.',
      );
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.pageHeader}>
        <div className={styles.headerCopy}>
          <div className={styles.eyebrowRow}>
            <p className={styles.eyebrow}>Revenue · Distribución</p>
            {generatedAt ? (
              <Badge tone="neutral" variant="outline" size="sm" dot>
                Actualizado {formatRelative(generatedAt)}
              </Badge>
            ) : null}
          </div>
          <h1>Canales de venta</h1>
          <p className={styles.lead}>
            Salud web / POS / API / reventa, mix de ingresos, latencia y asignación de inventario
          </p>
        </div>

        <div className={styles.headerControls}>
          <label className={styles.srOnly} htmlFor="channel-event">
            Evento
          </label>
          <select
            id="channel-event"
            className={styles.eventSelect}
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            disabled={eventsQuery.isPending || noEvents}
          >
            {noEvents ? <option value="">Sin eventos</option> : null}
            {(eventsQuery.data ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>

          <SegmentedControl
            label="Rango temporal"
            size="sm"
            value={rangeKey}
            onValueChange={(value) => setRangeKey(value)}
            options={RANGE_KEYS.map((key) => ({
              value: key,
              label: buildRange(key).label.replace(' días', 'd'),
            }))}
          />

          {eventId ? (
            <Link href={`/events/${eventId}`}>
              <Button type="button" variant="outline">
                Hub del evento
              </Button>
            </Link>
          ) : null}
        </div>
      </header>

      {anyError ? (
        <div className={styles.errorBanner} role="alert">
          <div>
            <strong>No se pudieron cargar o guardar algunos datos</strong>
            <p>
              {typeof anyError === 'string'
                ? anyError
                : anyError instanceof Error
                  ? anyError.message
                  : 'Revisa la conexión o reintenta.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSaveError(null);
              void eventsQuery.refetch();
              void healthQuery.refetch();
              void executive.refetch();
              void timeseries.refetch();
              void alertsQuery.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {saveMessage ? (
        <div className={styles.successBanner} role="status">
          {saveMessage}
        </div>
      ) : null}

      {noEvents ? (
        <section className={styles.panel}>
          <EmptyState
            title="Necesitas un evento para configurar canales"
            description="La salud, la asignación y el mix de ingresos se calculan por evento."
            illustration="inbox"
            action={
              <Link href="/events/new">
                <Button type="button">Crear evento</Button>
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <section className={styles.kpiGrid} aria-label="Indicadores de canales">
            <KpiCard
              label="Canales saludables"
              value={
                healthQuery.isPending
                  ? '—'
                  : `${formatCount(healthSummary.healthy)}/${formatCount(healthCards.length)}`
              }
              hint={`${formatCount(healthSummary.degraded)} degradados · ${formatCount(healthSummary.down)} caídos`}
              loading={healthQuery.isPending}
              tone={
                healthSummary.down > 0
                  ? 'danger'
                  : healthSummary.degraded > 0
                    ? 'warning'
                    : 'success'
              }
            />
            <KpiCard
              label="Ingreso del evento"
              value={healthQuery.isPending ? '—' : formatMxn(healthSummary.totalRevenue)}
              unit="MXN"
              hint={`${formatCount(healthSummary.totalOrders)} órdenes en salud`}
              loading={healthQuery.isPending}
              tone="accent"
            />
            <KpiCard
              label="Peor latencia"
              value={
                healthQuery.isPending
                  ? '—'
                  : formatMs(healthSummary.worstLatencyMs)
              }
              hint="Respuesta media observada"
              loading={healthQuery.isPending}
              tone={
                (healthSummary.worstLatencyMs ?? 0) >= 800
                  ? 'warning'
                  : 'neutral'
              }
            />
            <KpiCard
              label="Peor error rate"
              value={
                healthQuery.isPending
                  ? '—'
                  : healthSummary.worstErrorRate === null
                    ? '—'
                    : formatPercentPoints(healthSummary.worstErrorRate * 100)
              }
              hint="Máximo entre canales reportados"
              loading={healthQuery.isPending}
              invertDelta
              tone={
                (healthSummary.worstErrorRate ?? 0) >= 0.05 ? 'danger' : 'success'
              }
            />
            <KpiCard
              label="GMV reventa"
              value={resale.isPending ? '—' : formatMxn(resale.data?.summary.grossGmv)}
              hint={`${formatCount(resale.data?.summary.activeListings)} listings activos`}
              loading={resale.isPending}
              tone="info"
            />
            <KpiCard
              label="Asignación"
              value={`${totalPct} %`}
              hint={allocationIssue ? 'Ajusta a 100 %' : 'Lista para guardar'}
              tone={allocationIssue ? 'warning' : 'success'}
            />
          </section>

          <section aria-labelledby="health-heading">
            <div className={styles.panelHead} style={{ marginBottom: '0.75rem' }}>
              <div>
                <h2 id="health-heading">Salud en tiempo real</h2>
                <p>Web, taquilla POS, API partners y señales de reventa del evento</p>
              </div>
            </div>

            {healthQuery.isPending ? (
              <div className={styles.healthGrid} aria-busy="true">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className={styles.skeleton} />
                ))}
              </div>
            ) : healthCards.length === 0 ? (
              <section className={styles.panel}>
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="chart"
                  title="Sin telemetría todavía"
                  description="Cuando haya órdenes o terminales activas, aquí verás latencia, errores y volumen por canal."
                />
              </section>
            ) : (
              <div className={styles.healthGrid}>
                {healthCards.map((card) => {
                  const meta = healthStatusMeta(card.status);
                  return (
                    <article key={card.key} className={styles.healthCard}>
                      <div className={styles.healthTop}>
                        <div>
                          <StatusDot
                            tone={statusTone(meta.tone)}
                            pulse={card.status === 'healthy'}
                            label={card.label}
                          />
                          <h3 className={styles.srOnly}>{card.label}</h3>
                        </div>
                        <Badge tone={meta.tone} size="sm" variant="soft">
                          {meta.label}
                        </Badge>
                      </div>
                      <dl className={styles.healthMeta}>
                        <div>
                          <dt>Órdenes</dt>
                          <dd>{formatCount(card.orders)}</dd>
                        </div>
                        <div>
                          <dt>Ingreso</dt>
                          <dd>{formatMxn(card.revenue)}</dd>
                        </div>
                        {card.latencyMs !== null ? (
                          <div>
                            <dt>Latencia</dt>
                            <dd>{formatMs(card.latencyMs)}</dd>
                          </div>
                        ) : null}
                        {card.errorRate !== null ? (
                          <div>
                            <dt>Errores</dt>
                            <dd>{formatPercentPoints(card.errorRate * 100)}</dd>
                          </div>
                        ) : null}
                        {card.syncLagSec !== null ? (
                          <div>
                            <dt>Sync lag</dt>
                            <dd>{formatSeconds(card.syncLagSec)}</dd>
                          </div>
                        ) : null}
                        {card.activeTerminals !== null ? (
                          <div>
                            <dt>Terminales</dt>
                            <dd>{formatCount(card.activeTerminals)}</dd>
                          </div>
                        ) : null}
                        {card.activePartners !== null ? (
                          <div>
                            <dt>Partners</dt>
                            <dd>{formatCount(card.activePartners)}</dd>
                          </div>
                        ) : null}
                        {card.rateLimitUsage !== null ? (
                          <div>
                            <dt>Rate limit</dt>
                            <dd>{formatPercentPoints(card.rateLimitUsage)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className={styles.twoCol}>
            <section className={styles.panel} aria-labelledby="mix-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="mix-heading">Mix de ingresos</h2>
                  <p>Distribución del periodo {range.label.toLowerCase()}</p>
                </div>
              </div>
              {executive.isPending ? (
                <div className={styles.skeleton} aria-busy="true" />
              ) : donutSlices.length === 0 ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="chart"
                  title="Sin ventas por canal"
                  description="Las órdenes completadas alimentarán el mix de web, POS, API y reventa."
                />
              ) : (
                <>
                  <DonutChart
                    label="Mix de ingresos por canal"
                    slices={donutSlices}
                    centerLabel="MXN"
                    formatValue={(value) => formatCurrency(value, 0)}
                    height={220}
                  />
                  <ul className={styles.mixList}>
                    {mix.map((slice) => (
                      <li key={slice.id} className={styles.mixItem}>
                        <span className={styles.mixName}>{slice.label}</span>
                        <span className={styles.mixOrders}>
                          {slice.orders > 0
                            ? `${formatCount(slice.orders)} órdenes`
                            : `${formatPercentPoints(slice.percent)}`}
                        </span>
                        <strong className={styles.mixRev}>{formatMxn(slice.value)}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="series-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="series-heading">Órdenes en el tiempo</h2>
                  <p>
                    Serie {range.label.toLowerCase()} · granularidad{' '}
                    {range.granularity === 'week' ? 'semanal' : 'diaria'}
                  </p>
                </div>
              </div>
              {timeseries.isPending ? (
                <div className={styles.skeleton} aria-busy="true" />
              ) : ordersSeries[0]!.data.length < 2 ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="chart"
                  title="Sin serie suficiente"
                  description="Se necesitan al menos dos puntos del periodo para dibujar la tendencia."
                />
              ) : (
                <AreaChart
                  label="Órdenes del periodo"
                  series={ordersSeries}
                  formatValue={(value) => formatNumber(value)}
                  height={220}
                />
              )}
            </section>
          </div>

          <div className={styles.twoCol}>
            <section className={styles.panel} aria-labelledby="latency-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="latency-heading">Latencia y errores</h2>
                  <p>Señales operativas por canal para decidir reasignaciones</p>
                </div>
              </div>
              {healthQuery.isPending ? (
                <div className={styles.listSkeleton} aria-busy="true">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className={styles.skeletonRow} />
                  ))}
                </div>
              ) : healthCards.length === 0 ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="inbox"
                  title="Sin métricas de latencia"
                  description="Aparecerán cuando el backend reporte responseTimeMs o errorRate."
                />
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.latencyTable}>
                    <thead>
                      <tr>
                        <th scope="col">Canal</th>
                        <th scope="col">Estado</th>
                        <th scope="col">Latencia</th>
                        <th scope="col">Errores</th>
                        <th scope="col">Señal extra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthCards.map((card) => {
                        const meta = healthStatusMeta(card.status);
                        const extra =
                          card.syncLagSec !== null
                            ? `Sync ${formatSeconds(card.syncLagSec)}`
                            : card.rateLimitUsage !== null
                              ? `Rate ${formatPercentPoints(card.rateLimitUsage)}`
                              : card.activeTerminals !== null
                                ? `${formatCount(card.activeTerminals)} terminales`
                                : card.activePartners !== null
                                  ? `${formatCount(card.activePartners)} partners`
                                  : '—';
                        return (
                          <tr key={card.key}>
                            <td>{card.label}</td>
                            <td>
                              <Badge tone={meta.tone} size="sm" variant="soft" dot>
                                {meta.label}
                              </Badge>
                            </td>
                            <td>{formatMs(card.latencyMs)}</td>
                            <td>
                              {card.errorRate === null
                                ? '—'
                                : formatPercentPoints(card.errorRate * 100)}
                            </td>
                            <td>{extra}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="alerts-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="alerts-heading">Alertas y recomendaciones</h2>
                  <p>Derivadas de salud, asignación y métricas de plataforma</p>
                </div>
              </div>
              {localAlerts.length === 0 && metricAlerts.length === 0 ? (
                <EmptyState
                  size="sm"
                  tone="success"
                  illustration="success"
                  title="Sin alertas de canal"
                  description="Latencia, errores y asignación están dentro de umbrales normales."
                />
              ) : (
                <ul className={styles.alertList}>
                  {localAlerts.slice(0, 6).map((alert) => {
                    const meta = severityMeta(alert.severity);
                    return (
                      <li key={alert.id} className={styles.alertItem}>
                        <Badge tone={meta.tone} size="sm" variant="soft" dot>
                          {meta.label}
                        </Badge>
                        <strong className={styles.alertTitle}>{alert.title}</strong>
                        <p className={styles.alertBody}>{alert.explanation}</p>
                        <p className={styles.alertAction}>{alert.suggestion}</p>
                      </li>
                    );
                  })}
                  {metricAlerts.map((alert) => (
                    <li key={alert.id} className={styles.alertItem}>
                      <Badge
                        tone={
                          alert.severity === 'critical'
                            ? 'danger'
                            : alert.severity === 'warning'
                              ? 'warning'
                              : 'info'
                        }
                        size="sm"
                        variant="soft"
                        dot
                      >
                        {alert.severity === 'critical'
                          ? 'Crítica'
                          : alert.severity === 'warning'
                            ? 'Atención'
                            : 'Info'}
                      </Badge>
                      <strong className={styles.alertTitle}>{alert.title}</strong>
                      <p className={styles.alertBody}>{alert.explanation}</p>
                      <p className={styles.alertAction}>{alert.suggestedAction}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className={styles.panel} aria-labelledby="config-heading">
            <div className={styles.panelHead}>
              <div>
                <h2 id="config-heading">Configuración de asignación</h2>
                <p>
                  {selectedEvent
                    ? `Inventario porcentual para ${selectedEvent.title}`
                    : 'Inventario porcentual por canal'}
                </p>
              </div>
            </div>

            <div className={styles.formGrid}>
              {(
                [
                  {
                    key: 'web' as const,
                    enabledKey: 'webEnabled' as const,
                    label: 'Web',
                    hint: 'Checkout online y mapa de asientos.',
                  },
                  {
                    key: 'taquilla' as const,
                    enabledKey: 'taquillaEnabled' as const,
                    label: 'POS / Taquilla',
                    hint: 'Terminales físicas y taquillas del venue.',
                  },
                  {
                    key: 'api' as const,
                    enabledKey: 'apiEnabled' as const,
                    label: 'API partners',
                    hint: 'Integraciones B2B con rate limits propios.',
                  },
                  {
                    key: 'phone' as const,
                    enabledKey: 'phoneEnabled' as const,
                    label: 'Teléfono',
                    hint: 'Canal opcional; suma al 100 % solo si está habilitado.',
                  },
                ] as const
              ).map((field) => (
                <div key={field.key} className={styles.channelField}>
                  <div className={styles.channelFieldHead}>
                    <span className={styles.channelFieldLabel}>{field.label}</span>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={allocation[field.enabledKey]}
                        onChange={(event) =>
                          updateAllocation(field.enabledKey, event.target.checked)
                        }
                      />
                      {allocation[field.enabledKey] ? 'Habilitado' : 'Apagado'}
                    </label>
                  </div>
                  <label>
                    <span className={styles.fieldLabel}>Asignación (%)</span>
                    <input
                      className={styles.input}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      disabled={!allocation[field.enabledKey]}
                      value={allocation[field.key]}
                      onChange={(event) =>
                        updateAllocation(field.key, Number(event.target.value) || 0)
                      }
                      aria-describedby={`hint-${field.key}`}
                    />
                  </label>
                  <span className={styles.fieldHint} id={`hint-${field.key}`}>
                    {field.hint}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.totalRow}>
              <p className={totalPct === 100 ? styles.totalOk : styles.totalBad} aria-live="polite">
                Total asignado: {totalPct} %
                {allocationIssue ? ` · ${allocationIssue.message}` : ' · listo para guardar'}
              </p>
              <div className={styles.formActions}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (selectedEvent) {
                      setAllocation(parseAllocationFromMetadata(selectedEvent.metadata));
                    } else {
                      setAllocation(DEFAULT_ALLOCATION);
                    }
                    setSaveError(null);
                    setSaveMessage(null);
                  }}
                >
                  Restablecer
                </Button>
                <Button
                  type="button"
                  loading={configure.isPending}
                  disabled={Boolean(allocationIssue) || !eventId}
                  onClick={() => void handleSave()}
                >
                  Guardar asignación
                </Button>
              </div>
            </div>

            <div className={styles.callout}>
              Guardar solo actualiza la configuración del evento. No reasigna inventario ya vendido
              ni apaga un canal con órdenes en curso; para eso usa el hub del evento o el flujo de
              reasignación dinámica.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
