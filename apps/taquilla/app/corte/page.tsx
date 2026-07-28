'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getTaquillaToken,
  getTaquillaUser,
  getTerminalLabel,
  saveTaquillaSession,
} from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import {
  endSession,
  fetchSessionSummary,
  getCashierId,
  getOpeningCash,
  getSessionId,
  addCashDrop,
  handoffShift,
  type SessionSummary,
} from '@/lib/pos';
import styles from './corte.module.scss';

function money(n: number) {
  return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function methodMeta(m: string) {
  const map: Record<string, { label: string; color: string }> = {
    CASH: { label: 'Efectivo', color: '#a1a1aa' },
    CARD: { label: 'Tarjeta', color: '#d4d4d8' },
  };
  return map[m] ?? { label: m, color: '#737373' };
}

export default function CortePage() {
  const router = useRouter();
  const [report, setReport] = useState<SessionSummary | null>(null);
  const [counted, setCounted] = useState('');
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [closedReport, setClosedReport] = useState<Record<string, unknown> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dropAmount, setDropAmount] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [handoffCashier, setHandoffCashier] = useState('');
  const [handoffDone, setHandoffDone] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    fetchSessionSummary(sessionId)
      .then((s) => {
        setReport(s);
        setCounted(String(s.expectedCash.toFixed(2)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F12' && !closed) {
        e.preventDefault();
        void closeShift();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed, counted, report]);

  function printCorte(data: SessionSummary | Record<string, unknown>) {
    const r = data as SessionSummary & {
      closingCashCounted?: number;
      variance?: number;
      endTime?: string;
    };
    const lines = [
      'CORTE DE CAJA — BOLETERA',
      `Cajero: ${getCashierId()}`,
      `Inicio: ${new Date(r.startTime).toLocaleString('es-MX')}`,
      `Fin: ${new Date(r.endTime || Date.now()).toLocaleString('es-MX')}`,
      '',
      `Transacciones: ${r.totalTransactions}`,
      `Total ventas: ${money(Number(r.totalRevenue))}`,
      `Fondo inicial: ${money(Number(r.openingCash))}`,
      `Ventas efectivo: ${money(Number(r.cashSales))}`,
      `Esperado en caja: ${money(Number(r.expectedCash))}`,
      r.closingCashCounted != null ? `Contado: ${money(Number(r.closingCashCounted))}` : '',
      r.variance != null ? `Diferencia: ${money(Number(r.variance))}` : '',
      '',
      ...Object.entries(r.byMethod || {}).map(([m, a]) => `${m}: ${money(Number(a))}`),
    ].filter(Boolean);
    const w = window.open('', '_blank', 'width=320,height=560');
    if (!w) return;
    w.document.write(`<pre style="font-family:monospace;font-size:12px">${lines.join('\n')}</pre>`);
    w.document.close();
    w.print();
  }

  async function closeShift() {
    const sessionId = getSessionId();
    if (!sessionId) {
      showToast('No hay sesión activa. Inicia turno en login.');
      return;
    }
    const countedNum = Number(counted);
    if (!Number.isFinite(countedNum) || countedNum < 0) {
      showToast('Ingresa el efectivo contado');
      return;
    }
    setLoading(true);
    try {
      const data = await endSession(sessionId, countedNum, managerPin || undefined);
      setClosedReport(data);
      setReport({
        ...(report as SessionSummary),
        ...data,
        recentSales: report?.recentSales ?? [],
      });
      setClosed(true);
      localStorage.removeItem('boletera_pos_session');
      printCorte(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Error en corte');
    } finally {
      setLoading(false);
    }
  }

  async function doHandoff() {
    const countedNum = Number(counted);
    if (!handoffCashier.trim()) {
      showToast('Indica el ID/email del cajero entrante');
      return;
    }
    if (!Number.isFinite(countedNum)) {
      showToast('Ingresa efectivo contado');
      return;
    }
    setLoading(true);
    try {
      const data = await handoffShift({
        toCashierId: handoffCashier.trim(),
        closingCashCounted: countedNum,
        openingCash: countedNum,
        managerPin: managerPin || undefined,
      });
      setClosedReport(data.closed);
      setHandoffDone(true);
      setClosed(true);
      const token = getTaquillaToken();
      const user = getTaquillaUser();
      if (token && user) {
        saveTaquillaSession(token, {
          terminalLabel: getTerminalLabel(),
          user: { ...user, id: handoffCashier.trim() },
          cashierId: handoffCashier.trim(),
        });
      }
      showToast('Handoff listo — turno del nuevo cajero abierto');
      router.replace('/');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Error en handoff');
    } finally {
      setLoading(false);
    }
  }

  const expected = report?.expectedCash ?? getOpeningCash();
  const countedNum = Number(counted);
  const variance =
    Number.isFinite(countedNum) && report ? countedNum - expected : closedReport?.variance;

  const totalMethods = report
    ? Object.values(report.byMethod || {}).reduce((s, a) => s + Number(a), 0)
    : 0;

  return (
    <PosShell title="Corte de caja" eyebrow="Cierre de turno" backHref="/">
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      {report ? (
        <>
          <section className={styles.bigTotal}>
            <p className={styles.bigLabel}>Total cobrado en este turno</p>
            <strong>{money(report.totalRevenue)}</strong>
            <span className={styles.bigSub}>
              {report.totalTransactions} transacciones · fondo {money(report.openingCash)}
            </span>
          </section>

          <section className={styles.section}>
            <h2>Arqueo de efectivo</h2>
            <dl className={styles.details}>
              <div>
                <dt>Fondo inicial</dt>
                <dd>{money(report.openingCash)}</dd>
              </div>
              <div>
                <dt>Ventas efectivo</dt>
                <dd>{money(report.cashSales)}</dd>
              </div>
              <div>
                <dt>Retiros (drops)</dt>
                <dd>{money(report.dropsTotal ?? 0)}</dd>
              </div>
              <div>
                <dt>Esperado en caja</dt>
                <dd>{money(report.expectedCash)}</dd>
              </div>
              <div>
                <dt>Ventas tarjeta</dt>
                <dd>{money(report.cardSales)}</dd>
              </div>
              <div>
                <dt>Cortesías</dt>
                <dd>{report.compCount ?? 0}</dd>
              </div>
            </dl>

            {!closed && (
              <>
                <label className={styles.countField}>
                  <small>Retiro de efectivo (drop)</small>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={dropAmount}
                      onChange={(e) => setDropAmount(e.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.printBtn}
                      onClick={async () => {
                        try {
                          const s = await addCashDrop(Number(dropAmount), 'Drop de turno');
                          setReport(s);
                          setCounted(String(s.expectedCash.toFixed(2)));
                          setDropAmount('');
                          showToast('Drop registrado');
                        } catch (e) {
                          showToast(e instanceof Error ? e.message : 'Error');
                        }
                      }}
                    >
                      Registrar
                    </button>
                  </div>
                </label>
                <label className={styles.countField}>
                  <small>Efectivo contado</small>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                  />
                </label>
                <label className={styles.countField}>
                  <small>PIN gerente (si varianza &gt; $50)</small>
                  <input
                    type="password"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder="2468"
                  />
                </label>
                <label className={styles.countField}>
                  <small>Handoff — ID cajero entrante</small>
                  <input
                    value={handoffCashier}
                    onChange={(e) => setHandoffCashier(e.target.value)}
                    placeholder="user-id del siguiente cajero"
                  />
                </label>
              </>
            )}

            {variance != null && Number.isFinite(Number(variance)) && (
              <p className={Number(variance) === 0 ? styles.varianceOk : styles.varianceBad}>
                Diferencia: {money(Number(variance))}
                {Number(variance) === 0 ? ' · cuadrado' : Number(variance) > 0 ? ' · sobrante' : ' · faltante'}
              </p>
            )}
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
                      <div className={styles.methodInfo}>
                        <strong>{meta.label}</strong>
                        <div className={styles.bar}>
                          <span style={{ width: `${pct}%`, background: meta.color }} />
                        </div>
                      </div>
                      <span className={styles.amount}>{money(amount)}</span>
                      <span className={styles.pct}>{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      ) : (
        <div className={styles.empty}>
          <p>Sin datos de turno. Abre turno en login o realiza una venta.</p>
        </div>
      )}

      <div className={styles.actions}>
        {report && (
          <button
            type="button"
            className={styles.printBtn}
            onClick={() => printCorte(closedReport || report)}
          >
            Imprimir corte
          </button>
        )}
        {!closed && (
          <>
            <button type="button" className={styles.printBtn} disabled={loading} onClick={() => void doHandoff()}>
              Entregar turno
            </button>
            <button type="button" className={styles.closeBtn} disabled={loading} onClick={() => void closeShift()}>
              {loading ? 'Cerrando…' : 'Cerrar turno'}
            </button>
          </>
        )}
      </div>

      {closed && (
        <p className={styles.done}>
          {handoffDone ? 'Turno entregado.' : 'Turno cerrado.'}{' '}
          <Link href={handoffDone ? '/' : '/login'}>
            {handoffDone ? 'Volver al inicio' : 'Abrir nuevo turno'}
          </Link>
        </p>
      )}
    </PosShell>
  );
}
