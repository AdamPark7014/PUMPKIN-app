'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveTaquillaSession } from '@/lib/auth';
import styles from './login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function IconTerminal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 9l2 2-2 2M11 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 11V8a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TaquillaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@demo.boletera.com');
  const [password, setPassword] = useState('Admin123!');
  const [terminalId, setTerminalId] = useState('TAQ-01');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long' }));
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Credenciales inválidas');
      saveTaquillaSession(data.accessToken, terminalId);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.bg} aria-hidden="true" />
      <div className={styles.scan} aria-hidden="true" />

      {/* Topbar superior estilo POS */}
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#22d3ee" />
              <path d="M9 11h14M9 16h14M9 21h9" stroke="#062330" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="22" cy="21" r="2.5" fill="#062330" />
            </svg>
            BOLETERA · TAQUILLA
          </span>
        </div>
        <div className={styles.topRight}>
          <span className={online ? styles.statusOn : styles.statusOff}>
            <span className={styles.dotSm} />
            {online ? 'En línea' : 'Sin conexión · ventas en cola'}
          </span>
          <span className={styles.clock}>
            <strong>{time}</strong>
            <small>{date}</small>
          </span>
        </div>
      </header>

      <div className={styles.shell}>
        {/* Panel decorativo izquierdo */}
        <section className={styles.showcase}>
          <div className={styles.showcaseInner}>
            <p className={styles.kicker}>Point-of-Sale</p>
            <h1>
              Abre turno y
              <br />
              vende en taquilla.
            </h1>
            <p className={styles.lead}>
              Inventario en vivo, ofertas por zona, modo offline y corte de caja.
            </p>

            <div className={styles.kpiRow}>
              <div className={styles.kpi}>
                <span>Pagos</span>
                <strong>Banorte</strong>
                <em>tarjeta / efectivo</em>
              </div>
              <div className={styles.kpi}>
                <span>Disponibilidad</span>
                <strong>99.9<small>%</small></strong>
                <em>offline-ready</em>
              </div>
              <div className={styles.kpi}>
                <span>Métodos</span>
                <strong>6<small>+</small></strong>
                <em>de pago</em>
              </div>
            </div>

            <div className={styles.terminalPreview}>
              <header>
                <span className={styles.lights}>
                  <i /> <i /> <i />
                </span>
                <span>TAQ-01 · POS terminal</span>
              </header>
              <div className={styles.ticketLine}>
                <span>Bad Bunny — Most Wanted Tour</span>
                <strong>$890.00</strong>
              </div>
              <div className={styles.ticketLine}>
                <span>VIP · Zona A · Fila 12</span>
                <strong className={styles.muted}>× 2</strong>
              </div>
              <div className={styles.ticketLine + ' ' + styles.total}>
                <span>TOTAL</span>
                <strong>$1,780.00</strong>
              </div>
              <button type="button" className={styles.fakeBtn} tabIndex={-1}>
                Cobrar efectivo · F8
              </button>
            </div>
          </div>
        </section>

        {/* Panel del formulario */}
        <section className={styles.formPanel}>
          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <span className={styles.cardBadge}>Apertura de turno</span>
              <h2>Identifícate, cajero</h2>
              <p>Confirma terminal, credencial y comienza tu turno.</p>
            </header>

            <form onSubmit={submit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="terminal">Terminal asignada</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconTerminal />
                  </span>
                  <input
                    id="terminal"
                    className={styles.mono}
                    value={terminalId}
                    onChange={(e) => setTerminalId(e.target.value.toUpperCase())}
                    placeholder="TAQ-01"
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="cajero-email">Email del cajero</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconUser />
                  </span>
                  <input
                    id="cajero-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cajero@boletera.com"
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="cajero-password">Contraseña / PIN</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}>
                    <IconLock />
                  </span>
                  <input
                    id="cajero-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className={styles.error} role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Iniciando turno…
                  </>
                ) : (
                  <>
                    <span>Abrir turno</span>
                    <kbd>↵</kbd>
                  </>
                )}
              </button>
            </form>

            <p className={styles.cardFooter}>
              Solo personal autorizado. Las acciones de esta terminal quedan auditadas.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
