'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminApi, fetchMe, getStoredToken } from '@/lib/api';
import platform from '../_styles/platform.module.scss';
import styles from './analytics.module.scss';

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

function fmtMoney(n?: number) {
  if (typeof n !== 'number') return '—';
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<PromoterDashboard | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<'WEEK' | 'MONTH' | 'YEAR'>('MONTH');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    (async () => {
      try {
        setError('');
        const orgId =
          localStorage.getItem('boletera_org') ?? (await fetchMe(token)).organizationId;
        if (!orgId) {
          setError('Usuario sin organización asignada');
          return;
        }
        const dash = await adminApi<PromoterDashboard>(
          `/analytics/promoters/${orgId}/dashboard?period=${period}`,
          token,
        );
        setData(dash);
      } catch {
        setError('No se pudieron cargar las métricas');
      }
    })();
  }, [period]);

  const maxRevenue = useMemo(() => {
    const list = data?.topEvents ?? [];
    return Math.max(1, ...list.map((e) => e.revenue));
  }, [data]);

  const periodLabel =
    period === 'WEEK' ? 'esta semana' : period === 'YEAR' ? 'este año' : 'este mes';

  return (
    <div className={styles.wrap}>
      <header className={platform.pageHeader}>
        <div>
          <h1>Analítica</h1>
          <p>Rendimiento de ventas {periodLabel}</p>
        </div>
        <div className={styles.periodTabs} role="tablist" aria-label="Periodo">
          {(
            [
              ['WEEK', 'Semana'],
              ['MONTH', 'Mes'],
              ['YEAR', 'Año'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={period === id}
              className={period === id ? styles.tabOn : styles.tab}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.kpis}>
        <article className={styles.kpiHero}>
          <span>Ingresos</span>
          <strong>
            {fmtMoney(data?.metrics?.totalRevenue)}{' '}
            <em>{data?.metrics?.currency || 'MXN'}</em>
          </strong>
        </article>
        <article>
          <span>Órdenes</span>
          <strong>{data?.metrics?.totalOrders ?? '—'}</strong>
        </article>
        <article>
          <span>Boletos</span>
          <strong>{data?.metrics?.totalTicketsSold ?? '—'}</strong>
        </article>
        <article>
          <span>Neto promotor</span>
          <strong>{fmtMoney(data?.metrics?.netRevenue)}</strong>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Top eventos</h2>
          <Link href="/events" className={platform.ghostBtn}>
            Ver eventos
          </Link>
        </div>

        {!data?.topEvents?.length ? (
          <p className={styles.muted}>Aún no hay datos de eventos en este periodo.</p>
        ) : (
          <ul className={styles.bars}>
            {data.topEvents.map((e, i) => {
              const pct = Math.round((e.revenue / maxRevenue) * 100);
              return (
                <li key={e.eventId}>
                  <div className={styles.barMeta}>
                    <strong>
                      <span className={styles.rank}>{i + 1}</span>
                      {e.eventTitle}
                    </strong>
                    <span>
                      {e.orders} órdenes · {fmtMoney(e.revenue)}
                    </span>
                  </div>
                  <div className={styles.barTrack} aria-hidden>
                    <div className={styles.barFill} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
