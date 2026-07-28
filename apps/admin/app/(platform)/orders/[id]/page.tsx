'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminApi, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
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
  refunds: {
    id: string;
    amount: string;
    status: string;
    notes: string | null;
    requestedAt: string;
  }[];
  items: { tickets: { code: string; status: string }[] }[];
};

export default function OrderDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toast = useToast();

  function load() {
    const token = getStoredToken();
    if (!token) return;
    adminApi<OrderDetail>(`/admin/orders/${id}`, token)
      .then(setOrder)
      .catch(() => setLoadError('No se pudo cargar la orden'));
  }

  useEffect(() => {
    load();
  }, [id]);

  async function refund() {
    const token = getStoredToken();
    if (!token || !order) return;
    if (!confirm(`¿Solicitar reembolso Banorte de ${order.publicId} por $${order.totalAmount}?`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await adminApi<{
        refund: { status: string };
        message?: string;
        nextStep?: string | null;
      }>(`/admin/orders/${order.id}/refund`, token, {
        method: 'POST',
        body: JSON.stringify({ reason: 'CUSTOMER_REQUEST' }),
      });
      if (res.refund?.status === 'PENDING') {
        toast.success(
          'Reembolso pendiente: completa el proceso en el portal Banorte y márcalo aquí como completado.',
        );
      } else {
        toast.success(res.message || `Reembolso: ${res.refund?.status}`);
      }
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al reembolsar');
    } finally {
      setBusy(false);
    }
  }

  async function completeRefund(refundId: string) {
    const token = getStoredToken();
    if (!token || !order) return;
    const ref = window.prompt(
      'Referencia Banorte del reembolso (opcional). Deja vacío si no aplica.',
      '',
    );
    if (ref === null) return;
    setCompletingId(refundId);
    try {
      await adminApi(`/payments/refunds/${refundId}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({
          banorteReference: ref.trim() || undefined,
        }),
      });
      toast.success('Reembolso marcado como completado · inventario liberado');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo completar el reembolso');
    } finally {
      setCompletingId(null);
    }
  }

  async function resend() {
    const token = getStoredToken();
    if (!token || !order) return;
    setBusy(true);
    try {
      await adminApi(`/admin/orders/${order.id}/resend-email`, token, {
        method: 'POST',
        body: '{}',
      });
      toast.success(`Email reenviado a ${order.buyerEmail}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al reenviar');
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
      toast.success('Orden cancelada');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cancelar');
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <div>
        <p>{loadError || 'Cargando…'}</p>
        <Link href="/orders">← Órdenes</Link>
      </div>
    );
  }

  const tickets = order.items.flatMap((i) => i.tickets);
  const pendingRefunds = order.refunds.filter((r) => r.status === 'PENDING');

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

        {pendingRefunds.length > 0 && (
          <p className={styles.detailMsg} role="status">
            Hay {pendingRefunds.length} reembolso(s) pendiente(s): procesa en el portal Banorte y
            márcalo(s) como completado abajo.
          </p>
        )}

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
        {!order.refunds.length && <p className={styles.refundEmpty}>Sin reembolsos.</p>}
        <ul className={styles.refundList}>
          {order.refunds.map((r) => (
            <li key={r.id} className={styles.refundRow}>
              <div>
                <p>
                  ${r.amount} · <strong>{r.status}</strong>
                  {r.notes ? ` — ${r.notes}` : ''}
                </p>
                <small>{new Date(r.requestedAt).toLocaleString('es-MX')}</small>
              </div>
              {r.status === 'PENDING' && (
                <button
                  type="button"
                  className={platform.primaryBtn}
                  disabled={busy || completingId === r.id}
                  onClick={() => void completeRefund(r.id)}
                >
                  {completingId === r.id ? 'Marcando…' : 'Marcar completado en Banorte'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
