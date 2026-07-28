'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  clearTaquillaSession,
  getTerminalLabel,
  getTaquillaToken,
  getTaquillaUser,
  apiFetch,
} from '@/lib/auth';
import { flushQueue, getQueueSize } from '@/lib/offline-queue';
import {
  fetchSessionSummary,
  getFailedSync,
  clearFailedSync,
  getLastReceipt,
  getSessionId,
  printReceipt,
  syncOfflineSales,
  type OfflinePosPayload,
  type PosReceipt,
  type SessionSummary,
} from '@/lib/pos';
import styles from './taquilla.module.scss';

type EventRow = {
  id: string;
  title: string;
  startsAt: string;
  venue: { name: string };
  offers?: { id: string; name?: string; zone?: string; basePrice: string | number; remainingQuantity?: number }[];
};

function money(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TaquillaHome() {
  const router = useRouter();
  const [synced, setSynced] = useState(0);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [terminalLabel, setTerminalLabel] = useState('TAQ-01');
  const [cashierName, setCashierName] = useState('');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [lastReceipt, setLastReceipt] = useState<PosReceipt | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [failedSync, setFailedSync] = useState<Array<{ clientSaleId: string; error: string; at: string }>>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshFailed = useCallback(() => {
    setFailedSync(getFailedSync());
  }, []);

  const refreshSummary = useCallback(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    fetchSessionSummary(sessionId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) {
      router.replace('/login');
      return;
    }
    setTerminalLabel(getTerminalLabel());
    const user = getTaquillaUser();
    setCashierName(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : 'Cajero',
    );
    setLastReceipt(getLastReceipt());
    refreshFailed();
  }, [router, refreshFailed]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(
        d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    refreshSummary();
    const id = setInterval(refreshSummary, 15000);
    return () => clearInterval(id);
  }, [refreshSummary]);

  useEffect(() => {
    apiFetch('/discovery/events')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: EventRow[]) => {
        const now = Date.now();
        const week = now + 7 * 24 * 60 * 60 * 1000;
        const upcoming = data
          .filter((e) => {
            const t = new Date(e.startsAt).getTime();
            return t >= now - 12 * 60 * 60 * 1000 && t <= week;
          })
          .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
          .slice(0, 8);
        setEvents(upcoming.length ? upcoming : data.slice(0, 8));
      })
      .catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const refresh = () => {
      setOnline(navigator.onLine);
      getQueueSize().then(setPending);
    };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    refresh();

    const syncOnOnline = () => {
      if (!navigator.onLine) return;
      void flushQueue(async (payload) => {
        if ((payload as OfflinePosPayload).type === 'pos') {
          await syncOfflineSales([payload as OfflinePosPayload]);
        }
      }).then((n) => {
        if (n > 0) {
          setSynced((s) => s + n);
          clearFailedSync();
        }
        getQueueSize().then(setPending);
        setFailedSync(getFailedSync());
      });
    };
    window.addEventListener('online', syncOnOnline);
    syncOnOnline();

    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('online', syncOnOnline);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'F1') {
        e.preventDefault();
        router.push('/eventos');
      } else if (e.key === 'F2') {
        e.preventDefault();
        router.push('/eventos');
      } else if (e.key === 'F3') {
        e.preventDefault();
        router.push('/buscar');
      } else if (e.key === 'F4') {
        e.preventDefault();
        router.push('/willcall');
      } else if (e.key === 'F5') {
        e.preventDefault();
        router.push('/eventos?comp=1');
      } else if (e.key === 'F12') {
        e.preventDefault();
        router.push('/corte');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  function logout() {
    clearTaquillaSession();
    router.push('/login');
  }

  function reprint() {
    const rec = getLastReceipt();
    if (!rec) {
      showToast('No hay venta reciente para reimprimir');
      return;
    }
    void printReceipt(rec);
    showToast('Reimprimiendo última venta');
  }

  function retryOffline() {
    void flushQueue(async (payload) => {
      if ((payload as OfflinePosPayload).type === 'pos') {
        await syncOfflineSales([payload as OfflinePosPayload]);
      }
    }).then((n) => {
      if (n > 0) {
        setSynced((s) => s + n);
        clearFailedSync();
        showToast(`${n} ventas sincronizadas`);
      }
      getQueueSize().then(setPending);
      refreshFailed();
    });
  }

  function sellHref(e: EventRow) {
    const offer = e.offers?.[0];
    const q = new URLSearchParams({
      eventId: e.id,
      ...(offer?.id ? { offerId: offer.id } : {}),
      ...(offer?.basePrice != null ? { unitPrice: String(offer.basePrice) } : {}),
    });
    return `/venta?${q.toString()}`;
  }

  return (
    <main className={styles.home}>
      <div className={styles.bg} aria-hidden="true" />

      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#f4f4f5" />
              <path d="M9 11h14M9 16h14M9 21h9" stroke="#18181b" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="22" cy="21" r="2.5" fill="#18181b" />
            </svg>
            TAQUILLA
          </span>
          <span className={styles.terminal}>
            <small>Terminal</small>
            <strong>{terminalLabel}</strong>
          </span>
        </div>

        <div className={styles.topCenter}>
          <strong>{time}</strong>
          <small>{date}</small>
        </div>

        <div className={styles.topRight}>
          <span className={styles.cashierChip}>
            <small>Cajero</small>
            <strong>{cashierName}</strong>
          </span>
          <span className={online ? styles.statusOn : styles.statusOff}>
            <span className={styles.dot} />
            {online ? 'En línea' : 'Offline'}
          </span>
          <button type="button" className={styles.logoutBtn} onClick={logout} aria-label="Cerrar sesión">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {(pending > 0 || synced > 0 || !online || failedSync.length > 0) && (
        <div className={styles.banner}>
          {!online && (
            <span className={styles.bannerWarn}>
              <strong>Sin conexión</strong> · ventas en cola local.
            </span>
          )}
          {synced > 0 && (
            <span className={styles.bannerSuccess}>
              <strong>{synced}</strong> ventas sincronizadas.
            </span>
          )}
          {pending > 0 && (
            <span className={styles.bannerInfo}>
              <strong>{pending}</strong> pendientes de sync.
            </span>
          )}
          {failedSync.length > 0 && (
            <span className={styles.bannerWarn}>
              <strong>{failedSync.length}</strong> sync fallidas.{' '}
              <button type="button" onClick={retryOffline} style={{ marginLeft: 8, cursor: 'pointer' }}>
                Reintentar
              </button>
            </span>
          )}
        </div>
      )}

      <div className={styles.workspace}>
        <section className={styles.kpiRow} aria-label="Resumen del turno">
          <div className={styles.kpi}>
            <span>Ventas turno</span>
            <strong>{money(summary?.totalRevenue ?? 0)}</strong>
          </div>
          <div className={styles.kpi}>
            <span>Transacciones</span>
            <strong>{summary?.totalTransactions ?? 0}</strong>
          </div>
          <div className={styles.kpi}>
            <span>Efectivo</span>
            <strong>{money(summary?.cashSales ?? 0)}</strong>
          </div>
          <div className={styles.kpi}>
            <span>Tarjeta</span>
            <strong>{money(summary?.cardSales ?? 0)}</strong>
          </div>
        </section>

        <section className={styles.quickActions}>
          <Link href="/eventos" className={`${styles.actionCard} ${styles.primary}`}>
            <strong>Nueva venta</strong>
            <span>Seleccionar evento</span>
          </Link>
          <Link href="/eventos" className={styles.actionCard}>
            <strong>Eventos</strong>
            <span>Catálogo del día</span>
          </Link>
          <Link href="/buscar" className={styles.actionCard}>
            <strong>Buscar</strong>
            <span>Código u orden</span>
          </Link>
          <Link href="/willcall" className={styles.actionCard}>
            <strong>Will-call</strong>
            <span>Entrega en taquilla</span>
          </Link>
          <button type="button" className={styles.actionCard} onClick={reprint}>
            <strong>Reimprimir</strong>
            <span>{lastReceipt ? lastReceipt.receiptNumber : 'Sin venta reciente'}</span>
          </button>
          <Link href="/corte" className={styles.actionCard}>
            <strong>Corte de caja</strong>
            <span>Cerrar turno</span>
          </Link>
          <Link href="/ajustes" className={styles.actionCard}>
            <strong>Ajustes</strong>
            <span>Impresora y PIN</span>
          </Link>
        </section>

        <div className={styles.columns}>
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2>Eventos</h2>
              <Link href="/eventos">Ver todos</Link>
            </header>
            {events.length === 0 ? (
              <p className={styles.empty}>No hay eventos en ventana de venta.</p>
            ) : (
              <ul className={styles.eventList}>
                {events.map((e) => {
                  const offer = e.offers?.[0];
                  const price = offer ? Number(offer.basePrice) : 0;
                  const when = new Date(e.startsAt);
                  return (
                    <li key={e.id}>
                      <Link href={sellHref(e)} className={styles.eventRow}>
                        <div>
                          <strong>{e.title}</strong>
                          <span>
                            {e.venue?.name} ·{' '}
                            {when.toLocaleString('es-MX', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className={styles.eventMeta}>
                          <em>{price > 0 ? `desde ${money(price)}` : '—'}</em>
                          <span className={styles.sellCta}>Vender</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2>Últimas ventas</h2>
              <button type="button" onClick={refreshSummary}>
                Actualizar
              </button>
            </header>
            {!summary?.recentSales?.length ? (
              <p className={styles.empty}>Aún no hay ventas en este turno.</p>
            ) : (
              <ul className={styles.salesList}>
                {summary.recentSales.map((s) => (
                  <li key={s.orderId}>
                    <div>
                      <strong>{s.eventTitle}</strong>
                      <span>
                        {s.publicId} · {s.paymentMethod} · ×{s.quantity}
                      </span>
                    </div>
                    <strong className={styles.saleTotal}>{money(s.total)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.hotkeysTitle}>Atajos</span>
        <ul className={styles.hotkeys}>
          <li>
            <kbd>F1</kbd> Venta
          </li>
          <li>
            <kbd>F3</kbd> Buscar
          </li>
          <li>
            <kbd>F12</kbd> Corte
          </li>
        </ul>
      </footer>
    </main>
  );
}
