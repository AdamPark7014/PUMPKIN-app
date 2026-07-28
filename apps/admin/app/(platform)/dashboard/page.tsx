'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPlatformOverview, type PlatformOverview } from '@/lib/platform-api';
import { RealtimeDashboardPanel } from '@/components/RealtimeDashboardPanel';
import styles from './dashboard.module.scss';

const channelMeta: Record<string, { color: string; label: string }> = {
  WEB: { color: '#52525b', label: 'Web' },
  TAQUILLA: { color: '#18181b', label: 'Taquilla POS' },
  API: { color: '#71717a', label: 'API' },
  ADMIN: { color: '#a1a1aa', label: 'Admin' },
  RESALE: { color: '#3f3f46', label: 'Reventa' },
};

function fmtCurrency(n: number | undefined) {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function StatIcon({ kind }: { kind: 'pulse' | 'cart' | 'cash' | 'terminal' }) {
  const path: Record<string, string> = {
    pulse: 'M2 12h4l2-6 4 12 3-8 2 4 2-2h3',
    cart: 'M6 4h12l2 6-7 10-7-10z M3 10h18 M9 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z M15 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
    cash: 'M2 7h20v10H2z M6 12h2 M14 12h4',
    terminal: 'M3 4h18v14H3z M7 9l2 2-2 2 M11 13h4 M9 21h6',
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={path[kind]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const quickActions = [
  {
    href: '/events/new',
    title: 'Crear evento',
    desc: 'Nuevo show, mapa y ofertas',
    icon: 'M12 5v14M5 12h14',
    accent: 'ink',
  },
  {
    href: '/channels',
    title: 'Canales de venta',
    desc: 'Web, POS, API y reventa',
    icon: 'M4 12h4l3-7 4 14 3-7h2',
    accent: 'ink',
  },
  {
    href: '/scanner',
    title: 'Escáner',
    desc: 'Validación de acceso',
    icon: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M3 12h18',
    accent: 'ink',
  },
  {
    href: '/payouts',
    title: 'Liquidaciones',
    desc: 'Pagos a organizadores',
    icon: 'M3 7h18v10H3z M7 12h2 M15 12h2',
    accent: 'ink',
  },
];

export default function DashboardPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    getPlatformOverview(token).then(setData).catch(() => {});
  }, []);

  const totalChannelRevenue =
    data?.channelBreakdown?.reduce((s, c) => s + c.revenue, 0) ?? 0;

  return (
    <div className={styles.wrap}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Hoy</p>
          <h1>Resumen de operación</h1>
          <p className={styles.lead}>
            Eventos, órdenes, pagos Banorte y taquilla.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/events/new" className={styles.primaryBtn}>
            + Crear evento
          </Link>
          <Link href="/reports" className={styles.ghostBtn}>
            Exportar reportes
          </Link>
        </div>
      </header>

      <section className={styles.kpis}>
        <article className={`${styles.kpi} ${styles.kpiHero}`}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: '#f4f4f5', color: '#18181b' }}>
              <StatIcon kind="cash" />
            </span>
            <span className={styles.kpiLabel}>Ingresos hoy</span>
          </div>
          <strong className={styles.kpiVal}>{fmtCurrency(data?.revenueToday)}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>Actualizado al momento</span>
          </div>
        </article>

        <article className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: '#17171715', color: '#171717' }}>
              <StatIcon kind="cart" />
            </span>
            <span className={styles.kpiLabel}>Órdenes hoy</span>
          </div>
          <strong className={styles.kpiVal}>{data?.ordersToday ?? '—'}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>Completadas hoy</span>
          </div>
        </article>

        <article className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: '#f4f4f5', color: '#52525b' }}>
              <StatIcon kind="terminal" />
            </span>
            <span className={styles.kpiLabel}>Terminales POS</span>
          </div>
          <strong className={styles.kpiVal}>{data?.taquillaTerminals ?? '—'}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>Registradas en la org</span>
          </div>
        </article>

        <article className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon} style={{ background: '#f4f4f5', color: '#3f3f46' }}>
              <StatIcon kind="pulse" />
            </span>
            <span className={styles.kpiLabel}>Holds activos</span>
          </div>
          <strong className={styles.kpiVal}>{data?.activeHolds ?? '—'}</strong>
          <div className={styles.kpiTrend}>
            <span className={styles.kpiSub}>
              {data?.activeEvents ?? 0} eventos · {data?.totalVenues ?? 0} venues
            </span>
          </div>
        </article>
      </section>

      {/* Real-time */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Métricas en vivo</h2>
            <p>Actualización cada 10 segundos vía SSE</p>
          </div>
          <span className={styles.sseBadge}>
            <span className={styles.liveDot} />
            stream activo
          </span>
        </div>
        <RealtimeDashboardPanel />
      </section>

      {/* Channels */}
      <div className={styles.twoCol}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Canales de venta hoy</h2>
              <p>Distribución por origen de orden</p>
            </div>
          </div>

          {data?.channelBreakdown?.length ? (
            <>
              <div className={styles.channelBar}>
                {data.channelBreakdown.map((c) => {
                  const pct = totalChannelRevenue
                    ? Math.round((c.revenue / totalChannelRevenue) * 100)
                    : 0;
                  const meta = channelMeta[c.channel] ?? channelMeta.WEB;
                  return (
                    <span
                      key={c.channel}
                      style={{ width: `${pct}%`, background: meta.color }}
                      title={`${meta.label} ${pct}%`}
                    />
                  );
                })}
              </div>
              <ul className={styles.channelList}>
                {data.channelBreakdown.map((c) => {
                  const pct = totalChannelRevenue
                    ? Math.round((c.revenue / totalChannelRevenue) * 100)
                    : 0;
                  const meta = channelMeta[c.channel] ?? channelMeta.WEB;
                  return (
                    <li key={c.channel}>
                      <span className={styles.channelDot} style={{ background: meta.color }} />
                      <span className={styles.channelName}>{meta.label}</span>
                      <span className={styles.channelOrders}>{c.orders} órdenes</span>
                      <strong className={styles.channelRev}>{fmtCurrency(c.revenue)}</strong>
                      <span className={styles.channelPct}>{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className={styles.empty}>
              <p>Sin ventas hoy todavía.</p>
              <Link href="/events" className={styles.ghostBtn}>
                Ver catálogo
              </Link>
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2>Atajos</h2>
              <p>Las acciones más frecuentes</p>
            </div>
          </div>
          <div className={styles.actionsGrid}>
            {quickActions.map((q) => (
              <Link key={q.href} href={q.href} className={`${styles.actionCard} ${styles[q.accent]}`}>
                <div className={styles.actionIcon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d={q.icon} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <strong>{q.title}</strong>
                  <span>{q.desc}</span>
                </div>
                <span className={styles.actionArrow}>→</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Actividad reciente</h2>
            <p>Últimos eventos del sistema</p>
          </div>
          <Link href="/orders" className={styles.linkAll}>
            Ver órdenes →
          </Link>
        </div>
        <div className={styles.activity}>
          {data?.recentOrders?.length ? (
            data.recentOrders.slice(0, 5).map((o) => (
              <div key={o.publicId} className={styles.activityRow}>
                <span
                  className={styles.actTag}
                  style={{ color: '#3f3f46', background: '#f4f4f5', borderColor: '#e4e4e7' }}
                >
                  {o.channel || 'WEB'}
                </span>
                <span className={styles.actText}>
                  Orden {o.publicId} · {o.eventTitle || 'Evento'} ·{' '}
                  {fmtCurrency(Number(o.totalAmount))}
                </span>
                <span className={styles.actTime}>{o.status}</span>
              </div>
            ))
          ) : (
            <div className={styles.activityRow}>
              <span className={styles.actText}>
                Sin actividad reciente. Las órdenes aparecerán aquí cuando haya ventas.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
