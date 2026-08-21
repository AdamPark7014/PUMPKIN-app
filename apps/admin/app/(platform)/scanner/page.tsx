'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  SegmentedControl,
  StatusDot,
} from '@boletera/ui';
import type { MetricsAlert } from '@boletera/shared';
import {
  useAccessMetrics,
  useMetricsAlerts,
  useMetricsTimeseries,
} from '@/lib/queries';
import { useEvents } from '@/lib/queries/events';
import { useSession } from '@/lib/use-session';
import { AccessPointsPanel } from './AccessPointsPanel';
import { ArrivalCurve } from './ArrivalCurve';
import { CameraScanner } from './CameraScanner';
import { IncidentsPanel } from './IncidentsPanel';
import { LiveKpis } from './LiveKpis';
import { ScanFeedback, type FeedbackState } from './ScanFeedback';
import { formatRelative } from './format';
import { RANGE_OPTIONS, buildScannerRange } from './range';
import { readHighVisibility, writeHighVisibility } from './scan-store';
import { useScanStation } from './useScanStation';
import type { Incident, RangeKey, ScanSource } from './types';
import styles from './scanner.module.scss';

const IDLE_FEEDBACK: FeedbackState = {
  verdict: 'idle',
  title: 'Listo para escanear',
  detail: 'Apunta al QR o pega el código BLT-…',
};

const METRICS_POLL_MS = 30_000;

function alertToIncident(alert: MetricsAlert): Incident {
  return {
    id: `platform-${alert.id}`,
    tone: alert.severity,
    title: alert.title,
    detail: alert.explanation || alert.suggestedAction,
    at: alert.detectedAt,
    origin: 'platform',
  };
}

