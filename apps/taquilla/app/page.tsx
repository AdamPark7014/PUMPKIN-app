'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearTaquillaSession, getCashierId, getTaquillaToken } from '@/lib/auth';
import { flushQueue, getQueueSize } from '@/lib/offline-queue';
import { syncOfflineSales, type OfflinePosPayload } from '@/lib/pos';
import styles from './taquilla.module.scss';

export default function TaquillaHome() {
  const router = useRouter();
  const [synced, setSynced] = useState(0);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [terminalId, setTerminalId] = useState('TAQ-01');

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
    setTerminalId(getCashierId() || 'TAQ-01');
  }, [router]);

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
        if (n > 0) setSynced((s) => s + n);
        getQueueSize().then(setPending);
      });
    };
    window.addEventListener('online', syncOnOnline);

    flushQueue(async (payload) => {
      if ((payload as OfflinePosPayload).type === 'pos') {
        const p = payload as OfflinePosPayload;
        await syncOfflineSales([p]);
      }
    }).then((n) => {
      if (n > 0) setSynced(n);
      getQueueSize().then(setPending);
    });

    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('online', syncOnOnline);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  function logout() {
    clearTaquillaSession();
    router.push('/login');
  }

  return (
    <main className={styles.home}>
      <div className={styles.bg} aria-hidden="true" />

      {/* Topbar */}
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#22d3ee" />
              <path d="M9 11h14M9 16h14M9 21h9" stroke="#062330" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="22" cy="21" r="2.5" fill="#062330" />
            </svg>
            TAQUILLA
          </span>
          <span className={styles.terminal}>
            <small>TERMINAL</small>
            <strong>{terminalId}</strong>
          </span>
        </div>

        <div className={styles.topCenter}>
          <strong>{time}</strong>
          <small>{date}</small>
        </div>

        <div className={styles.topRight}>
          <span className={online ? styles.statusOn : styles.statusOff}>
            <span className={styles.dot} />
            {online ? 'En línea' : 'Modo offline'}
          </span>
          <button type="button" className={styles.logoutBtn} onClick={logout} aria-label="Cerrar turno">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* Status banner */}
      {(pending > 0 || synced > 0 || !online) && (
        <div className={styles.banner}>
          {!online && (
            <span className={styles.bannerWarn}>
              <strong>Sin conexión</strong> · las ventas se guardan en cola y se sincronizan automáticamente al recuperar la red.
            </span>
          )}
          {synced > 0 && (
            <span className={styles.bannerSuccess}>
              <strong>{synced}</strong> ventas offline sincronizadas correctamente.
            </span>
          )}
          {pending > 0 && (
            <span className={styles.bannerInfo}>
              <strong>{pending}</strong> ventas pendientes de sincronización.
            </span>
          )}
        </div>
      )}

      {/* Hero / acción principal */}
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Turno activo</p>
          <h1>
            ¿Qué vas a vender
            <br />
            <span className={styles.gradient}>en este turno?</span>
          </h1>
          <p className={styles.lead}>
            Cobra en taquilla con efectivo, tarjeta Banorte y atajos de teclado.
            Inventario actualizado en tiempo real.
          </p>
          <Link href="/eventos" className={styles.heroBtn}>
            <span>Nueva venta</span>
            <kbd>F1</kbd>
          </Link>
        </div>

        <aside className={styles.heroSide}>
          <div className={styles.miniStats}>
            <div>
              <span>Pagos</span>
              <strong>Banorte</strong>
              <em>tarjeta / efectivo</em>
            </div>
            <div>
              <span>Inventario</span>
              <strong>En vivo</strong>
              <em>holds y venta</em>
            </div>
            <div>
              <span>Acceso</span>
              <strong>QR</strong>
              <em>escaneo en puerta</em>
            </div>
          </div>
        </aside>
      </section>

      {/* Acciones */}
      <section className={styles.actions}>
        <Link href="/eventos" className={`${styles.actionCard} ${styles.primary}`}>
          <div className={styles.actionIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 4h12l2 6-7 10-7-10z M3 10h18 M9 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z M15 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <strong>Nueva venta</strong>
            <span>Cobrar boletos · F1</span>
          </div>
        </Link>

        <Link href="/eventos" className={styles.actionCard}>
          <div className={styles.actionIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16v13H4z M4 7l2-3h12l2 3 M8 12h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <strong>Eventos</strong>
            <span>Ver catálogo del día</span>
          </div>
        </Link>

        <Link href="/corte" className={styles.actionCard}>
          <div className={styles.actionIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M2 7h20v10H2z M6 12h2 M14 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <strong>Corte de caja</strong>
            <span>Cerrar turno · F12</span>
          </div>
        </Link>

        <Link href="#" className={`${styles.actionCard} ${styles.muted}`}>
          <div className={styles.actionIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <div>
            <strong>Reimprimir</strong>
            <span>Última transacción</span>
          </div>
        </Link>
      </section>

      {/* Atajos del teclado */}
      <footer className={styles.footer}>
        <span className={styles.hotkeysTitle}>Atajos rápidos</span>
        <ul className={styles.hotkeys}>
          <li>
            <kbd>F1</kbd> Nueva venta
          </li>
          <li>
            <kbd>F2</kbd> Buscar evento
          </li>
          <li>
            <kbd>F8</kbd> Cobrar efectivo
          </li>
          <li>
            <kbd>F9</kbd> Cobrar tarjeta
          </li>
          <li>
            <kbd>F12</kbd> Corte de caja
          </li>
        </ul>
      </footer>
    </main>
  );
}
