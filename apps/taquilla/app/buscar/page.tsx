'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import {
  exchangeOrder,
  fetchReceipt,
  getTerminalId,
  printReceipt,
  scanTicket,
  voidOrder,
} from '@/lib/pos';
import styles from './buscar.module.scss';

function money(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ScanResult = {
  ticketId?: string;
  status: string;
  eventId: string;
  eventTitle: string;
  seatInfo: string;
  valid: boolean;
  orderId?: string;
  publicId?: string;
  paymentMethod?: string;
  total?: number;
  tickets?: { code: string; status: string; seatInfo: string }[];
};

export default function BuscarPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const buffer = useRef('');
  const lastKey = useRef(0);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  // HID barcode wedge: rapid keystrokes ending in Enter
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F3') {
        e.preventDefault();
        document.getElementById('lookup-input')?.focus();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const now = Date.now();
      if (now - lastKey.current > 80) buffer.current = '';
      lastKey.current = now;
      if (e.key === 'Enter') {
        if (buffer.current.length >= 4) {
          setQuery(buffer.current);
          void runLookup(buffer.current);
        }
        buffer.current = '';
        return;
      }
      if (e.key.length === 1) buffer.current += e.key;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runLookup(code: string) {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await scanTicket(code);
      setResult(data as ScanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No encontrado');
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    await runLookup(code);
  }

  async function reprint() {
    if (!result?.orderId) {
      setToast('Sin orden asociada');
      return;
    }
    try {
      const rec = await fetchReceipt(result.orderId, getTerminalId() || 'terminal');
      const print = await printReceipt(rec, { reprint: true });
      setToast(print.ok ? 'Reimprimiendo…' : print.error ?? 'No se pudo reimprimir');
    } catch {
      setToast('No se pudo reimprimir');
    }
  }

  async function doVoid() {
    if (!result?.orderId) return;
    if (!managerPin) {
      setToast('Ingresa PIN de gerente');
      return;
    }
    if (!window.confirm('¿Anular esta venta del turno?')) return;
    setVoiding(true);
    try {
      await voidOrder(result.orderId, 'Anulación desde taquilla', managerPin);
      setToast('Venta anulada');
      setResult({ ...result, status: 'REFUNDED', valid: false });
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo anular');
    } finally {
      setVoiding(false);
    }
  }

  async function doExchange() {
    if (!result?.orderId) return;
    if (!managerPin) {
      setToast('PIN gerente requerido');
      return;
    }
    try {
      const qty = result.tickets?.length || 1;
      const data = await exchangeOrder({
        orderId: result.orderId,
        quantity: qty,
        paymentMethod: 'CASH',
        managerPin,
      });
      setToast(`Exchange OK · delta $${Number(data.delta || 0).toFixed(2)}`);
      setResult({ ...result, status: 'REFUNDED', valid: false });
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Exchange falló');
    }
  }

  return (
    <PosShell title="Buscar boleto u orden" eyebrow="Consulta" backHref="/">
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      <form onSubmit={(e) => void submit(e)} className={styles.search}>
        <input
          id="lookup-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Código u orden…"
        />
        <button type="submit" disabled={loading}>
          {loading ? '…' : 'Buscar'}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <section className={styles.result}>
          <header>
            <strong>{result.eventTitle}</strong>
            <span className={result.valid ? styles.ok : styles.bad}>{result.status}</span>
          </header>
          <dl>
            <div>
              <dt>Asiento</dt>
              <dd>{result.seatInfo}</dd>
            </div>
            {result.publicId && (
              <div>
                <dt>Orden</dt>
                <dd>{result.publicId}</dd>
              </div>
            )}
            {result.total != null && (
              <div>
                <dt>Total</dt>
                <dd>{money(result.total)}</dd>
              </div>
            )}
          </dl>

          <label className={styles.pinField}>
            <small>PIN gerente (void / exchange)</small>
            <input
              type="password"
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value)}
              placeholder="2468"
            />
          </label>

          <div className={styles.actions}>
            {result.orderId && (
              <button type="button" onClick={() => void reprint()}>
                Reimprimir
              </button>
            )}
            {result.orderId && result.status === 'COMPLETED' && (
              <>
                <button type="button" className={styles.danger} disabled={voiding} onClick={() => void doVoid()}>
                  {voiding ? 'Anulando…' : 'Anular'}
                </button>
                <button type="button" onClick={() => void doExchange()}>
                  Exchange
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </PosShell>
  );
}
