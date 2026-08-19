'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getTaquillaToken,
  getTaquillaUser,
  getTerminalLabel,
  saveTaquillaSession,
} from '@/lib/auth';
import { CashCountPad } from '@/components/CashCountPad';
import { PosShell } from '@/components/PosShell';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getQueueSize } from '@/lib/offline-queue';
import {
  addCashDrop,
  cashVarianceCentavos,
  clearCloseIntent,
  endSession,
  fetchSessionSummary,
  formatMxn,
  getCashierId,
  getCloseIntent,
  getOpeningCash,
  getSessionId,
  handoffShift,
  parseMoneyInput,
  retryCloseIntent,
  SESSION_KEY,
  type Centavos,
  type CloseIntentState,
  type SessionSummary,
} from '@/lib/pos';
import {
  acknowledgeAlreadySentClose,
  classifyCloseRecovery,
} from './_lib/close-guard';
import {
  classifyMethod,
  formatDateTimeMx,
  methodLabel,
  methodMeta,
  needsManagerPin,
  pesosFromCentavos,
  varianceKind,
  varianceLabel,
  type MethodBucket,
  type VarianceKind,
} from './_lib/format';
import styles from './corte.module.scss';

type ClosedSessionReport = Partial<SessionSummary> & {
  closingCashCounted?: number;
  variance?: number;
  endTime?: string;
};

type RecoveryUi =
  | { kind: 'none' }
  | { kind: 'already_sent' }
  | { kind: 'retry'; intent: CloseIntentState };

const CLOSE_CONFIRM_PHRASE = 'CERRAR TURNO';

function toClosedReport(data: Record<string, unknown>): ClosedSessionReport {
  return data as ClosedSessionReport;
}

function asPrintable(data: SessionSummary | ClosedSessionReport): ClosedSessionReport {
  return data;
}

