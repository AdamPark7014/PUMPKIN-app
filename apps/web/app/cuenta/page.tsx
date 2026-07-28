'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, Input } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { authHeaders, clearSession, getStoredUser, getToken } from '@/lib/auth';
import styles from './cuenta.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type TicketRow = {
  id: string;
  code: string;
  status: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  event: {
    title: string;
    slug: string;
    startsAt: string;
    venue?: { name: string; city: string } | null;
  };
  organizationId?: string;
  items?: { tickets?: TicketRow[]; quantity?: number }[];
};

type TransferRow = {
  id: string;
  transferCode: string;
  toEmail: string;
  status: string;
  ticket: { code: string; event: { title: string } };
};

function seatLabel(t: TicketRow) {
  const parts = [
    t.section,
    t.row ? `Fila ${t.row}` : null,
    t.seatNumber ? `Asiento ${t.seatNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

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
  const [showTools, setShowTools] = useState(false);

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
    if (code) {
      setTransferCode(code);
      setShowTools(true);
    }
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

  const upcoming = useMemo(() => {
    const now = Date.now();
    return completedOrders
      .filter((o) => new Date(o.event.startsAt).getTime() >= now - 6 * 60 * 60 * 1000)
      .sort(
        (a, b) =>
          new Date(a.event.startsAt).getTime() - new Date(b.event.startsAt).getTime(),
      );
  }, [completedOrders]);

  const past = useMemo(() => {
    const upcomingIds = new Set(upcoming.map((o) => o.publicId));
    return orders.filter((o) => !upcomingIds.has(o.publicId));
  }, [orders, upcoming]);

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
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
      {toast && (
        <div className={toast.type === 'ok' ? styles.toastOk : styles.toastErr} role="status">
          {toast.text}
        </div>
      )}
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Cuenta BOLETERA</p>
        <h1>Mis boletos</h1>
        {user && (
          <p className={styles.user}>
            {user.firstName} {user.lastName} · {user.email}
          </p>
        )}
        <div className={styles.heroActions}>
          <Link href="/events" className={styles.browse}>
            Explorar eventos
          </Link>
          <Button type="button" variant="ghost" size="md" onClick={logout} className={styles.logout}>
            Cerrar sesión
          </Button>
        </div>
      </header>

      <section className={styles.wallet} aria-label="Próximos eventos">
        <div className={styles.walletHead}>
          <h2>Próximos</h2>
          <p className={styles.hint}>Abre el detalle para ver QR, PDF y opciones de transferencia.</p>
        </div>
        {loading && <p className={styles.loading}>Cargando tu wallet…</p>}
        {!loading && upcoming.length === 0 && (
          <EmptyState
            title="Sin boletos próximos"
            description="Cuando compres, tus entradas aparecerán aquí listas para el evento."
            action={
              <Link href="/" className={styles.browse}>
                Ver cartelera
              </Link>
            }
          />
        )}
        <ul className={styles.walletList}>
          {upcoming.map((o) => {
            const when = new Date(o.event.startsAt);
            const tickets =
              o.items?.flatMap((i) => i.tickets ?? []) ?? [];
            const count = tickets.length || o.items?.reduce((s, i) => s + (i.quantity ?? 0), 0) || 0;
            return (
              <li key={o.publicId} className={styles.walletCard}>
                <div className={styles.walletDateBlock} aria-hidden>
                  <strong>
                    {when.toLocaleDateString('es-MX', { day: '2-digit' })}
                  </strong>
                  <span>
                    {when.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')}
                  </span>
                </div>
                <div className={styles.walletBody}>
                  <p className={styles.walletDate}>
                    {when.toLocaleDateString('es-MX', {
                      weekday: 'short',
                    })}{' '}
                    ·{' '}
                    {when.toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <strong className={styles.walletTitle}>{o.event.title}</strong>
                  <p className={styles.walletMeta}>
                    {o.event.venue?.name}
                    {o.event.venue?.city ? ` · ${o.event.venue.city}` : ''}
                    {count ? ` · ${count} boleto${count === 1 ? '' : 's'}` : ''}
                  </p>
                  {tickets.slice(0, 2).map((t) => (
                    <p key={t.id} className={styles.walletSeat}>
                      {seatLabel(t) || t.code}
                    </p>
                  ))}
                </div>
                <div className={styles.walletActions}>
                  <Link href={`/orders/${o.publicId}`} className={styles.qrCta}>
                    Ver QR
                  </Link>
                  <a href={`${API}/orders/${o.publicId}/tickets.pdf`}>Descargar PDF</a>
                  <Link href={`/events/${o.event.slug}`}>Ver evento</Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        className={styles.toolsToggle}
        onClick={() => setShowTools((v) => !v)}
        aria-expanded={showTools}
      >
        {showTools ? 'Ocultar herramientas' : 'Transferencias y factura'}
      </button>

      {showTools && (
        <>
          {transferCode && (
            <section className={styles.section}>
              <h2>Aceptar boleto</h2>
              <form onSubmit={acceptTransfer} className={styles.formRow}>
                <Input
                  label="Código de transferencia"
                  value={transferCode}
                  onChange={(e) => setTransferCode(e.target.value)}
                  required
                />
                <Button type="submit" size="md">
                  Aceptar transferencia
                </Button>
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
              <Input
                label="Email del destinatario"
                type="email"
                value={transferForm.toEmail}
                onChange={(e) => setTransferForm({ ...transferForm, toEmail: e.target.value })}
                required
              />
              <Input
                label="Mensaje (opcional)"
                value={transferForm.message}
                onChange={(e) => setTransferForm({ ...transferForm, message: e.target.value })}
              />
              <Button type="submit" size="md">
                Enviar transferencia
              </Button>
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
              <Input
                label="RFC receptor"
                value={cfdiForm.rfc}
                onChange={(e) => setCfdiForm({ ...cfdiForm, rfc: e.target.value })}
                required
                minLength={12}
                maxLength={13}
              />
              <Input
                label="Razón social / nombre"
                value={cfdiForm.nombre}
                onChange={(e) => setCfdiForm({ ...cfdiForm, nombre: e.target.value })}
                required
              />
              <Button type="submit" size="md" disabled={cfdiBusy}>
                {cfdiBusy ? 'Timbrando…' : 'Solicitar CFDI'}
              </Button>
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
        </>
      )}

      {past.length > 0 && (
        <section className={styles.section}>
          <h2>Historial</h2>
          <ul className={styles.list}>
            {past.map((o) => (
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
        </section>
      )}
      </main>
      <SiteFooter />
    </div>
  );
}
