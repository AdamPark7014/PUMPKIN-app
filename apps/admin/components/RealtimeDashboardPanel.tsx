'use client';

import { useEffect, useState } from 'react';
import { fetchMe } from '@/lib/api';
import {
  getRealtimeDashboard,
  realtimeDashboardStreamUrl,
  type RealtimeDashboard,
} from '@/lib/platform-api';
import platform from '../app/(platform)/_styles/platform.module.scss';

export function RealtimeDashboardPanel({ eventId }: { eventId?: string }) {
  const [data, setData] = useState<RealtimeDashboard | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const apply = (payload: RealtimeDashboard) => {
      if (!cancelled) setData(payload);
    };

    const startPolling = (org: string) => {
      const load = () => {
        getRealtimeDashboard(token, org, eventId).then(apply).catch(() => {});
      };
      load();
      pollId = setInterval(load, 10_000);
    };

    const connect = async () => {
      let org = localStorage.getItem('boletera_org');
      if (!org) {
        try {
          const me = await fetchMe(token);
          if (me.organizationId) {
            localStorage.setItem('boletera_org', me.organizationId);
            org = me.organizationId;
          }
        } catch {
          return;
        }
      }
      if (!org || cancelled) return;

      const url = realtimeDashboardStreamUrl(org, eventId);
      if (typeof EventSource !== 'undefined') {
        es = new EventSource(url);
        es.onmessage = (ev) => {
          try {
            apply(JSON.parse(ev.data) as RealtimeDashboard);
          } catch {
            /* ignore malformed */
          }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (!cancelled && !pollId) startPolling(org!);
        };
      } else {
        startPolling(org);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      es?.close();
      if (pollId) clearInterval(pollId);
    };
  }, [eventId]);

  if (!data) return <p style={{ color: '#737373' }}>Cargando métricas en vivo…</p>;

  return (
    <div>
      <div className={platform.cardGrid}>
        <article className={platform.statCard}>
          <span>Hoy</span>
          <strong>${data.metrics.todayRevenue.toLocaleString()}</strong>
          <small>{data.metrics.todayOrders} órdenes</small>
        </article>
        <article className={platform.statCard}>
          <span>Semana</span>
          <strong>${data.metrics.weekRevenue.toLocaleString()}</strong>
          <small>{data.metrics.weekOrders} órdenes</small>
        </article>
        <article className={platform.statCard}>
          <span>Ticket promedio</span>
          <strong>${data.metrics.avgOrderValue.toFixed(0)}</strong>
        </article>
        <article className={platform.statCard}>
          <span>Ocupación</span>
          <strong>{data.metrics.occupancy}%</strong>
          <small>
            {data.metrics.soldTickets}/{data.metrics.totalTickets} boletos
          </small>
        </article>
      </div>

      {data.channels.length > 0 && (
        <table className={platform.table} style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Canal (7d)</th>
              <th>Órdenes</th>
              <th>Ingresos</th>
            </tr>
          </thead>
          <tbody>
            {data.channels.map((c) => (
              <tr key={c.channel}>
                <td>{c.channel}</td>
                <td>{c.orders}</td>
                <td>${Number(c.revenue).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
