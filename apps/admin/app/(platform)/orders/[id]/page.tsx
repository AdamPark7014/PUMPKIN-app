'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminApi, getStoredToken } from '@/lib/api';
import platform from '../../_styles/platform.module.scss';
import styles from '../orders.module.scss';

type OrderDetail = {
  id: string;
  publicId: string;
  status: string;
  channel: string;
  totalAmount: string;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
  event: { title: string; slug: string };
  payment: { gateway: string; status: string; externalId: string } | null;
  refunds: { id: string; amount: string; status: string; notes: string | null; requestedAt: string }[];
  items: { tickets: { code: string; status: string }[] }[];
};

export default function OrderDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    const token = getStoredToken();
    if (!token) return;
    adminApi<OrderDetail>(`/admin/orders/${id}`, token)
      .then(setOrder)
      .catch(() => setMsg('No se pudo cargar la orden'));
  }

  useEffect(() => {
    load();
  }, [id]);

  async function refund() {
    const token = getStoredToken();
    if (!token || !order) return;
    if (!confirm(`¿Reembolsar ${order.publicId} por $${order.totalAmount}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminApi<{ refund: { status: string }; message?: string }>(
        `/admin/orders/${order.id}/refund`,
        token,
        { method: 'POST', body: JSON.stringify({ reason: 'CUSTOMER_REQUEST' }) },
      );
      setMsg(res.message || `Reembolso: ${res.refund?.status}`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al reembolsar');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    const token = getStoredToken();
    if (!token || !order) return;
    setBusy(true);
    try {
      await adminApi(`/admin/orders/${order.id}/resend-email`, token, { method: 'POST', body: '{}' });
      setMsg(`Email reenviado a ${order.buyerEmail}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al reenviar');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const token = getStoredToken();
    if (!token || !order) return;
    if (!confirm('¿Cancelar esta orden pendiente?')) return;
    setBusy(true);
    try {
      await adminApi(`/admin/orders/${order.id}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled from admin' }),
      });
      setMsg('Orden cancelada');
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al cancelar');
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <div>
        <p>{msg || 'Cargando…'}</p>
        <Link href="/orders">← Órdenes</Link>
      </div>
    );
  }

  const tickets = order.items.flatMap((i) => i.tickets);

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Orden {order.publicId}</h1>
          <p>
            {order.event.title} · {order.status} · {order.channel}
          </p>
        </div>
        <Link href="/orders" className={platform.ghostBtn}>
          ← Volver
        </Link>
      </header>

      {msg && <p className={styles.detailMsg}>{msg}</p>}

      <section className={platform.panel}>
        <div className={styles.detailGrid}>
          <div>
            <h2>Comprador</h2>
            <p>
              <strong>{order.buyerName}</strong>
              <br />
              {order.buyerEmail}
            </p>
          </div>
          <div>
            <h2>Pago</h2>
            <p>
              ${order.totalAmount} {order.currency}
              <br />
              {order.payment
                ? `${order.payment.gateway} · ${order.payment.status}`
                : 'Sin pago'}
            </p>
          </div>
          <div>
            <h2>Fecha</h2>
            <p>{new Date(order.createdAt).toLocaleString('es-MX')}</p>
          </div>
        </div>

        <div className={styles.actions}>
          {(order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED') && (
            <button type="button" className={platform.primaryBtn} disabled={busy} onClick={refund}>
              Solicitar reembolso Banorte
            </button>
          )}
          <button type="button" className={platform.ghostBtn} disabled={busy} onClick={resend}>
            Reenviar email
          </button>
          {order.status === 'PENDING' && (
            <button type="button" className={platform.ghostBtn} disabled={busy} onClick={cancel}>
              Cancelar
            </button>
          )}
        </div>
      </section>

      <section className={platform.panel}>
        <h2>Boletos</h2>
        <ul>
          {tickets.map((t) => (
            <li key={t.code}>
              <code>{t.code}</code> · {t.status}
            </li>
          ))}
        </ul>
      </section>

      <section className={platform.panel}>
        <h2>Reembolsos</h2>
        {!order.refunds.length && <p style={{ color: '#737373' }}>Sin reembolsos.</p>}
        <ul>
          {order.refunds.map((r) => (
            <li key={r.id}>
              ${r.amount} · <strong>{r.status}</strong>
              {r.notes ? ` — ${r.notes}` : ''}
              <br />
              <small>{new Date(r.requestedAt).toLocaleString('es-MX')}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
