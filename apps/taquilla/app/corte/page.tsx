'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCashierId, getSessionId } from '@/lib/pos';
import styles from './corte.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type ShiftReport = {
  totalTransactions: number;
  totalRevenue: number;
  byMethod: Record<string, number>;
  startTime: string;
  endTime: string;
};

function methodMeta(m: string) {
  const map: Record<string, { label: string; color: string; icon: string }> = {
    CASH: { label: 'Efectivo', color: '#171717', icon: 'E' },
    CARD: { label: 'Tarjeta', color: '#e11d48', icon: 'T' },
    OTHER: { label: 'Otro', color: '#737373', icon: '•' },
  };
  return map[m] ?? { label: m, color: '#737373', icon: '•' };
}

export default function CortePage() {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    fetch(`${API}/taquilla/session/summary?sessionId=${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setReport)
      .catch(() => {});
  }, []);

  function printCorte() {
    if (!report) return;
    const lines = [
      'CORTE DE CAJA — BOLETERA',
      `Cajero: ${getCashierId()}`,
      `Inicio: ${new Date(report.startTime).toLocaleString('es-MX')}`,
      `Fin: ${new Date(report.endTime).toLocaleString('es-MX')}`,
      '',
      `Transacciones: ${report.totalTransactions}`,
      `Total: $${Number(report.totalRevenue).toFixed(2)}`,
      '',
      ...Object.entries(report.byMethod || {}).map(([m, a]) => `${m}: $${Number(a).toFixed(2)}`),
    ];
    const w = window.open('', '_blank', 'width=320,height=520');
    if (!w) return;
    w.document.write(`<pre style="font-family:monospace;font-size:12px">${lines.join('\n')}</pre>`);
    w.document.close();
    w.print();
  }

  async function closeShift() {
    const sessionId = getSessionId();
    if (!sessionId) {
      showToast('No hay sesión activa. Inicia venta primero.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/taquilla/session/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cashierId: getCashierId() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReport(data);
      setClosed(true);
      localStorage.removeItem('boletera_pos_session');
      printCorte();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Error en corte');
    } finally {
      setLoading(false);
    }
  }

  const totalMethods = report
    ? Object.values(report.byMethod || {}).reduce((s, a) => s + Number(a), 0)
    : 0;

  return (
    <main className={styles.page}>
      <div className={styles.bg} aria-hidden="true" />
      {toast && (
        <p role="status" style={{ margin: '0.75rem 1rem', padding: '0.75rem 1rem', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
          {toast}
        </p>
      )}

      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Inicio
        </Link>
        <div className={styles.headerCenter}>
          <p className={styles.eyebrow}>Cierre de turno</p>
          <h1>Corte de caja</h1>
        </div>
        <span className={styles.cashier}>
          <small>Cajero</small>
          <strong>{getCashierId()}</strong>
        </span>
      </header>

      {report ? (
        <>
          <section className={styles.bigTotal}>
            <p className={styles.bigLabel}>Total cobrado en este turno</p>
            <strong>
              ${Number(report.totalRevenue).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </strong>
            <span className={styles.bigSub}>
              {report.totalTransactions} transacciones · turno {new Date(report.startTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              {' → '}
              {new Date(report.endTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </section>

          {report.byMethod && Object.keys(report.byMethod).length > 0 && (
            <section className={styles.section}>
              <h2>Desglose por método</h2>
              <ul className={styles.breakdown}>
                {Object.entries(report.byMethod).map(([m, a]) => {
                  const amount = Number(a);
                  const pct = totalMethods ? Math.round((amount / totalMethods) * 100) : 0;
                  const meta = methodMeta(m);
                  return (
                    <li key={m}>
                      <span className={styles.methodIcon} aria-hidden>
                        {meta.icon}
                      </span>
                      <div className={styles.methodInfo}>
                        <strong>{meta.label}</strong>
                        <div className={styles.bar}>
                          <span style={{ width: `${pct}%`, background: meta.color }} />
                        </div>
                      </div>
                      <span className={styles.amount}>${amount.toFixed(2)}</span>
                      <span className={styles.pct}>{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className={styles.section}>
            <h2>Detalles</h2>
            <dl className={styles.details}>
              <div>
                <dt>Transacciones</dt>
                <dd>{report.totalTransactions}</dd>
              </div>
              <div>
                <dt>Promedio por venta</dt>
                <dd>
                  $
                  {report.totalTransactions
                    ? (Number(report.totalRevenue) / report.totalTransactions).toFixed(2)
                    : '0.00'}
                </dd>
              </div>
              <div>
                <dt>Inicio del turno</dt>
                <dd>{new Date(report.startTime).toLocaleString('es-MX')}</dd>
              </div>
              <div>
                <dt>Fin del turno</dt>
                <dd>{new Date(report.endTime).toLocaleString('es-MX')}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : (
        <div className={styles.empty}>
          <p>
            Sin datos de turno todavía. Realiza ventas o cierra sesión para generar el corte.
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {report && (
          <button type="button" className={styles.printBtn} onClick={printCorte}>
            <span>↻ Imprimir corte</span>
            <small>vista ESC/POS</small>
          </button>
        )}
        {!closed && (
          <button type="button" className={styles.closeBtn} disabled={loading} onClick={closeShift}>
            {loading ? 'Cerrando turno…' : 'Cerrar turno'}
            <kbd>F12</kbd>
          </button>
        )}
      </div>

      {closed && (
        <p className={styles.done}>
          <span aria-hidden>✓</span> Turno cerrado correctamente. Que tengas buen día.
        </p>
      )}
    </main>
  );
}
