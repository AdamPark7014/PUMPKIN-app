'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  pushFailedSync,
  getLastReceipt,
  getSessionId,
  getTerminalId,
  getOpeningCash,
  printReceipt,
  syncOfflineSales,
  type OfflinePosPayload,
  type PosReceipt,
  type SessionSummary,
} from '@/lib/pos';
import { clearPendingSale, getPendingSale } from '@/lib/pos/idempotency';
import type { PendingSaleState } from '@/lib/pos/types';
import { formatMxn } from '@/lib/pos/money';
import { OperatorBoard, type EventRow } from '@/components/OperatorBoard';
import { ShiftStatus } from '@/components/ShiftStatus';
import styles from './taquilla.module.scss';

type ToastTone = 'info' | 'danger';

function pendingSaleCopy(state: PendingSaleState): {
  tone: 'warn' | 'danger' | 'info';
  title: string;
  detail: string;
  showRetry: boolean;
  showDismiss: boolean;
} {
  switch (state.status) {
    case 'submitting':
      return {
        tone: 'warn',
        title: 'Venta en proceso',
        detail: `Hay una venta incompleta (${state.clientSaleId.slice(0, 8)}…). No inicies otra hasta confirmar o reintentar la sincronización.`,
        showRetry: true,
        showDismiss: false,
      };
    case 'queued_offline':
      return {
        tone: 'warn',
        title: 'Venta en cola offline',
        detail: `Una venta quedó guardada localmente y aún no se sincronizó (${state.clientSaleId.slice(0, 8)}…).`,
        showRetry: true,
        showDismiss: false,
      };
    case 'failed':
      return {
        tone: 'danger',
        title: 'Venta fallida',
        detail: state.error
          ? `La última venta no se completó: ${state.error}`
          : 'La última venta no se completó. Revisa la cola o intenta sincronizar de nuevo.',
        showRetry: true,
        showDismiss: true,
      };
    case 'confirmed':
      return {
        tone: 'info',
        title: 'Venta confirmada',
        detail: state.publicId
          ? `La venta ${state.publicId} ya quedó confirmada.`
          : 'La venta pendiente ya quedó confirmada.',
        showRetry: false,
        showDismiss: true,
      };
  }
}

