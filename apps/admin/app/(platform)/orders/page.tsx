'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminApi, getStoredToken } from '@/lib/api';
import platform from '../_styles/platform.module.scss';
import styles from './orders.module.scss';

type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  channel: string;
  totalAmount: string;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
  event: { title: string };
  payment: { gateway: string; status: string } | null;
};

const statusMeta: Record<string, { label: string; class: string }> = {
  COMPLETED: { label: 'Completada', class: 'paid' },
  PENDING: { label: 'Pendiente', class: 'pending' },
  CANCELLED: { label: 'Cancelada', class: 'canceled' },
  REFUNDED: { label: 'Reembolsada', class: 'refunded' },
  PARTIALLY_REFUNDED: { label: 'Reembolso parcial', class: 'refunded' },
  FAILED: { label: 'Fallida', class: 'canceled' },
};

const channelColor: Record<string, string> = {
  WEB: '#e11d48',
  TAQUILLA: '#10b981',
  POS: '#10b981',
  API: '#f59e0b',
  ADMIN: '#737373',
  RESALE: '#ec4899',
};

function fmtCurrency(amount: string, currency: string) {
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    maximumFractionDigits: 2,
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('ALL');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    adminApi<OrderRow[]>('/admin/orders', token)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (channel !== 'ALL' && o.channel !== channel) return false;
      if (q) {
        const needle = q.toLowerCase();
        return (
          o.publicId.toLowerCase().includes(needle) ||
          o.buyerName?.toLowerCase().includes(needle) ||
          o.buyerEmail?.toLowerCase().includes(needle) ||
          o.event.title.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [orders, q, channel]);

  const channels = useMemo(() => {
    const set = new Set(orders.map((o) => o.channel));
    return ['ALL', ...Array.from(set)];
  }, [orders]);

  const totalRevenue = orders
    .filter((o) => o.status === 'COMPLETED')
    .reduce((s, o) => s + Number(o.totalAmount || 0), 0);

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Órdenes</h1>
          <p>{orders.length} órdenes totales · {fmtCurrency(String(totalRevenue), 'MXN')} cobrados</p>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Buscar por orden, comprador o evento…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className={styles.filters}>
          {channels.map((c) => (
            <button
              key={c}
              type="button"
              className={channel === c ? styles.filterActive : styles.filter}
              onClick={() => setChannel(c)}
            >
              {c === 'ALL' ? 'Todos' : c}
            </button>
          ))}
        </div>
      </div>

      <section className={platform.panel}>
        {loading ? (
          <p style={{ color: '#737373' }}>Cargando órdenes…</p>
        ) : (
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Evento</th>
                <th>Comprador</th>
                <th>Canal</th>
                <th>Pago</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const meta = statusMeta[o.status] ?? { label: o.status, class: 'hold' };
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`}>
                        <code className={styles.code}>{o.publicId}</code>
                      </Link>
                      <br />
                      <small style={{ color: '#737373' }}>
                        {new Date(o.createdAt).toLocaleString('es-MX', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </td>
                    <td>{o.event.title}</td>
                    <td>
                      <strong>{o.buyerName || '—'}</strong>
                      <br />
                      <small style={{ color: '#737373' }}>{o.buyerEmail}</small>
                    </td>
                    <td>
                      <span
                        className={styles.chDot}
                        style={{ background: channelColor[o.channel] ?? '#737373' }}
                      />
                      {o.channel}
                    </td>
                    <td>
                      {o.payment ? (
                        <span className={styles.gateway}>
                          {o.payment.gateway}
                          <small>{o.payment.status}</small>
                        </span>
                      ) : (
                        <span style={{ color: '#a3a3a3' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {fmtCurrency(o.totalAmount, o.currency)}
                    </td>
                    <td>
                      <span className={`${styles.status} ${styles[meta.class]}`}>{meta.label}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className={styles.empty}>
                      <p>
                        {orders.length === 0
                          ? 'Sin órdenes registradas todavía.'
                          : 'No hay resultados con los filtros actuales.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
