'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, Input } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { TrustRow, TRUST_OFFICIAL, TRUST_QR, trustTransfer } from '@/components/storefront/TrustRow';
import { API_BASE, errorMessage } from '@/lib/api';
import { authHeaders, clearSession, getStoredUser, getToken, type AuthUser } from '@/lib/auth';
import {
  calendarParts,
  dateTime,
  isoDateAttr,
  money,
  orderStatusLabel,
  plural,
  timeOfDay,
} from '@/lib/format';
import type {
  OrderListItem,
  OrderTicket,
  TicketTransfer,
  TicketTransferInbox,
} from '@/lib/storefront-types';
import styles from './cuenta.module.scss';

type TabId = 'boletos' | 'historial' | 'transferencias' | 'perfil';

type OwnedTicket = OrderTicket & {
  id: string;
  eventTitle: string;
  orderPublicId: string;
};

type Toast = { type: 'ok' | 'err'; text: string };

type CfdiResponse = {
  uuid?: string;
  sandbox?: boolean;
  message?: string;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'boletos', label: 'Boletos' },
  { id: 'historial', label: 'Historial' },
  { id: 'transferencias', label: 'Transferencias' },
  { id: 'perfil', label: 'Perfil' },
];

const TRANSFER_STATUS_LABEL: Readonly<Record<string, string>> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Expirada',
  COMPLETED: 'Completada',
};

function transferStatusLabel(status: string): string {
  return TRANSFER_STATUS_LABEL[status] ?? status;
}