export default function TaquillaHome() {
  const router = useRouter();
  const mainRef = useRef<HTMLElement>(null);
  const [synced, setSynced] = useState(0);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [terminalLabel, setTerminalLabel] = useState('TAQ-01');
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cashierName, setCashierName] = useState('');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsStatus, setEventsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lastReceipt, setLastReceipt] = useState<PosReceipt | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const [failedSync, setFailedSync] = useState<Array<{ clientSaleId: string; error: string; at: string }>>([]);
  const [pendingSale, setPendingSale] = useState<PendingSaleState | null>(null);
  const [syncing, setSyncing] = useState(false);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  const refreshFailed = useCallback(() => {
    setFailedSync(getFailedSync());
  }, []);

  const recoverPendingSale = useCallback(() => {
    const state = getPendingSale();
    if (!state) {
      setPendingSale(null);
      return;
    }
    if (state.status === 'confirmed') {
      clearPendingSale();
      setPendingSale(null);
      return;
    }
    setPendingSale(state);
  }, []);

  const refreshSummary = useCallback(() => {
    const nextSessionId = getSessionId();
    setSessionId(nextSessionId);
    if (!nextSessionId) {
      setSummary(null);
      setSummaryStatus('idle');
      return;
    }
    setSummaryStatus('loading');
    fetchSessionSummary(nextSessionId)
      .then((nextSummary) => {
        setSummary(nextSummary);
        setSummaryStatus('ready');
      })
      .catch(() => {
        setSummary(null);
        setSummaryStatus('error');
      });
  }, []);

  const loadEvents = useCallback(() => {
    setEventsStatus('loading');
    apiFetch('/discovery/events')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('events'))))
      .then((data: EventRow[]) => {
        const now = Date.now();
        const week = now + 7 * 24 * 60 * 60 * 1000;
        const upcoming = data
          .filter((e) => {
            const t = new Date(e.startsAt).getTime();
            return Number.isFinite(t) && t >= now - 12 * 60 * 60 * 1000 && t <= week;
          })
          .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
          .slice(0, 8);
        setEvents(upcoming.length ? upcoming : data.slice(0, 8));
        setEventsStatus('ready');
      })
      .catch(() => {
        setEvents([]);
        setEventsStatus('error');
      });
  }, []);

  const retryOffline = useCallback(() => {
    if (!navigator.onLine) {
      showToast('Sin conexión: no se puede sincronizar ahora', 'danger');
      return;
    }
    setSyncing(true);
    void flushQueue(
      async (payload) => {
        if ((payload as OfflinePosPayload).type === 'pos') {
          await syncOfflineSales([payload as OfflinePosPayload]);
        }
      },
      { onFailure: pushFailedSync, force: true },
    )
      .then((n) => {
        if (n > 0) {
          setSynced((s) => s + n);
          clearFailedSync();
          showToast(`${n} venta${n === 1 ? '' : 's'} sincronizada${n === 1 ? '' : 's'}`);
        } else {
          showToast('No había ventas pendientes por sincronizar');
        }
        return getQueueSize();
      })
      .then((size) => {
        setPending(size);
        refreshFailed();
        recoverPendingSale();
        refreshSummary();
      })
      .finally(() => setSyncing(false));
  }, [recoverPendingSale, refreshFailed, refreshSummary, showToast]);

  const reprint = useCallback(() => {
    const rec = getLastReceipt() ?? lastReceipt;
    if (!rec) {
      showToast('No hay venta reciente para reimprimir', 'danger');
      return;
    }
    void printReceipt(rec, { reprint: true })
      .then((print) => {
        if (print.ok) {
          showToast('Reimprimiendo última venta');
        } else {
          showToast(`Error de impresora: ${print.error ?? 'desconocido'}`, 'danger');
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Error de impresora';
        showToast(`Error de impresora: ${msg}`, 'danger');
      });
  }, [lastReceipt, showToast]);

  useEffect(() => {
    if (!getTaquillaToken()) {
      router.replace('/login');
      return;
    }
    setTerminalLabel(getTerminalLabel());
    setTerminalId(getTerminalId());
    setSessionId(getSessionId());
    const user = getTaquillaUser();
    setCashierName(
      user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : 'Cajero',
    );
    setLastReceipt(getLastReceipt());
    refreshFailed();
    recoverPendingSale();
  }, [router, refreshFailed, recoverPendingSale]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(
        d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    refreshSummary();
    const id = window.setInterval(refreshSummary, 15000);
    return () => window.clearInterval(id);
  }, [refreshSummary]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const refresh = () => {
      setOnline(navigator.onLine);
      void getQueueSize().then(setPending);
    };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    refresh();

    const syncOnOnline = () => {
      if (!navigator.onLine) return;
      void flushQueue(
        async (payload) => {
          if ((payload as OfflinePosPayload).type === 'pos') {
            await syncOfflineSales([payload as OfflinePosPayload]);
          }
        },
        { onFailure: pushFailedSync },
      ).then((n) => {
        if (n > 0) {
          setSynced((s) => s + n);
          clearFailedSync();
        }
        void getQueueSize().then(setPending);
        setFailedSync(getFailedSync());
        recoverPendingSale();
      });
    };
    window.addEventListener('online', syncOnOnline);
    syncOnOnline();

    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('online', syncOnOnline);
      window.removeEventListener('offline', refresh);
    };
  }, [recoverPendingSale]);

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
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        reprint();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        mainRef.current?.focus({ preventScroll: true });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, reprint]);

  function logout() {
    clearTaquillaSession();
    router.push('/login');
  }

  function dismissPendingSale() {
    clearPendingSale();
    setPendingSale(null);
    showToast('Registro de venta pendiente descartado');
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

  const sessionOpen = Boolean(sessionId);
  const openingCash = summary?.openingCash ?? getOpeningCash();
  const expectedCash = summary ? summary.expectedCash : null;
  const dropsTotal = summary?.dropsTotal ?? null;
  const degraded = !online || pending > 0 || failedSync.length > 0 || summaryStatus === 'error' || Boolean(pendingSale);
  const statusOffline = !online;
  const pendingSaleUi = pendingSale ? pendingSaleCopy(pendingSale) : null;
  const showBanner = pending > 0 || synced > 0 || !online || failedSync.length > 0;

  return (
    <main ref={mainRef} className={styles.home} tabIndex={-1}>
      <div className={styles.bg} aria-hidden="true" />

      {toast && (
        <p className={toast.tone === 'danger' ? styles.toastDanger : styles.toast} role="status">
          {toast.message}
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
            <small>Terminal POS</small>
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
          <span
            className={
              statusOffline ? styles.statusDanger : degraded ? styles.statusOff : styles.statusOn
            }
          >
            <span className={styles.dot} />
            {statusOffline ? 'Sin conexión' : degraded ? 'Operación degradada' : 'Operación normal'}
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

      {showBanner && (
        <div
          className={`${styles.banner} ${!online ? styles.bannerOffline : ''}`}
          role="status"
          aria-live="polite"
        >
          {!online && (
            <span className={styles.bannerDanger}>
              <strong>Sin conexión</strong>
              <em>Las ventas se guardan en cola local hasta recuperar red.</em>
            </span>
          )}
          {synced > 0 && (
            <span className={styles.bannerSuccess}>
              <strong>{synced}</strong> ventas sincronizadas en esta sesión.
            </span>
          )}
          {pending > 0 && (
            <span className={styles.bannerInfo}>
              <strong>{pending}</strong> pendientes de sync.
              <button type="button" className={styles.bannerBtn} onClick={retryOffline} disabled={syncing || !online}>
                {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
            </span>
          )}
          {failedSync.length > 0 && (
            <span className={styles.bannerWarn}>
              <strong>{failedSync.length}</strong> sync fallidas.
              <button type="button" className={styles.bannerBtn} onClick={retryOffline} disabled={syncing || !online}>
                Reintentar
              </button>
            </span>
          )}
        </div>
      )}

      {pendingSaleUi && pendingSale && (
        <div
          className={
            pendingSaleUi.tone === 'danger'
              ? styles.recoveryDanger
              : pendingSaleUi.tone === 'info'
                ? styles.recoveryInfo
                : styles.recoveryWarn
          }
          role="alert"
        >
          <div>
            <strong>{pendingSaleUi.title}</strong>
            <p>{pendingSaleUi.detail}</p>
          </div>
          <div className={styles.recoveryActions}>
            {pendingSaleUi.showRetry && (
              <button type="button" onClick={retryOffline} disabled={syncing || !online}>
                {syncing ? 'Sincronizando…' : 'Reintentar sync'}
              </button>
            )}
            {pendingSale.status === 'submitting' && (
              <Link href="/eventos">Ir a venta</Link>
            )}
            {pendingSaleUi.showDismiss && (
              <button type="button" className={styles.recoveryDismiss} onClick={dismissPendingSale}>
                Descartar alerta
              </button>
            )}
          </div>
        </div>
      )}

      <div className={styles.workspace}>
        <ShiftStatus
          sessionOpen={sessionOpen}
          cashierName={cashierName}
          terminalLabel={terminalLabel}
          terminalId={terminalId}
          sessionId={sessionId}
          openingCash={openingCash}
          expectedCash={expectedCash}
          dropsTotal={dropsTotal}
          startTime={summary?.startTime ?? null}
          online={online}
          pendingCount={pending}
          failedCount={failedSync.length}
          summaryStatus={summaryStatus}
          onRefresh={refreshSummary}
        />

        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Flujos principales</span>
            <h2>Acciones rápidas</h2>
          </div>
          <span>Toque grande · atajos de teclado</span>
        </div>

        <section className={styles.quickActions} aria-label="Acciones frecuentes">
          <Link href="/eventos" className={`${styles.actionCard} ${styles.primary}`}>
            <span className={styles.actionKey}>F1</span>
            <strong>Nueva venta</strong>
            <span>Evento, lugares y cobro</span>
          </Link>
          <Link href="/eventos" className={styles.actionCard}>
            <span className={styles.actionKey}>F2</span>
            <strong>Eventos</strong>
            <span>Catálogo del día</span>
          </Link>
          <Link href="/buscar" className={styles.actionCard}>
            <span className={styles.actionKey}>F3</span>
            <strong>Buscar</strong>
            <span>Código u orden</span>
          </Link>
          <Link href="/willcall" className={styles.actionCard}>
            <span className={styles.actionKey}>F4</span>
            <strong>Will-call</strong>
            <span>Entrega en taquilla</span>
          </Link>
          <Link href="/eventos?comp=1" className={styles.actionCard}>
            <span className={styles.actionKey}>F5</span>
            <strong>Cortesías</strong>
            <span>Venta COMP</span>
          </Link>
          <button type="button" className={styles.actionCard} onClick={reprint}>
            <span className={styles.actionKey}>R</span>
            <strong>Reimprimir</strong>
            <span>
              {lastReceipt
                ? `${lastReceipt.receiptNumber} · ${formatMxn(lastReceipt.total)}`
                : 'Sin venta reciente'}
            </span>
          </button>
          <Link href="/corte" className={styles.actionCard}>
            <span className={styles.actionKey}>F12</span>
            <strong>Corte de caja</strong>
            <span>
              {summaryStatus === 'error'
                ? 'Resumen no disponible'
                : summary
                  ? `Esperado ${formatMxn(summary.expectedCash)}`
                  : 'Conciliar y cerrar turno'}
            </span>
          </Link>
          <Link href="/ajustes" className={styles.actionCard}>
            <span className={styles.actionKey}>CFG</span>
            <strong>Ajustes</strong>
            <span>Impresora, terminal y PIN</span>
          </Link>
        </section>

        <section className={styles.terminalPanel} aria-label="Resumen de terminal y caja">
          <header>
            <div>
              <span className={styles.eyebrow}>Terminal y caja</span>
              <h2>Estación {terminalLabel}</h2>
            </div>
            <span className={sessionOpen ? styles.chipOk : styles.chipWarn}>
              {sessionOpen ? 'Sesión activa' : 'Sin sesión'}
            </span>
          </header>
          <dl>
            <div>
              <dt>ID terminal</dt>
              <dd>{terminalId ?? 'Sin registrar'}</dd>
            </div>
            <div>
              <dt>ID sesión</dt>
              <dd>{sessionId ?? '—'}</dd>
            </div>
            <div>
              <dt>Fondo</dt>
              <dd>{formatMxn(openingCash)}</dd>
            </div>
            <div>
              <dt>Efectivo esperado</dt>
              <dd>
                {summaryStatus === 'error'
                  ? 'No disponible'
                  : expectedCash === null
                    ? '—'
                    : formatMxn(expectedCash)}
              </dd>
            </div>
            <div>
              <dt>Cola offline</dt>
              <dd className={pending || failedSync.length ? styles.valueWarn : styles.valueOk}>
                {failedSync.length
                  ? `${failedSync.length} fallidas`
                  : pending
                    ? `${pending} pendientes`
                    : 'Vacía'}
              </dd>
            </div>
            <div>
              <dt>Último recibo</dt>
              <dd>{lastReceipt?.receiptNumber ?? 'Ninguno'}</dd>
            </div>
          </dl>
        </section>

        <OperatorBoard
          events={events}
          eventsStatus={eventsStatus}
          onRetryEvents={loadEvents}
          summary={summary}
          summaryStatus={summaryStatus}
          onRefreshSummary={refreshSummary}
          sellHref={sellHref}
        />
      </div>

      <footer className={styles.footer}>
        <span className={styles.hotkeysTitle}>Atajos</span>
        <ul className={styles.hotkeys}>
          <li>
            <kbd>F1</kbd> Nueva venta
          </li>
          <li>
            <kbd>F2</kbd> Eventos
          </li>
          <li>
            <kbd>F3</kbd> Buscar
          </li>
          <li>
            <kbd>F4</kbd> Will-call
          </li>
          <li>
            <kbd>F5</kbd> Cortesías
          </li>
          <li>
            <kbd>R</kbd> Reimprimir
          </li>
          <li>
            <kbd>F12</kbd> Corte
          </li>
          <li>
            <kbd>Esc</kbd> Quitar foco
          </li>
        </ul>
      </footer>
    </main>
  );
}