export default function ScannerPage() {
  const { organizationId } = useSession();
  const [rangeKey, setRangeKey] = useState<RangeKey>('today');
  const [eventId, setEventId] = useState('');
  const [highVis, setHighVis] = useState(false);
  const station = useScanStation();

  const range = useMemo(() => buildScannerRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      organizationId: organizationId ?? undefined,
      eventId: eventId || undefined,
    }),
    [eventId, organizationId, range.from, range.to],
  );

  const access = useAccessMetrics(metricsParams);
  const timeseries = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'checkins',
  });
  const alerts = useMetricsAlerts(metricsParams);
  const events = useEvents();

  useEffect(() => {
    setHighVis(readHighVisibility());
  }, []);

  const refetchAccess = access.refetch;
  const refetchTimeseries = timeseries.refetch;
  const refetchAlerts = alerts.refetch;
  const clearFeedback = station.clearFeedback;
  const lastResultId = station.lastResult?.id;
  const lastVerdict = station.lastResult?.verdict;

  useEffect(() => {
    const id = window.setInterval(() => {
      void refetchAccess();
      void refetchTimeseries();
      void refetchAlerts();
    }, METRICS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refetchAccess, refetchAlerts, refetchTimeseries]);

  useEffect(() => {
    if (!lastResultId) return;
    if (lastVerdict === 'approved') {
      void refetchAccess();
      void refetchTimeseries();
    }
    const timer = window.setTimeout(() => clearFeedback(), 6_000);
    return () => window.clearTimeout(timer);
  }, [clearFeedback, lastResultId, lastVerdict, refetchAccess, refetchTimeseries]);

  const scanFn = station.scan;
  const onScan = useCallback(
    (raw: string, source: ScanSource) => {
      void scanFn(raw, source);
    },
    [scanFn],
  );

  const feedback: FeedbackState = station.lastResult
    ? {
        verdict: station.lastResult.verdict,
        title: station.lastResult.title,
        detail: station.lastResult.detail,
        code: station.log[0]?.ticket?.code,
      }
    : IDLE_FEEDBACK;

  const arrivalPoints = useMemo(() => {
    const fromTs = timeseries.data?.series?.[0]?.points;
    if (fromTs?.length) return fromTs;
    return access.data?.checkInByHour?.points ?? [];
  }, [access.data?.checkInByHour?.points, timeseries.data?.series]);

  const doorRows = access.data?.trafficByAccessPoint?.rows ?? [];
  const doorTotal = access.data?.trafficByAccessPoint?.total ?? 0;

  const platformError =
    access.error instanceof Error
      ? access.error.message
      : timeseries.error instanceof Error
        ? timeseries.error.message
        : null;

  const incidents = useMemo(() => {
    const local: Incident[] = station.log
      .filter((r) => r.verdict === 'rejected')
      .slice(0, 12)
      .map((r) => ({
        id: `station-${r.id}`,
        tone: 'warning' as const,
        title: 'Escaneo rechazado',
        detail: r.reason ?? r.ticket?.eventTitle ?? r.raw.slice(0, 48),
        at: r.at,
        origin: 'station' as const,
      }));

    const platform = (alerts.data?.alerts ?? [])
      .filter((a) => a.domain === 'access' || a.severity === 'critical')
      .slice(0, 8)
      .map(alertToIncident);

    return [...local, ...platform]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 16);
  }, [alerts.data?.alerts, station.log]);

  const generatedAt =
    access.data?.generatedAt ?? timeseries.data?.generatedAt ?? alerts.data?.generatedAt ?? null;
  const metricsLoading = access.isPending || timeseries.isPending;
  const metricsDegraded = Boolean(platformError) && !access.data;
  const queued = station.queue.length;

  const connectivityTone =
    station.connectivity === 'online'
      ? 'success'
      : station.connectivity === 'degraded'
        ? 'warning'
        : 'danger';

  const connectivityLabel =
    station.connectivity === 'offline'
      ? 'Offline — cola activa'
      : station.connectivity === 'degraded'
        ? 'Degradado — reintentos activos'
        : 'En línea';

  return (
    <div className={`${styles.page} ${highVis ? styles.highVis : ''}`}>
      <PageHeader
        eyebrow="Operación en puerta"
        title="Command center de accesos"
        description="Escaneo en vivo, throughput, no-show e incidentes · Puebla"
        actions={
          <div className={styles.headerActions}>
            <Button
              type="button"
              variant={highVis ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                setHighVis((prev) => {
                  const next = !prev;
                  writeHighVisibility(next);
                  return next;
                });
              }}
              aria-pressed={highVis}
            >
              Alta visibilidad
            </Button>
            <SegmentedControl
              label="Modo de acceso"
              size="sm"
              value={station.direction}
              onValueChange={(value) => station.setDirection(value)}
              options={[
                { value: 'ENTRY', label: 'Entrada' },
                { value: 'EXIT', label: 'Salida' },
              ]}
            />
            <Button
              type="button"
              variant={station.soundEnabled ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => station.setSoundEnabled(!station.soundEnabled)}
              aria-pressed={station.soundEnabled}
            >
              {station.soundEnabled ? 'Sonido on' : 'Sonido off'}
            </Button>
            {queued > 0 && station.online ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void station.flushQueue()}
              >
                Sincronizar cola ({queued})
              </Button>
            ) : null}
          </div>
        }
      >
        <div className={styles.toolbar}>
          <div className={styles.statusCluster} role="status">
            <StatusDot
              tone={connectivityTone}
              pulse={station.connectivity === 'online'}
              label={connectivityLabel}
            />
            {queued > 0 ? (
              <Badge tone="warning" variant="soft" size="sm">
                {queued} en cola
              </Badge>
            ) : null}
            {metricsDegraded ? (
              <Badge tone="danger" variant="soft" size="sm">
                Métricas degradadas
              </Badge>
            ) : null}
            {generatedAt ? (
              <Badge tone="neutral" variant="outline" size="sm" dot>
                Actualizado {formatRelative(generatedAt)}
              </Badge>
            ) : null}
          </div>
          <div className={styles.filterRow}>
            <label className={styles.stationField}>
              <span>Estación</span>
              <input
                value={station.station}
                onChange={(e) => station.setStation(e.target.value)}
                placeholder="Puerta A"
                autoComplete="off"
              />
            </label>
            <label className={styles.stationField}>
              <span>Evento</span>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                disabled={events.isPending}
              >
                <option value="">Todos</option>
                {(events.data ?? []).map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
            <SegmentedControl
              label="Rango de métricas"
              size="sm"
              value={rangeKey}
              onValueChange={setRangeKey}
              options={RANGE_OPTIONS}
            />
          </div>
        </div>
      </PageHeader>

      {platformError && !metricsDegraded ? (
        <p className={styles.degradeBanner} role="status">
          Algunas métricas fallaron: {platformError}. El escaneo sigue disponible.
        </p>
      ) : null}
      {metricsDegraded ? (
        <p className={styles.degradeBanner} role="alert">
          Sin datos de plataforma ({platformError}). Modo estación local activo.
        </p>
      ) : null}
      {station.connectivity === 'degraded' ? (
        <p className={styles.degradeBanner} role="status">
          API inestable: los escaneos se encolan y se reintentan automáticamente.
        </p>
      ) : null}

      <LiveKpis
        stats={{ ...station.stats, queued }}
        ticketsCheckedIn={access.data?.ticketsCheckedIn ?? null}
        ticketsNoShow={access.data?.ticketsNoShow ?? null}
        noShowRate={access.data?.noShowRate ?? null}
        loading={metricsLoading}
        degraded={metricsDegraded}
      />

      <div className={styles.layout}>
        <section className={styles.stationCol} aria-label="Estación de escaneo">
          <Card className={styles.scanCard} padding="md">
            <CardHeader
              title="Estación de escaneo"
              description="Cámara o entrada manual · fotogramas no se guardan"
            />
            <ScanFeedback feedback={feedback} />
            <CameraScanner onScan={onScan} disabled={station.queueing} />
          </Card>

          {queued > 0 ? (
            <Card className={styles.panel} padding="md">
              <CardHeader
                title="Cola offline"
                description={`${queued} pendientes de sincronizar`}
                actions={
                  station.online ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void station.flushQueue()}
                    >
                      Sincronizar
                    </Button>
                  ) : null
                }
              />
              <ul className={styles.queueList}>
                {station.queue.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <code>{item.raw.slice(0, 48)}</code>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </section>

        <section className={styles.opsCol} aria-label="Operación y métricas">
          <ArrivalCurve
            points={arrivalPoints}
            granularity={range.granularity === 'day' ? 'day' : 'hour'}
            loading={metricsLoading}
            errorMessage={
              timeseries.error instanceof Error && !arrivalPoints.length
                ? timeseries.error.message
                : undefined
            }
          />
          <AccessPointsPanel
            rows={doorRows}
            total={doorTotal}
            loading={access.isPending}
            available={doorRows.length > 0}
          />
          <IncidentsPanel incidents={incidents} loading={alerts.isPending} />
        </section>
      </div>

      <p className={styles.privacyNote}>
        La vista previa se procesa en el dispositivo; no se guarda ningún fotograma. El historial y
        la cola offline permanecen en este navegador.
      </p>
    </div>
  );
}
