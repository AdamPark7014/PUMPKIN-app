'use client';

import { useEffect, useState } from 'react';
import { adminApi, fetchMe, getStoredToken } from '@/lib/api';
import styles from '../table.module.scss';

type PromoterDashboard = {
  metrics?: {
    totalRevenue?: number;
    totalOrders?: number;
    totalTicketsSold?: number;
    netRevenue?: number;
    currency?: string;
  };
  topEvents?: { eventId: string; eventTitle: string; revenue: number; orders: number }[];
};

export default function AnalyticsPage() {
  const [data, setData] = useState<PromoterDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    (async () => {
      try {
        const orgId =
          localStorage.getItem('boletera_org') ?? (await fetchMe(token)).organizationId;
        if (!orgId) {
          setError('Usuario sin organización asignada');
          return;
        }
        const dash = await adminApi<PromoterDashboard>(
          `/analytics/promoters/${orgId}/dashboard?period=MONTH`,
          token,
        );
        setData(dash);
      } catch {
        setError('No se pudieron cargar las métricas');
      }
    })();
  }, []);

  return (
    <div>
      <h1>Analytics</h1>
      {error && <p className={styles.muted}>{error}</p>}
      <div className={styles.kpis}>
        <article>
          <span>Ingresos (mes)</span>
          <strong>
            ${data?.metrics?.totalRevenue?.toLocaleString('es-MX') ?? '—'}{' '}
            {data?.metrics?.currency ?? ''}
          </strong>
        </article>
        <article>
          <span>Órdenes</span>
          <strong>{data?.metrics?.totalOrders ?? '—'}</strong>
        </article>
        <article>
          <span>Boletos vendidos</span>
          <strong>{data?.metrics?.totalTicketsSold ?? '—'}</strong>
        </article>
        <article>
          <span>Neto promotor</span>
          <strong>${data?.metrics?.netRevenue?.toLocaleString('es-MX') ?? '—'}</strong>
        </article>
      </div>
      {data?.topEvents && data.topEvents.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Órdenes</th>
              <th>Ingresos</th>
            </tr>
          </thead>
          <tbody>
            {data.topEvents.map((e) => (
              <tr key={e.eventId}>
                <td>{e.eventTitle}</td>
                <td>{e.orders}</td>
                <td>${e.revenue.toLocaleString('es-MX')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
