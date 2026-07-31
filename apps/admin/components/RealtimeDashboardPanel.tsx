'use client';

import { useMemo } from 'react';
import { Badge, Button, EmptyState, Skeleton, StatusDot } from '@boletera/ui';
import { useRealtimeDashboard } from '@/lib/queries';
import { useRealtimeDashboardUpdates, type RealtimeStatus } from '@/lib/use-realtime';
import { useSession } from '@/lib/use-session';
import {
  channelLabel,
  errorMessage,
  formatCount,
  formatMxn,
  formatPercentPoints,
} from '../app/(platform)/dashboard/format';
import styles from '../app/(platform)/dashboard/dashboard.module.scss';

function statusPresentation(status: RealtimeStatus): {
  text: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  pulse: boolean;
} {
  switch (status) {
    case 'connected':
      return { text: 'En vivo · SSE', tone: 'success', pulse: true };
    case 'connecting':
      return { text: 'Conectando…', tone: 'warning', pulse: true };
    case 'reconnecting':
      return { text: 'Reconectando…', tone: 'warning', pulse: true };
    case 'error':
      return { text: 'Modo sondeo', tone: 'danger', pulse: false };
    default:
      return { text: 'En espera', tone: 'neutral', pulse: false };
  }
}

export function RealtimeDashboardPanel({ eventId }: { eventId?: string }) {
  const { organizationId } = useSession();
  const query = useRealtimeDashboard(organizationId, eventId);
  const stream = useRealtimeDashboardUpdates(eventId);
  const data = query.data;
  const status = statusPresentation(stream.status);

  const channels = useMemo(() => {
    const rows = data?.channels ?? [];
    return [...rows].sort((a, b) => Number(b.revenue) - Number(a.revenue));
  }, [data?.channels]);

  if (query.isPending && !data) {
    return (
      <div className={styles.rtWrap} aria-busy="true" role="status">
        <div className={styles.rtGrid}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} height={88} radius={12} delay={index * 70} />
          ))}
        </div>
        <Skeleton height={120} radius={12} delay={280} />
        <span className={styles.srOnly}>Cargando métricas en vivo…</span>
      </div>
    );
  }

  if (query.error && !data) {
    return (
      <EmptyState
        size="sm"
        tone="danger"
        illustration="error"
        title="No se pudo cargar el pulso en vivo"
        description={errorMessage(
          query.error,
          'Revisa la sesión o reintenta en unos segundos.',
        )}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className={styles.rtEmpty} role="status">
        Sin datos en tiempo real todavía.
      </div>
    );
  }

  const { metrics } = data;

  return (
    <div className={styles.rtWrap}>
      <div className={styles.rtStatusRow}>
        <StatusDot tone={status.tone} size="sm" pulse={status.pulse} label={status.text} />
        {stream.error ? (
          <Badge tone="warning" size="sm" variant="soft">
            SSE intermitente · sondeo activo
          </Badge>
        ) : null}
      </div>

      <div className={styles.rtGrid}>
        <article className={styles.rtCard}>
          <span>Hoy</span>
          <strong>{formatMxn(metrics.todayRevenue)}</strong>
          <small>{formatCount(metrics.todayOrders)} órdenes</small>
        </article>
        <article className={styles.rtCard}>
          <span>Semana</span>
          <strong>{formatMxn(metrics.weekRevenue)}</strong>
          <small>{formatCount(metrics.weekOrders)} órdenes</small>
        </article>
        <article className={styles.rtCard}>
          <span>Ticket promedio</span>
          <strong>{formatMxn(metrics.avgOrderValue)}</strong>
          <small>Valor medio por orden</small>
        </article>
        <article className={styles.rtCard}>
          <span>Ocupación</span>
          <strong>{formatPercentPoints(metrics.occupancy)}</strong>
          <small>
            {formatCount(metrics.soldTickets)} / {formatCount(metrics.totalTickets)} boletos
          </small>
        </article>
      </div>

      {channels.length > 0 ? (
        <table className={styles.rtChannels}>
          <caption className={styles.srOnly}>Ingresos por canal (7 días)</caption>
          <thead>
            <tr>
              <th scope="col">Canal (7d)</th>
              <th scope="col">Órdenes</th>
              <th scope="col">Ingresos</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.channel}>
                <td>{channelLabel(channel.channel)}</td>
                <td>{formatCount(channel.orders)}</td>
                <td>{formatMxn(Number(channel.revenue))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.rtEmpty}>Sin desglose de canales en la ventana de 7 días.</p>
      )}
    </div>
  );
}