function seatLabel(t: OrderTicket): string | null {
  const parts = [
    t.section,
    t.row ? `Fila ${t.row}` : null,
    t.seatNumber ? `Asiento ${t.seatNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function ticketCount(order: OrderListItem): number {
  const fromTickets =
    order.items?.reduce((sum, item) => sum + (item.tickets?.length ?? 0), 0) ?? 0;
  if (fromTickets > 0) return fromTickets;
  return order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0;
}

function orderTickets(order: OrderListItem): OrderTicket[] {
  return order.items?.flatMap((item) => item.tickets ?? []) ?? [];
}

export default function CuentaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [sentTransfers, setSentTransfers] = useState<TicketTransfer[]>([]);
  const [receivedTransfers, setReceivedTransfers] = useState<TicketTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('boletos');
  const [transferCode, setTransferCode] = useState('');
  const [transferForm, setTransferForm] = useState({ ticketId: '', toEmail: '', message: '' });
  const [sendBusy, setSendBusy] = useState(false);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [cfdiOrderId, setCfdiOrderId] = useState('');
  const [cfdiForm, setCfdiForm] = useState({ rfc: '', nombre: '' });
  const [cfdiBusy, setCfdiBusy] = useState(false);

  const showToast = useCallback((type: Toast['type'], text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const headers = authHeaders();
      const [ordersRes, transfersRes] = await Promise.all([
        fetch(`${API_BASE}/orders/mine`, { headers, cache: 'no-store' }),
        fetch(`${API_BASE}/tickets/transfer/mine`, { headers, cache: 'no-store' }),
      ]);

      if (ordersRes.status === 401 || transfersRes.status === 401) {
        clearSession();
        router.replace('/login?next=/cuenta');
        return;
      }

      if (!ordersRes.ok) {
        throw new Error('No pudimos cargar tus órdenes. Inténtalo de nuevo.');
      }

      const ordersData = (await ordersRes.json()) as OrderListItem[];
      setOrders(Array.isArray(ordersData) ? ordersData : []);

      if (transfersRes.ok) {
        const inbox = (await transfersRes.json()) as TicketTransferInbox;
        setSentTransfers(Array.isArray(inbox.sent) ? inbox.sent : []);
        setReceivedTransfers(Array.isArray(inbox.received) ? inbox.received : []);
      } else {
        setSentTransfers([]);
        setReceivedTransfers([]);
      }
    } catch (err) {
      setLoadError(errorMessage(err, 'No pudimos cargar tu cuenta.'));
      setOrders([]);
      setSentTransfers([]);
      setReceivedTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const next = encodeURIComponent(`/cuenta${search}`);
      router.replace(`/login?next=${next}`);
      return;
    }
    setUser(getStoredUser());
    const params = new URLSearchParams(window.location.search);
    const code = params.get('transfer');
    if (code) {
      setTransferCode(code);
      setTab('transferencias');
    }
    setReady(true);
    void reload();
  }, [router, reload]);

  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'COMPLETED'),
    [orders],
  );

  const upcoming = useMemo(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    return completedOrders
      .filter((o) => new Date(o.event.startsAt).getTime() >= cutoff)
      .sort(
        (a, b) =>
          new Date(a.event.startsAt).getTime() - new Date(b.event.startsAt).getTime(),
      );
  }, [completedOrders]);

  const history = useMemo(() => {
    const upcomingIds = new Set(upcoming.map((o) => o.publicId));
    return orders
      .filter((o) => !upcomingIds.has(o.publicId))
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [orders, upcoming]);

  const myTickets = useMemo((): OwnedTicket[] => {
    const list: OwnedTicket[] = [];
    for (const order of completedOrders) {
      for (const ticket of orderTickets(order)) {
        if (!ticket.id) continue;
        list.push({
          ...ticket,
          id: ticket.id,
          eventTitle: order.event.title,
          orderPublicId: order.publicId,
        });
      }
    }
    return list;
  }, [completedOrders]);

  async function acceptTransfer(e: FormEvent) {
    e.preventDefault();
    if (acceptBusy) return;
    setAcceptBusy(true);
    try {
      const res = await fetch(`${API_BASE}/tickets/transfer/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ transferCode: transferCode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        showToast('err', data.message || 'No se pudo aceptar la transferencia');
        return;
      }
      setTransferCode('');
      showToast('ok', 'Transferencia aceptada. El boleto ya está en tu wallet.');
      await reload();
      setTab('boletos');
    } catch (err) {
      showToast('err', errorMessage(err, 'No se pudo aceptar la transferencia'));
    } finally {
      setAcceptBusy(false);
    }
  }

  async function sendTransfer(e: FormEvent) {
    e.preventDefault();
    if (sendBusy) return;
    setSendBusy(true);
    try {
      const res = await fetch(`${API_BASE}/tickets/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          ticketId: transferForm.ticketId,
          toEmail: transferForm.toEmail.trim(),
          message: transferForm.message.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        showToast('err', data.message || 'No se pudo iniciar la transferencia');
        return;
      }
      setTransferForm({ ticketId: '', toEmail: '', message: '' });
      showToast('ok', 'Transferencia enviada. El destinatario recibirá un código.');
      await reload();
    } catch (err) {
      showToast('err', errorMessage(err, 'No se pudo iniciar la transferencia'));
    } finally {
      setSendBusy(false);
    }
  }

  async function requestCfdi(e: FormEvent) {
    e.preventDefault();
    if (!cfdiOrderId || cfdiBusy) return;
    setCfdiBusy(true);
    try {
      const order = orders.find((o) => o.publicId === cfdiOrderId);
      const res = await fetch(`${API_BASE}/orders/${cfdiOrderId}/cfdi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          receptorRfc: cfdiForm.rfc.trim().toUpperCase(),
          receptorNombre: cfdiForm.nombre.trim(),
          orderId: order?.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CfdiResponse;
      if (!res.ok) {
        showToast('err', data.message || 'No se pudo solicitar CFDI (sandbox)');
        return;
      }
      const uuid = data.uuid ?? 'sin UUID';
      showToast('ok', data.sandbox ? `CFDI sandbox: ${uuid}` : `CFDI: ${uuid}`);
      setCfdiForm({ rfc: '', nombre: '' });
    } catch (err) {
      showToast('err', errorMessage(err, 'No se pudo solicitar CFDI (sandbox)'));
    } finally {
      setCfdiBusy(false);
    }
  }

  function logout() {
    clearSession();
    router.push('/');
  }

  if (!ready) {
    return (
      <div className={styles.shell}>
        <SiteHeader />
        <main className={styles.page} aria-busy="true">
          <p className={styles.loading}>Verificando sesión…</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <div
          className={styles.toastRegion}
          aria-live="polite"
          aria-atomic="true"
          role="status"
        >
          {toast ? (
            <p className={toast.type === 'ok' ? styles.toastOk : styles.toastErr}>
              {toast.text}
            </p>
          ) : null}
        </div>

        <header className={styles.hero}>
          <p className={styles.eyebrow}>Mi cuenta</p>
          <h1>Wallet</h1>
          {user ? (
            <p className={styles.user}>
              Hola, {user.firstName || user.email}
              <span className={styles.userEmail}> · {user.email}</span>
            </p>
          ) : (
            <p className={styles.user}>Tus boletos, transferencias y preferencias</p>
          )}
        </header>

        <div className={styles.tabBar} role="tablist" aria-label="Secciones de la cuenta">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? styles.tabActive : styles.tab}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === 'boletos' && upcoming.length > 0 ? (
                <span className={styles.tabBadge}>{upcoming.length}</span>
              ) : null}
              {item.id === 'transferencias' && receivedTransfers.length > 0 ? (
                <span className={styles.tabBadge}>{receivedTransfers.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        {loadError ? (
          <div className={styles.errorBanner} role="alert">
            <p>{loadError}</p>
            <Button type="button" size="md" onClick={() => void reload()}>
              Reintentar
            </Button>
          </div>
        ) : null}

        {tab === 'boletos' ? (
          <section
            id="panel-boletos"
            role="tabpanel"
            aria-labelledby="tab-boletos"
            className={styles.panel}
          >
            <div className={styles.panelHead}>
              <h2>Próximos eventos</h2>
              <p className={styles.hint}>
                Abre el detalle para ver QR, PDF y opciones del boleto.
              </p>
            </div>

            {loading ? (
              <p className={styles.loading} aria-live="polite">
                Cargando tu wallet…
              </p>
            ) : null}

            {!loading && !loadError && upcoming.length === 0 ? (
              <EmptyState
                title="Sin boletos próximos"
                description="Cuando compres, tus entradas aparecerán aquí listas para el evento."
                action={
                  <Link href="/events" className={styles.primaryLink}>
                    Ver cartelera
                  </Link>
                }
              />
            ) : null}

            <ul className={styles.walletList}>
              {upcoming.map((order) => {
                const parts = calendarParts(order.event.startsAt);
                const tickets = orderTickets(order);
                const count = ticketCount(order);
                const dateAttr = isoDateAttr(order.event.startsAt);
                return (
                  <li key={order.publicId} className={styles.walletCard}>
                    {parts ? (
                      <div className={styles.walletDateBlock} aria-hidden>
                        <strong>{parts.day}</strong>
                        <span>{parts.month}</span>
                      </div>
                    ) : null}
                    <div className={styles.walletBody}>
                      <p className={styles.walletDate}>
                        <time dateTime={dateAttr || undefined}>
                          {parts?.weekday ? `${parts.weekday} · ` : ''}
                          {timeOfDay(order.event.startsAt) || dateTime(order.event.startsAt)}
                        </time>
                      </p>
                      <strong className={styles.walletTitle}>{order.event.title}</strong>
                      <p className={styles.walletMeta}>
                        {[
                          order.event.venue?.name,
                          order.event.venue?.city,
                          count ? plural(count, 'boleto') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {tickets.slice(0, 2).map((t, idx) => (
                        <p key={t.id ?? `${t.code}-${idx}`} className={styles.walletSeat}>
                          {seatLabel(t) || t.code}
                        </p>
                      ))}
                      {tickets.length > 2 ? (
                        <p className={styles.walletSeat}>+{tickets.length - 2} más</p>
                      ) : null}
                    </div>
                    <div className={styles.walletActions}>
                      <Link href={`/orders/${order.publicId}`} className={styles.qrCta}>
                        Ver QR
                      </Link>
                      <a
                        href={`${API_BASE}/orders/${order.publicId}/tickets.pdf`}
                        className={styles.actionLink}
                      >
                        Descargar PDF
                      </a>
                      <Link href={`/events/${order.event.slug}`} className={styles.actionLink}>
                        Ver evento
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            <TrustRow
              items={[TRUST_OFFICIAL, TRUST_QR, trustTransfer(true)]}
              label="Garantías de tu wallet"
            />
          </section>
        ) : null}

        {tab === 'historial' ? (
          <section
            id="panel-historial"
            role="tabpanel"
            aria-labelledby="tab-historial"
            className={styles.panel}
          >
            <div className={styles.panelHead}>
              <h2>Historial de órdenes</h2>
              <p className={styles.hint}>Compras anteriores y órdenes no activas en el wallet.</p>
            </div>

            {loading ? (
              <p className={styles.loading} aria-live="polite">
                Cargando historial…
              </p>
            ) : null}

            {!loading && history.length === 0 ? (
              <EmptyState
                title="Sin historial"
                description="Aún no tienes órdenes fuera del wallet de próximos eventos."
                action={
                  <Link href="/events" className={styles.primaryLink}>
                    Explorar eventos
                  </Link>
                }
              />
            ) : null}

            <ul className={styles.orderList}>
              {history.map((order) => (
                <li key={order.publicId} className={styles.orderRow}>
                  <div className={styles.orderMain}>
                    <strong>{order.event.title}</strong>
                    <span className={styles.status}>{orderStatusLabel(order.status)}</span>
                    <p className={styles.orderMeta}>
                      {dateTime(order.event.startsAt) || dateTime(order.createdAt)}
                      {order.event.venue?.city ? ` · ${order.event.venue.city}` : ''}
                    </p>
                  </div>
                  <p className={styles.orderTotal}>
                    {money(order.totalAmount, order.currency ?? 'MXN')}
                  </p>
                  <div className={styles.orderLinks}>
                    <Link href={`/orders/${order.publicId}`}>Ver detalle</Link>
                    {order.status === 'COMPLETED' ? (
                      <a href={`${API_BASE}/orders/${order.publicId}/tickets.pdf`}>
                        PDF boletos
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tab === 'transferencias' ? (
          <section
            id="panel-transferencias"
            role="tabpanel"
            aria-labelledby="tab-transferencias"
            className={styles.panel}
          >
            <div className={styles.panelHead}>
              <h2>Transferencias</h2>
              <p className={styles.hint}>
                Envía un boleto a otra persona o acepta un código que te compartieron.
              </p>
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Aceptar boleto</h3>
              <form onSubmit={acceptTransfer} className={styles.formStack}>
                <Input
                  label="Código de transferencia"
                  value={transferCode}
                  onChange={(e) => setTransferCode(e.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" size="md" disabled={acceptBusy || !transferCode.trim()}>
                  {acceptBusy ? 'Aceptando…' : 'Aceptar transferencia'}
                </Button>
              </form>
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Enviar boleto</h3>
              {myTickets.length === 0 ? (
                <p className={styles.hint}>
                  No tienes boletos transferibles en órdenes confirmadas.
                </p>
              ) : (
                <form onSubmit={sendTransfer} className={styles.formStack}>
                  <div className={styles.field}>
                    <label htmlFor="transfer-ticket">Boleto</label>
                    <select
                      id="transfer-ticket"
                      value={transferForm.ticketId}
                      onChange={(e) =>
                        setTransferForm({ ...transferForm, ticketId: e.target.value })
                      }
                      required
                    >
                      <option value="">Selecciona boleto</option>
                      {myTickets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} — {t.eventTitle}
                          {seatLabel(t) ? ` (${seatLabel(t)})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="Email del destinatario"
                    type="email"
                    value={transferForm.toEmail}
                    onChange={(e) =>
                      setTransferForm({ ...transferForm, toEmail: e.target.value })
                    }
                    required
                    autoComplete="email"
                  />
                  <Input
                    label="Mensaje (opcional)"
                    value={transferForm.message}
                    onChange={(e) =>
                      setTransferForm({ ...transferForm, message: e.target.value })
                    }
                  />
                  <Button type="submit" size="md" disabled={sendBusy}>
                    {sendBusy ? 'Enviando…' : 'Enviar transferencia'}
                  </Button>
                </form>
              )}
            </div>

            <div className={styles.transferColumns}>
              <div>
                <h3 className={styles.cardTitle}>Enviadas</h3>
                {sentTransfers.length === 0 ? (
                  <p className={styles.muted}>Aún no has enviado transferencias.</p>
                ) : (
                  <ul className={styles.transferList}>
                    {sentTransfers.map((t) => (
                      <li key={t.id}>
                        <strong>{t.ticket.event.title}</strong>
                        <span>
                          → {t.toEmail} · {transferStatusLabel(t.status)}
                        </span>
                        <small>Código {t.transferCode}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className={styles.cardTitle}>Recibidas</h3>
                {receivedTransfers.length === 0 ? (
                  <p className={styles.muted}>No tienes transferencias pendientes por aceptar.</p>
                ) : (
                  <ul className={styles.transferList}>
                    {receivedTransfers.map((t) => (
                      <li key={t.id}>
                        <strong>{t.ticket.event.title}</strong>
                        <span>{transferStatusLabel(t.status)}</span>
                        <small>Código {t.transferCode}</small>
                        {t.status === 'PENDING' ? (
                          <button
                            type="button"
                            className={styles.inlineAction}
                            onClick={() => {
                              setTransferCode(t.transferCode);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            Usar este código
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'perfil' ? (
          <section
            id="panel-perfil"
            role="tabpanel"
            aria-labelledby="tab-perfil"
            className={styles.panel}
          >
            <div className={styles.panelHead}>
              <h2>Perfil y preferencias</h2>
              <p className={styles.hint}>Datos de tu sesión y herramientas de facturación.</p>
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Tu cuenta</h3>
              {user ? (
                <dl className={styles.profileGrid}>
                  <div>
                    <dt>Nombre</dt>
                    <dd>
                      {user.firstName} {user.lastName}
                    </dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{user.email}</dd>
                  </div>
                  <div>
                    <dt>Rol</dt>
                    <dd>{user.role}</dd>
                  </div>
                </dl>
              ) : (
                <p className={styles.muted}>Sesión activa sin perfil guardado en este dispositivo.</p>
              )}
              <div className={styles.profileActions}>
                <Link href="/events" className={styles.primaryLink}>
                  Explorar eventos
                </Link>
                <Button type="button" variant="ghost" size="md" onClick={logout}>
                  Cerrar sesión
                </Button>
              </div>
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Factura CFDI (sandbox)</h3>
              <p className={styles.hint}>
                Solicita timbrado de prueba para una orden confirmada. Entorno sandbox.
              </p>
              {completedOrders.length === 0 ? (
                <p className={styles.muted}>Necesitas una orden confirmada para solicitar CFDI.</p>
              ) : (
                <form onSubmit={requestCfdi} className={styles.formStack}>
                  <div className={styles.field}>
                    <label htmlFor="cfdi-order">Orden confirmada</label>
                    <select
                      id="cfdi-order"
                      value={cfdiOrderId}
                      onChange={(e) => setCfdiOrderId(e.target.value)}
                      required
                    >
                      <option value="">Selecciona orden</option>
                      {completedOrders.map((o) => (
                        <option key={o.publicId} value={o.publicId}>
                          {o.event.title} · {o.publicId} ·{' '}
                          {money(o.totalAmount, o.currency ?? 'MXN')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="RFC receptor"
                    value={cfdiForm.rfc}
                    onChange={(e) => setCfdiForm({ ...cfdiForm, rfc: e.target.value })}
                    required
                    minLength={12}
                    maxLength={13}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Input
                    label="Razón social / nombre"
                    value={cfdiForm.nombre}
                    onChange={(e) => setCfdiForm({ ...cfdiForm, nombre: e.target.value })}
                    required
                    autoComplete="organization"
                  />
                  <Button type="submit" size="md" disabled={cfdiBusy}>
                    {cfdiBusy ? 'Timbrando…' : 'Solicitar CFDI'}
                  </Button>
                </form>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
