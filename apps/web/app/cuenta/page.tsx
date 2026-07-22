'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { authHeaders, clearSession, getStoredUser, getToken } from '@/lib/auth';
import styles from './cuenta.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type TicketRow = { id: string; code: string; status: string };

type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  event: { title: string; slug: string };
  organizationId?: string;
  items?: { tickets?: TicketRow[] }[];
};

type TransferRow = {
  id: string;
  transferCode: string;
  toEmail: string;
  status: string;
  ticket: { code: string; event: { title: string } };
};

export default function CuentaPage() {
  const router = useRouter();
  const user = getStoredUser();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [transferCode, setTransferCode] = useState('');
  const [transferForm, setTransferForm] = useState({ ticketId: '', toEmail: '', message: '' });
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [cfdiOrderId, setCfdiOrderId] = useState('');
  const [cfdiForm, setCfdiForm] = useState({ rfc: '', nombre: '' });
  const [cfdiBusy, setCfdiBusy] = useState(false);

  function showToast(type: 'ok' | 'err', text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }

  function reload() {
    const headers = authHeaders();
    Promise.all([
      fetch(`${API}/orders/mine`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/tickets/transfer/mine`, { headers }).then((r) =>
        r.ok ? r.json() : { sent: [], received: [] },
      ),
    ])
      .then(([o, t]) => {
        setOrders(o);
        const merged = [...(t.sent ?? []), ...(t.received ?? [])] as TransferRow[];
        setTransfers(merged);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    const p = new URLSearchParams(window.location.search);
    const code = p.get('transfer');
    if (code) setTransferCode(code);
    reload();
  }, [router]);

  const myTickets = orders.flatMap(
    (o) =>
      o.items?.flatMap((i) =>
        (i.tickets ?? []).map((t) => ({
          ...t,
          eventTitle: o.event.title,
        })),
      ) ?? [],
  );

  const completedOrders = orders.filter((o) => o.status === 'COMPLETED');

  async function acceptTransfer(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`${API}/tickets/transfer/accept`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ transferCode }),
    });
    if (!res.ok) {
      showToast('err', 'No se pudo aceptar la transferencia');
      return;
    }
    setTransferCode('');
    showToast('ok', 'Transferencia aceptada');
    reload();
  }

  async function sendTransfer(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`${API}/tickets/transfer`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(transferForm),
    });
    if (!res.ok) {
      showToast('err', 'No se pudo iniciar la transferencia');
      return;
    }
    setTransferForm({ ticketId: '', toEmail: '', message: '' });
    showToast('ok', 'Transferencia enviada — el destinatario recibirá un código');
    reload();
  }

  async function requestCfdi(e: FormEvent) {
    e.preventDefault();
    if (!cfdiOrderId) return;
    setCfdiBusy(true);
    try {
      const order = orders.find((o) => o.publicId === cfdiOrderId);
      const res = await fetch(`${API}/orders/${cfdiOrderId}/cfdi`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          receptorRfc: cfdiForm.rfc,
          receptorNombre: cfdiForm.nombre,
          orderId: order?.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('err', data.message || 'No se pudo solicitar CFDI (sandbox)');
        return;
      }
      showToast('ok', data.sandbox ? `CFDI sandbox: ${data.uuid}` : `CFDI: ${data.uuid}`);
      setCfdiForm({ rfc: '', nombre: '' });
    } finally {
      setCfdiBusy(false);
    }
  }

  function logout() {
    clearSession();
    router.push('/');
  }

  return (
    <main className={styles.page}>
      <SiteHeader />
      {toast && (
        <div className={toast.type === 'ok' ? styles.toastOk : styles.toastErr} role="status">
          {toast.text}
        </div>
      )}
      <h1>Mi cuenta</h1>
      {user && (
        <p className={styles.user}>
          {user.firstName} {user.lastName} · {user.email}
        </p>
      )}
      <button type="button" onClick={logout} className={styles.logout}>
        Cerrar sesión
      </button>

      {transferCode && (
        <section className={styles.section}>
          <h2>Aceptar boleto</h2>
          <form onSubmit={acceptTransfer} className={styles.formRow}>
            <input value={transferCode} onChange={(e) => setTransferCode(e.target.value)} required />
            <button type="submit">Aceptar transferencia</button>
          </form>
        </section>
      )}

      <section className={styles.section}>
        <h2>Transferir boleto</h2>
        <form onSubmit={sendTransfer} className={styles.formStack}>
          <select
            value={transferForm.ticketId}
            onChange={(e) => setTransferForm({ ...transferForm, ticketId: e.target.value })}
            required
          >
            <option value="">Selecciona boleto</option>
            {myTickets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.eventTitle}
              </option>
            ))}
          </select>
          <input
            type="email"
            placeholder="Email del destinatario"
            value={transferForm.toEmail}
            onChange={(e) => setTransferForm({ ...transferForm, toEmail: e.target.value })}
            required
          />
          <input
            placeholder="Mensaje opcional"
            value={transferForm.message}
            onChange={(e) => setTransferForm({ ...transferForm, message: e.target.value })}
          />
          <button type="submit">Enviar transferencia</button>
        </form>
      </section>

      <section className={styles.section}>
        <h2>Factura CFDI (sandbox)</h2>
        <p className={styles.hint}>Solicita timbrado de prueba para una orden completada.</p>
        <form onSubmit={requestCfdi} className={styles.formStack}>
          <select
            value={cfdiOrderId}
            onChange={(e) => setCfdiOrderId(e.target.value)}
            required
          >
            <option value="">Orden completada</option>
            {completedOrders.map((o) => (
              <option key={o.publicId} value={o.publicId}>
                {o.event.title} · {o.publicId}
              </option>
            ))}
          </select>
          <input
            placeholder="RFC receptor"
            value={cfdiForm.rfc}
            onChange={(e) => setCfdiForm({ ...cfdiForm, rfc: e.target.value })}
            required
            minLength={12}
            maxLength={13}
          />
          <input
            placeholder="Razón social / nombre"
            value={cfdiForm.nombre}
            onChange={(e) => setCfdiForm({ ...cfdiForm, nombre: e.target.value })}
            required
          />
          <button type="submit" disabled={cfdiBusy}>
            {cfdiBusy ? 'Timbrando…' : 'Solicitar CFDI'}
          </button>
        </form>
      </section>

      {transfers.length > 0 && (
        <section className={styles.section}>
          <h2>Mis transferencias</h2>
          <ul className={styles.list}>
            {transfers.map((t) => (
              <li key={t.id}>
                <strong>{t.ticket.event.title}</strong> → {t.toEmail}
                <br />
                <small>
                  {t.transferCode} · {t.status}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>Mis órdenes</h2>
      {loading && <p>Cargando…</p>}
      {!loading && !orders.length && <p>Aún no tienes compras.</p>}
      <ul className={styles.list}>
        {orders.map((o) => (
          <li key={o.publicId}>
            <div>
              <strong>{o.event.title}</strong>
              <span className={styles.status}>{o.status}</span>
            </div>
            <p>${o.totalAmount}</p>
            <div className={styles.orderLinks}>
              <Link href={`/orders/${o.publicId}`}>Ver detalle</Link>
              {o.status === 'COMPLETED' && (
                <a href={`${API}/orders/${o.publicId}/tickets.pdf`}>PDF boletos</a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
