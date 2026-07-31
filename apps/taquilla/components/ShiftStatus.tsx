'use client';

import Link from 'next/link';
import { formatMxn } from '@/lib/pos/money';
import styles from './ShiftStatus.module.scss';

export type SummaryStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ShiftStatusProps = {
  sessionOpen: boolean;
  cashierName: string;
  terminalLabel: string;
  terminalId: string | null;
  sessionId: string | null;
  openingCash: number;
  expectedCash: number | null;
  dropsTotal: number | null;
  startTime: string | null;
  online: boolean;
  pendingCount: number;
  failedCount: number;
  summaryStatus: SummaryStatus;
  onRefresh: () => void;
};

function shortId(id: string | null): string {
  if (!id) return 'Sin asignar';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function formatStart(startTime: string | null): string {
  if (!startTime) return 'Sin registro';
  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) return 'Sin registro';
  return parsed.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function elapsedSince(startTime: string | null): string | null {
  if (!startTime) return null;
  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) return null;
  const minutes = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min en turno` : `${minutes} min en turno`;
}

export function ShiftStatus({
  sessionOpen,
  cashierName,
  terminalLabel,
  terminalId,
  sessionId,
  openingCash,
  expectedCash,
  dropsTotal,
  startTime,
  online,
  pendingCount,
  failedCount,
  summaryStatus,
  onRefresh,
}: ShiftStatusProps) {
  const elapsed = elapsedSince(startTime);
  const syncLabel = failedCount
    ? `${failedCount} con error`
    : pendingCount
      ? `${pendingCount} en cola`
      : 'Al día';
  const syncTone = failedCount ? styles.bad : pendingCount ? styles.warn : styles.ok;

  return (
    <section className={styles.shift} aria-label="Estado del turno">
      <header className={styles.head}>
        <div className={styles.identity}>
          <span className={sessionOpen ? styles.pillOpen : styles.pillClosed}>
            <span className={styles.dot} aria-hidden="true" />
            {sessionOpen ? 'Turno abierto' : 'Turno cerrado'}
          </span>
          <h1>{cashierName || 'Cajero sin identificar'}</h1>
          <p>
            {terminalLabel} · {elapsed ?? (sessionOpen ? 'Turno en curso' : 'Abre turno para vender')}
          </p>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.ghostBtn} onClick={onRefresh}>
            {summaryStatus === 'loading' ? 'Actualizando…' : 'Actualizar turno'}
          </button>
          {sessionOpen && (
            <Link href="/corte" className={styles.primaryBtn}>
              Corte de caja
            </Link>
          )}
        </div>
      </header>

      {!sessionOpen && (
        <p className={styles.notice} role="status">
          No hay turno abierto en esta terminal. Abre turno con fondo de caja desde el acceso de cajero
          antes de cobrar; sin sesión no hay conciliación ni corte.
        </p>
      )}

      <dl className={styles.grid}>
        <div>
          <dt>Cajero</dt>
          <dd>{cashierName || '—'}</dd>
        </div>
        <div>
          <dt>Terminal</dt>
          <dd>
            {terminalLabel}
            <small>{shortId(terminalId)}</small>
          </dd>
        </div>
        <div>
          <dt>Sesión</dt>
          <dd>
            {sessionOpen ? 'Activa' : 'Sin sesión'}
            <small>{shortId(sessionId)}</small>
          </dd>
        </div>
        <div>
          <dt>Inicio de turno</dt>
          <dd>{formatStart(startTime)}</dd>
        </div>
        <div>
          <dt>Fondo de caja</dt>
          <dd>{formatMxn(openingCash)}</dd>
        </div>
        <div>
          <dt>Efectivo esperado</dt>
          <dd>
            {summaryStatus === 'error'
              ? 'No disponible'
              : expectedCash === null
                ? summaryStatus === 'loading'
                  ? 'Calculando…'
                  : '—'
                : formatMxn(expectedCash)}
            {dropsTotal !== null && dropsTotal > 0 && <small>Retiros {formatMxn(dropsTotal)}</small>}
          </dd>
        </div>
        <div>
          <dt>Red</dt>
          <dd className={online ? styles.ok : styles.bad}>{online ? 'Conectada' : 'Sin conexión'}</dd>
        </div>
        <div>
          <dt>Sincronización</dt>
          <dd className={syncTone}>{syncLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