export default function CortePage() {
  const router = useRouter();
  const { online } = useOnlineStatus();
  const confirmInputId = useId();
  const countedInputId = useId();
  const pinInputId = useId();
  const dropInputId = useId();
  const handoffInputId = useId();
  const closeSectionRef = useRef<HTMLElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);

  const [report, setReport] = useState<SessionSummary | null>(null);
  const [reportStatus, setReportStatus] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [counted, setCounted] = useState('');
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [closedReport, setClosedReport] = useState<ClosedSessionReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dropAmount, setDropAmount] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [handoffCashier, setHandoffCashier] = useState('');
  const [handoffDone, setHandoffDone] = useState(false);
  const [pendingSales, setPendingSales] = useState(0);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closePhrase, setClosePhrase] = useState('');
  const [auditNote, setAuditNote] = useState('');
  const [recovery, setRecovery] = useState<RecoveryUi>({ kind: 'none' });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadReport = useCallback(() => {
    const sessionId = getSessionId();
    if (!sessionId) {
      setReport(null);
      setReportStatus('empty');
      return;
    }
    setReportStatus('loading');
    fetchSessionSummary(sessionId)
      .then((summary) => {
        setReport(summary);
        setCounted((prev) => (prev.trim() ? prev : summary.expectedCash.toFixed(2)));
        setReportStatus('ready');
      })
      .catch(() => {
        setReport(null);
        setReportStatus('error');
      });
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    const classified = classifyCloseRecovery(getCloseIntent(), getSessionId());
    if (classified.kind === 'already_sent') {
      setRecovery({ kind: 'already_sent' });
      setClosed(true);
      acknowledgeAlreadySentClose();
      showToast('Corte ya enviado — recuperando');
      return;
    }
    if (classified.kind === 'retry') {
      setRecovery({ kind: 'retry', intent: classified.intent });
      setCounted(classified.intent.closingCashCounted.toFixed(2));
      setManagerPin(classified.intent.managerPin ?? '');
      setConfirmingClose(true);
      showToast('Hay un cierre pendiente. Puedes reintentarlo.');
    }
  }, [showToast]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    const refreshQueue = () => {
      void getQueueSize().then(setPendingSales);
    };
    refreshQueue();
    window.addEventListener('online', refreshQueue);
    window.addEventListener('offline', refreshQueue);
    return () => {
      window.removeEventListener('online', refreshQueue);
      window.removeEventListener('offline', refreshQueue);
    };
  }, [online]);

  const printCorte = useCallback(
    (data: SessionSummary | ClosedSessionReport) => {
      const printable = asPrintable(data);
      const lines = [
        'CORTE DE CAJA — PUMPKIN ZONE',
        `Terminal: ${getTerminalLabel()}`,
        `Cajero: ${getCashierId()}`,
        `Inicio: ${formatDateTimeMx(printable.startTime)}`,
        `Fin: ${formatDateTimeMx(printable.endTime ?? new Date().toISOString())}`,
        '',
        `Transacciones: ${printable.totalTransactions ?? '—'}`,
        `Total ventas: ${printable.totalRevenue != null ? formatMxn(printable.totalRevenue) : '—'}`,
        `Fondo inicial: ${printable.openingCash != null ? formatMxn(printable.openingCash) : '—'}`,
        `Ventas efectivo: ${printable.cashSales != null ? formatMxn(printable.cashSales) : '—'}`,
        `Ventas tarjeta: ${printable.cardSales != null ? formatMxn(printable.cardSales) : '—'}`,
        `Cortesías: ${printable.compCount ?? 0}`,
        `Retiros: ${formatMxn(printable.dropsTotal ?? 0)}`,
        `Esperado en caja: ${printable.expectedCash != null ? formatMxn(printable.expectedCash) : '—'}`,
        printable.closingCashCounted != null
          ? `Contado: ${formatMxn(printable.closingCashCounted)}`
          : '',
        printable.variance != null ? `Diferencia: ${formatMxn(printable.variance)}` : '',
        '',
        'Desglose por método',
        ...Object.entries(printable.byMethod ?? {}).map(
          ([method, amount]) => `${methodLabel(method)}: ${formatMxn(amount)}`,
        ),
      ].filter(Boolean);

      const popup = window.open('', '_blank', 'width=360,height=640');
      if (!popup) {
        showToast('Permite ventanas emergentes para imprimir el corte');
        return;
      }
      try {
        popup.document.write(
          `<pre style="font-family:ui-monospace,monospace;font-size:12px;padding:16px">${lines.join('\n')}</pre>`,
        );
        popup.document.close();
        popup.focus();
        popup.print();
      } catch {
        showToast('No se pudo preparar la impresión del corte');
      }
    },
    [showToast],
  );

  const exportCorte = useCallback(
    (data: SessionSummary | ClosedSessionReport) => {
      const printable = asPrintable(data);
      const rows: Array<[string, string]> = [
        ['Campo', 'Valor'],
        ['Terminal', getTerminalLabel()],
        ['Cajero', getCashierId()],
        ['Inicio', printable.startTime ?? ''],
        ['Fin', printable.endTime ?? ''],
        [
          'Transacciones',
          printable.totalTransactions != null ? String(printable.totalTransactions) : '',
        ],
        ['Ventas MXN', printable.totalRevenue != null ? String(printable.totalRevenue) : ''],
        ['Fondo inicial MXN', printable.openingCash != null ? String(printable.openingCash) : ''],
        ['Efectivo MXN', printable.cashSales != null ? String(printable.cashSales) : ''],
        ['Tarjeta MXN', printable.cardSales != null ? String(printable.cardSales) : ''],
        ['Cortesías', String(printable.compCount ?? 0)],
        ['Retiros MXN', String(printable.dropsTotal ?? 0)],
        ['Esperado MXN', printable.expectedCash != null ? String(printable.expectedCash) : ''],
        [
          'Contado MXN',
          printable.closingCashCounted != null ? String(printable.closingCashCounted) : '',
        ],
        ['Diferencia MXN', printable.variance != null ? String(printable.variance) : ''],
        ['Nota auditoría', auditNote.trim()],
      ];
      Object.entries(printable.byMethod ?? {}).forEach(([method, amount]) => {
        rows.push([`Método ${methodLabel(method)}`, String(amount)]);
      });

      const csv = rows
        .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `corte-${getTerminalLabel()}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast('Corte exportado (CSV)');
    },
    [auditNote, showToast],
  );

  const applyClosedResult = useCallback(
    (data: ClosedSessionReport) => {
      setClosedReport(data);
      if (report) setReport({ ...report, ...data, recentSales: report.recentSales });
      setClosed(true);
      setConfirmingClose(false);
      setRecovery({ kind: 'none' });
      // SESSION_KEY is cleared by endSession/retryCloseIntent only after server confirm;
      // keep local remove as a post-success belt-and-suspenders step.
      localStorage.removeItem(SESSION_KEY);
      clearCloseIntent();
      printCorte(data);
    },
    [printCorte, report],
  );

  const closeShift = useCallback(async () => {
    if (inFlightRef.current || loading || closed) return;

    const sessionId = getSessionId();
    if (!sessionId) {
      showToast('No hay sesión activa. Inicia turno en login.');
      return;
    }

    const countedCentavos = parseMoneyInput(counted);
    if (countedCentavos === null || countedCentavos < 0n) {
      showToast('Ingresa el efectivo contado');
      return;
    }

    if (!online || pendingSales > 0) {
      showToast('Sincroniza las ventas pendientes antes de cerrar el turno');
      return;
    }

    if (closePhrase.trim().toUpperCase() !== CLOSE_CONFIRM_PHRASE) {
      setConfirmingClose(true);
      showToast(`Escribe ${CLOSE_CONFIRM_PHRASE} para confirmar`);
      window.setTimeout(() => {
        closeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        confirmInputRef.current?.focus();
      }, 0);
      return;
    }

    const expected = report?.expectedCash ?? getOpeningCash();
    const variance = cashVarianceCentavos(pesosFromCentavos(countedCentavos), expected);
    if (needsManagerPin(variance) && !managerPin.trim()) {
      showToast('PIN de gerente requerido: diferencia mayor a $50.00');
      return;
    }

    const countedPesos = pesosFromCentavos(countedCentavos);
    inFlightRef.current = true;
    setLoading(true);
    try {
      // endSession persists close intent before the network call.
      const data = toClosedReport(await endSession(sessionId, countedPesos, managerPin || undefined));
      applyClosedResult(data);
      showToast('Turno cerrado correctamente');
    } catch (e) {
      setRecovery({
        kind: 'retry',
        intent: getCloseIntent() ?? {
          sessionId,
          closingCashCounted: countedPesos,
          managerPin: managerPin || undefined,
          startedAt: new Date().toISOString(),
          status: 'failed',
          error: e instanceof Error ? e.message : 'Error en corte',
        },
      });
      showToast(e instanceof Error ? e.message : 'Error en corte — puedes reintentar');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [
    applyClosedResult,
    closePhrase,
    closed,
    counted,
    loading,
    managerPin,
    online,
    pendingSales,
    report?.expectedCash,
    showToast,
  ]);

  const retryPendingClose = useCallback(async () => {
    if (inFlightRef.current || loading) return;
    if (!online || pendingSales > 0) {
      showToast('Sincroniza las ventas pendientes antes de reintentar el cierre');
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    try {
      const data = toClosedReport(await retryCloseIntent());
      applyClosedResult(data);
      showToast('Cierre recuperado correctamente');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo reintentar el cierre');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [applyClosedResult, loading, online, pendingSales, showToast]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          e.preventDefault();
          target.blur();
        }
        return;
      }
      if (e.key === 'F12' && !closed) {
        e.preventDefault();
        if (!confirmingClose) {
          setConfirmingClose(true);
          window.setTimeout(() => {
            closeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            confirmInputRef.current?.focus();
          }, 0);
          return;
        }
        void closeShift();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeShift, closed, confirmingClose]);

  async function doHandoff() {
    if (inFlightRef.current || loading || closed) return;
    const countedCentavos = parseMoneyInput(counted);
    if (!handoffCashier.trim()) {
      showToast('Indica el ID/email del cajero entrante');
      return;
    }
    if (countedCentavos === null || countedCentavos < 0n) {
      showToast('Ingresa efectivo contado');
      return;
    }
    if (!online || pendingSales > 0) {
      showToast('Sincroniza las ventas pendientes antes de entregar el turno');
      return;
    }

    const expected = report?.expectedCash ?? getOpeningCash();
    const variance = cashVarianceCentavos(pesosFromCentavos(countedCentavos), expected);
    if (needsManagerPin(variance) && !managerPin.trim()) {
      showToast('PIN de gerente requerido: diferencia mayor a $50.00');
      return;
    }

    const countedPesos = pesosFromCentavos(countedCentavos);
    inFlightRef.current = true;
    setLoading(true);
    try {
      const data = await handoffShift({
        toCashierId: handoffCashier.trim(),
        closingCashCounted: countedPesos,
        openingCash: countedPesos,
        managerPin: managerPin || undefined,
      });
      setClosedReport(toClosedReport(data.closed));
      setHandoffDone(true);
      setClosed(true);
      setRecovery({ kind: 'none' });
      clearCloseIntent();
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
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  async function registerDrop() {
    const amountCents = parseMoneyInput(dropAmount);
    if (amountCents === null || amountCents <= 0n) {
      showToast('Ingresa un monto de retiro válido');
      return;
    }
    try {
      const summary = await addCashDrop(pesosFromCentavos(amountCents), 'Drop de turno');
      setReport(summary);
      setCounted(summary.expectedCash.toFixed(2));
      setDropAmount('');
      setReportStatus('ready');
      showToast('Retiro registrado');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo registrar el retiro');
    }
  }

  const expected = report?.expectedCash ?? getOpeningCash();
  const countedCentavos = parseMoneyInput(counted);

  const varianceCentavos: Centavos | null = useMemo(() => {
    if (closedReport?.variance != null && Number.isFinite(closedReport.variance)) {
      try {
        // Server-reported variance converted through integer centavos (no float subtract).
        return cashVarianceCentavos(closedReport.variance, 0);
      } catch {
        return null;
      }
    }
    if (countedCentavos === null || report == null) return null;
    return cashVarianceCentavos(pesosFromCentavos(countedCentavos), expected);
  }, [closedReport?.variance, countedCentavos, expected, report]);

  const kind: VarianceKind | null = varianceCentavos != null ? varianceKind(varianceCentavos) : null;
  const pinRequired = varianceCentavos != null ? needsManagerPin(varianceCentavos) : false;

  const methodGroups = useMemo(() => {
    const groups: Record<MethodBucket, number> = { CASH: 0, CARD: 0, COMP: 0, OTHER: 0 };
    if (!report?.byMethod) return groups;
    for (const [method, amount] of Object.entries(report.byMethod)) {
      groups[classifyMethod(method)] += Number(amount) || 0;
    }
    return groups;
  }, [report]);

  const methodEntries = useMemo(() => {
    if (!report?.byMethod) return [] as Array<[string, number]>;
    return Object.entries(report.byMethod)
      .map(([method, amount]) => [method, Number(amount) || 0] as [string, number])
      .sort((a, b) => b[1] - a[1]);
  }, [report]);

  const totalMethods = methodEntries.reduce((sum, [, amount]) => sum + amount, 0);
  const phraseOk = closePhrase.trim().toUpperCase() === CLOSE_CONFIRM_PHRASE;
  const syncBlocked = !online || pendingSales > 0;
  const canClose =
    Boolean(report) &&
    !closed &&
    !syncBlocked &&
    countedCentavos !== null &&
    countedCentavos >= 0n &&
    phraseOk &&
    (!pinRequired || Boolean(managerPin.trim())) &&
    !loading;

  const varianceClass =
    kind === 'cuadrado'
      ? styles.varianceOk
      : kind === 'sobrante'
        ? styles.varianceSobrante
        : kind === 'faltante'
          ? styles.varianceFaltante
          : null;

  const exportSource = closedReport ?? report;

  return (
    <PosShell title="Corte de caja" eyebrow="Conciliación de turno" backHref="/" size="md" online={online}>
      {toast && (
        <p className={styles.toast} role="status" aria-live="polite">
          {toast}
        </p>
      )}

      {recovery.kind === 'already_sent' && (
        <div className={styles.recoveryBanner} role="status">
          <strong>Corte ya enviado — recuperando</strong>
          <span>El cierre se confirmó en servidor. La sesión local ya no está activa.</span>
          <div className={styles.recoveryActions}>
            <Link href="/login" className={styles.secondaryBtn}>
              Abrir nuevo turno
            </Link>
            {exportSource && (
              <button type="button" className={styles.secondaryBtn} onClick={() => printCorte(exportSource)}>
                Reimprimir corte
              </button>
            )}
          </div>
        </div>
      )}

      {recovery.kind === 'retry' && !closed && (
        <div className={styles.recoveryBanner} role="status">
          <strong>Cierre pendiente de confirmar</strong>
          <span>
            Se guardó un intento de corte ({formatMxn(recovery.intent.closingCashCounted)}). La sesión sigue
            abierta — reintenta el cierre con seguridad.
          </span>
          <div className={styles.recoveryActions}>
            <button
              type="button"
              className={styles.closeBtn}
              disabled={loading || syncBlocked}
              onClick={() => void retryPendingClose()}
            >
              {loading ? 'Reintentando…' : 'Reintentar cierre'}
            </button>
          </div>
        </div>
      )}

      <section className={styles.statusStrip} aria-label="Estado operativo del corte">
        <div>
          <span>Terminal</span>
          <strong>{getTerminalLabel()}</strong>
        </div>
        <div>
          <span>Cajero</span>
          <strong>{getCashierId()}</strong>
        </div>
        <div>
          <span>Red</span>
          <strong className={online ? styles.valueOk : styles.valueWarn}>
            {online ? 'Conectada' : 'Sin conexión'}
          </strong>
        </div>
        <div>
          <span>Cola offline</span>
          <strong className={pendingSales > 0 ? styles.valueWarn : styles.valueOk}>
            {pendingSales > 0 ? `${pendingSales} pendientes` : 'Vacía'}
          </strong>
        </div>
      </section>

      {syncBlocked && (
        <div className={styles.degradedBanner} role="status">
          <strong>{online ? 'Operación degradada' : 'Modo offline'}</strong>
          <span>
            {online
              ? 'Hay ventas pendientes de sincronización. Conciliación bloqueada hasta vaciar la cola.'
              : 'Sin red: puedes revisar el arqueo, pero el cierre y handoff requieren conexión.'}
          </span>
        </div>
      )}

      {reportStatus === 'loading' && (
        <div className={styles.empty}>
          <p>Cargando resumen del turno…</p>
        </div>
      )}

      {reportStatus === 'error' && (
        <div className={styles.empty}>
          <p>No se pudo cargar el resumen del turno. Los importes no se inventan.</p>
          <button type="button" className={styles.secondaryBtn} onClick={loadReport}>
            Reintentar
          </button>
        </div>
      )}

      {reportStatus === 'empty' && recovery.kind === 'none' && (
        <div className={styles.empty}>
          <p>Sin turno activo. Abre turno en login o realiza una venta para generar sesión.</p>
          <Link href="/" className={styles.secondaryBtn}>
            Volver al dashboard
          </Link>
        </div>
      )}

      {report && (
        <>
          <section className={styles.hero} aria-label="Totales del turno">
            <div>
              <p className={styles.eyebrow}>Total cobrado</p>
              <strong className={styles.heroTotal}>{formatMxn(report.totalRevenue)}</strong>
              <p className={styles.heroMeta}>
                {report.totalTransactions} transacciones · inicio {formatDateTimeMx(report.startTime)}
              </p>
            </div>
            <dl className={styles.heroStats}>
              <div>
                <dt>Efectivo</dt>
                <dd>{formatMxn(report.cashSales)}</dd>
              </div>
              <div>
                <dt>Tarjeta</dt>
                <dd>{formatMxn(report.cardSales)}</dd>
              </div>
              <div>
                <dt>Cortesías</dt>
                <dd>
                  {formatMxn(methodGroups.COMP)} · {report.compCount ?? 0}
                </dd>
              </div>
              <div>
                <dt>Otros</dt>
                <dd>{formatMxn(methodGroups.OTHER)}</dd>
              </div>
            </dl>
          </section>

          <div className={styles.grid}>
            <section className={styles.panel} aria-labelledby="arqueo-title">
              <header className={styles.panelHead}>
                <div>
                  <p className={styles.eyebrow}>Arqueo</p>
                  <h2 id="arqueo-title">Efectivo en caja</h2>
                </div>
              </header>

              <dl className={styles.details}>
                <div>
                  <dt>Fondo inicial</dt>
                  <dd>{formatMxn(report.openingCash)}</dd>
                </div>
                <div>
                  <dt>Ventas efectivo</dt>
                  <dd>{formatMxn(report.cashSales)}</dd>
                </div>
                <div>
                  <dt>Retiros (drops)</dt>
                  <dd>{formatMxn(report.dropsTotal ?? 0)}</dd>
                </div>
                <div className={styles.detailAccent}>
                  <dt>Esperado en caja</dt>
                  <dd>{formatMxn(report.expectedCash)}</dd>
                </div>
              </dl>

              {!closed && (
                <div className={styles.formStack}>
                  <label className={styles.field} htmlFor={dropInputId}>
                    <span>Retiro de efectivo (drop)</span>
                    <div className={styles.inlineField}>
                      <input
                        id={dropInputId}
                        type="text"
                        inputMode="decimal"
                        value={dropAmount}
                        onChange={(e) => setDropAmount(e.target.value)}
                        aria-describedby={`${dropInputId}-help`}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => void registerDrop()}
                        disabled={loading}
                      >
                        Registrar
                      </button>
                    </div>
                    <small id={`${dropInputId}-help`}>Reduce el efectivo esperado en caja.</small>
                  </label>

                  <div className={styles.field}>
                    <span>Efectivo contado (MXN)</span>
                    <CashCountPad
                      id={countedInputId}
                      value={counted}
                      onChange={setCounted}
                      disabled={loading}
                      expectedPesos={report.expectedCash}
                    />
                  </div>

                  {varianceCentavos != null && kind && varianceClass && (
                    <p className={varianceClass} role="status" aria-live="polite">
                      Esperado {formatMxn(expected)} · Contado{' '}
                      {countedCentavos != null ? formatMxn(countedCentavos) : '—'} · Diferencia{' '}
                      {formatMxn(varianceCentavos)} · {varianceLabel(kind)}
                    </p>
                  )}

                  <label className={styles.field} htmlFor={pinInputId}>
                    <span>
                      PIN gerente {pinRequired ? '(requerido: |diferencia| &gt; $50)' : '(si aplica)'}
                    </span>
                    <input
                      id={pinInputId}
                      type="password"
                      value={managerPin}
                      onChange={(e) => setManagerPin(e.target.value)}
                      autoComplete="off"
                      inputMode="numeric"
                      placeholder="2468"
                    />
                  </label>
                </div>
              )}

              {closed && closedReport && (
                <dl className={styles.details}>
                  <div>
                    <dt>Contado</dt>
                    <dd>
                      {closedReport.closingCashCounted != null
                        ? formatMxn(closedReport.closingCashCounted)
                        : '—'}
                    </dd>
                  </div>
                  <div
                    className={
                      kind === 'cuadrado'
                        ? styles.detailOk
                        : kind === 'faltante'
                          ? styles.detailDanger
                          : styles.detailWarn
                    }
                  >
                    <dt>Diferencia final</dt>
                    <dd>
                      {closedReport.variance != null
                        ? `${formatMxn(closedReport.variance)}${kind ? ` · ${varianceLabel(kind)}` : ''}`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="metodos-title">
              <header className={styles.panelHead}>
                <div>
                  <p className={styles.eyebrow}>Conciliación</p>
                  <h2 id="metodos-title">Efectivo / tarjeta / cortesía</h2>
                </div>
              </header>

              <ul className={styles.methodCards}>
                <li>
                  <span>Efectivo</span>
                  <strong>{formatMxn(methodGroups.CASH)}</strong>
                </li>
                <li>
                  <span>Tarjeta</span>
                  <strong>{formatMxn(methodGroups.CARD)}</strong>
                </li>
                <li>
                  <span>Cortesía</span>
                  <strong>
                    {formatMxn(methodGroups.COMP)}
                    <small> · {report.compCount ?? 0}</small>
                  </strong>
                </li>
              </ul>

              {methodEntries.length > 0 ? (
                <ul className={styles.breakdown}>
                  {methodEntries.map(([method, amount]) => {
                    const pct = totalMethods ? Math.round((amount / totalMethods) * 100) : 0;
                    const meta = methodMeta(method);
                    return (
                      <li key={method}>
                        <div className={styles.methodInfo}>
                          <strong>{meta.label}</strong>
                          <div className={styles.bar} aria-hidden="true">
                            <span style={{ width: `${pct}%`, background: meta.color }} />
                          </div>
                        </div>
                        <span className={styles.amount}>{formatMxn(amount)}</span>
                        <span className={styles.pct}>{pct}%</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.panelEmpty}>Sin desglose por método en este turno.</p>
              )}
            </section>
          </div>

          <section className={styles.panel} aria-labelledby="audit-title">
            <header className={styles.panelHead}>
              <div>
                <p className={styles.eyebrow}>Auditoría</p>
                <h2 id="audit-title">Bitácora del cierre</h2>
              </div>
            </header>
            <dl className={styles.auditGrid}>
              <div>
                <dt>Sesión</dt>
                <dd>{getSessionId() ?? '—'}</dd>
              </div>
              <div>
                <dt>Inicio</dt>
                <dd>{formatDateTimeMx(report.startTime)}</dd>
              </div>
              <div>
                <dt>Fin</dt>
                <dd>{formatDateTimeMx(closedReport?.endTime ?? report.endTime)}</dd>
              </div>
              <div>
                <dt>Drops registrados</dt>
                <dd>{report.cashDrops?.length ?? 0}</dd>
              </div>
            </dl>

            {(report.cashDrops?.length ?? 0) > 0 && (
              <ul className={styles.dropList}>
                {report.cashDrops?.map((drop, index) => (
                  <li key={`${drop.at ?? 'drop'}-${index}`}>
                    <strong>{formatMxn(drop.amount)}</strong>
                    <span>
                      {drop.note || 'Retiro'} · {formatDateTimeMx(drop.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!closed && (
              <label className={styles.field}>
                <span>Nota de auditoría (opcional, se incluye en export)</span>
                <textarea
                  rows={3}
                  value={auditNote}
                  onChange={(e) => setAuditNote(e.target.value)}
                  placeholder="Observaciones del arqueo, testigos, incidencias…"
                />
              </label>
            )}
          </section>

          {!closed && (
            <section className={styles.panel} aria-labelledby="handoff-title">
              <header className={styles.panelHead}>
                <div>
                  <p className={styles.eyebrow}>Relevo (opcional)</p>
                  <h2 id="handoff-title">Entrega de turno</h2>
                </div>
              </header>
              <p className={styles.handoffHint}>
                Usa esta sección solo para relevo de cajero. Cierra el turno actual y abre uno nuevo con el
                contado como fondo. El cierre definitivo está en la sección inferior.
              </p>
              <div className={styles.formStack}>
                <label className={styles.field} htmlFor={handoffInputId}>
                  <span>ID / email del cajero entrante</span>
                  <input
                    id={handoffInputId}
                    value={handoffCashier}
                    onChange={(e) => setHandoffCashier(e.target.value)}
                    placeholder="cajero-siguiente"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={loading || syncBlocked}
                  onClick={() => void doHandoff()}
                >
                  Entregar turno
                </button>
              </div>
            </section>
          )}

          <section
            ref={closeSectionRef}
            className={styles.closePanel}
            aria-labelledby="close-title"
            tabIndex={-1}
          >
            <header className={styles.panelHead}>
              <div>
                <p className={styles.eyebrow}>Cierre seguro</p>
                <h2 id="close-title">Confirmar corte</h2>
              </div>
              <span className={styles.hotkeyHint}>
                <kbd>F12</kbd> cerrar
              </span>
            </header>

            {closed ? (
              <p className={styles.done}>
                {handoffDone ? 'Turno entregado.' : 'Turno cerrado.'}{' '}
                <Link href={handoffDone ? '/' : '/login'}>
                  {handoffDone ? 'Volver al inicio' : 'Abrir nuevo turno'}
                </Link>
              </p>
            ) : (
              <>
                {!confirmingClose ? (
                  <button
                    type="button"
                    className={styles.closeBtn}
                    disabled={loading || syncBlocked}
                    onClick={() => {
                      setConfirmingClose(true);
                      window.setTimeout(() => confirmInputRef.current?.focus(), 0);
                    }}
                  >
                    Preparar cierre de turno
                  </button>
                ) : (
                  <div className={styles.confirmBox}>
                    <p>
                      Esta acción cierra la sesión de caja. Escribe{' '}
                      <strong>{CLOSE_CONFIRM_PHRASE}</strong> para habilitar el botón.
                      {pinRequired ? ' También se requiere PIN de gerente por la diferencia.' : ''}
                    </p>
                    <label className={styles.field} htmlFor={confirmInputId}>
                      <span>Confirmación</span>
                      <input
                        ref={confirmInputRef}
                        id={confirmInputId}
                        value={closePhrase}
                        onChange={(e) => setClosePhrase(e.target.value)}
                        placeholder={CLOSE_CONFIRM_PHRASE}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <div className={styles.confirmActions}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => {
                          setConfirmingClose(false);
                          setClosePhrase('');
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className={styles.closeBtn}
                        disabled={!canClose}
                        onClick={() => void closeShift()}
                      >
                        {loading ? 'Cerrando…' : 'Cerrar turno'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      <div className={styles.actions}>
        {exportSource && (
          <>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => printCorte(exportSource)}
            >
              Imprimir corte
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => exportCorte(exportSource)}
            >
              Exportar CSV
            </button>
          </>
        )}
      </div>
    </PosShell>
  );
}
