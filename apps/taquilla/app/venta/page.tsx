'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { enqueueSale } from '@/lib/offline-queue';
import {
  ensurePosSession,
  fetchReceipt,
  getCashierId,
  posCheckout,
  printReceipt,
  setCashierId,
  type OfflinePosPayload,
  type PosReceipt,
} from '@/lib/pos';
import styles from './venta.module.scss';

function VentaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const eventId = params.get('eventId') ?? '';
  const offerFromUrl = params.get('offerId') ?? '';
  const priceFromUrl = params.get('unitPrice');
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [loading, setLoading] = useState(false);
  const [offerId, setOfferId] = useState(offerFromUrl);
  const [unitPrice, setUnitPrice] = useState(() => {
    const p = priceFromUrl ? Number(priceFromUrl) : 0;
    return Number.isFinite(p) && p > 0 ? p : 0;
  });
  const [cashierId, setCashierIdState] = useState(getCashierId());
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

  useEffect(() => {
    if (offerFromUrl) setOfferId(offerFromUrl);
    if (priceFromUrl) {
      const p = Number(priceFromUrl);
      if (Number.isFinite(p) && p > 0) setUnitPrice(p);
    }
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [offerFromUrl, priceFromUrl]);

  useEffect(() => {
    if (unitPrice > 0 || !eventId || !offerId) return;
    fetch(`${API}/discovery/events`)
      .then((r) => (r.ok ? r.json() : []))
      .then((events: { id: string; offers?: { id: string; basePrice: string }[] }[]) => {
        const ev = events.find((e) => e.id === eventId);
        const offer = ev?.offers?.find((o) => o.id === offerId);
        if (offer) setUnitPrice(Number(offer.basePrice));
      })
      .catch(() => {});
  }, [API, eventId, offerId, unitPrice]);

  // Hotkeys
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F8') {
        e.preventDefault();
        setMethod('CASH');
        sell();
      } else if (e.key === 'F9') {
        e.preventDefault();
        setMethod('CARD');
        sell();
      } else if (e.key === '+') {
        setQty((q) => q + 1);
      } else if (e.key === '-') {
        setQty((q) => Math.max(1, q - 1));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sell() {
    if (!eventId) {
      showToast('Selecciona un evento primero');
      router.push('/eventos');
      return;
    }
    if (!offerId) {
      showToast('Evento sin ofertas disponibles');
      return;
    }

    setCashierId(cashierId);
    setLoading(true);
    setReceipt(null);

    try {
      const orgId = localStorage.getItem('boletera_org') ?? 'org-demo';
      const { terminalId, sessionId } = await ensurePosSession(orgId, cashierId);
      const result = await posCheckout({
        terminalId,
        sessionId,
        eventId,
        offerId,
        quantity: qty,
        paymentMethod: method,
        cashierId,
      });
      const rec = await fetchReceipt(result.orderId, terminalId);
      setReceipt(rec);
      printReceipt(rec);
    } catch {
      const orgId = localStorage.getItem('boletera_org') ?? 'org-demo';
      try {
        const { terminalId, sessionId } = await ensurePosSession(orgId, cashierId);
        const payload: OfflinePosPayload = {
          type: 'pos',
          terminalId,
          sessionId,
          checkoutData: { eventId, offerId, quantity: qty, paymentMethod: method, cashierId },
        };
        await enqueueSale(payload);
        showToast('Sin conexión — venta en cola offline');
        router.push('/');
      } catch {
        showToast('No se pudo registrar la venta');
      }
    } finally {
      setLoading(false);
    }
  }

  const subtotal = qty * unitPrice;

  return (
    <main className={styles.page}>
      <div className={styles.bg} aria-hidden="true" />
      {toast && (
        <p role="status" style={{ margin: '0.75rem 1rem', padding: '0.75rem 1rem', background: '#fff7ed', color: '#9a3412', borderRadius: 8 }}>
          {toast}
        </p>
      )}

      <header className={styles.header}>
        <Link href="/eventos" className={styles.back}>
          ← Eventos
        </Link>
        <div className={styles.headerCenter}>
          <p className={styles.eyebrow}>Punto de venta</p>
          <h1>Venta rápida</h1>
        </div>
        <span className={online ? styles.netOn : styles.netOff}>
          <span className={styles.dot} />
          {online ? 'En línea' : 'Offline'}
        </span>
      </header>

      {!eventId && (
        <div className={styles.warn}>
          Sin evento seleccionado. <Link href="/eventos">Elegir evento →</Link>
        </div>
      )}
      {eventId && (
        <div className={styles.eventBar}>
          <span>EVENTO</span>
          <strong>{eventId.slice(0, 8).toUpperCase()}…</strong>
          <Link href="/eventos" className={styles.changeBtn}>
            Cambiar
          </Link>
        </div>
      )}

      {/* Cajero */}
      <div className={styles.cashierBar}>
        <label htmlFor="cashier">
          <small>Cajero</small>
          <input
            id="cashier"
            value={cashierId}
            onChange={(e) => setCashierIdState(e.target.value)}
            placeholder="cashier-001"
          />
        </label>
      </div>

      {/* Cantidad */}
      <section className={styles.section}>
        <header>
          <h2>Cantidad de boletos</h2>
          <small>+ / − en teclado</small>
        </header>
        <div className={styles.qtyRow}>
          <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Disminuir">
            −
          </button>
          <div className={styles.qtyDisplay}>
            <strong>{qty}</strong>
            <span>boleto{qty === 1 ? '' : 's'}</span>
          </div>
          <button type="button" onClick={() => setQty(qty + 1)} aria-label="Aumentar">
            +
          </button>
        </div>
        <div className={styles.quickQty}>
          {[1, 2, 4, 6, 10].map((n) => (
            <button
              key={n}
              type="button"
              className={qty === n ? styles.quickActive : ''}
              onClick={() => setQty(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* Métodos */}
      <section className={styles.section}>
        <header>
          <h2>Método de pago</h2>
          <small>F8 efectivo · F9 tarjeta</small>
        </header>
        <div className={styles.methods}>
          {(
            [
              { id: 'CASH', label: 'Efectivo', icon: 'E', hot: 'F8' },
              { id: 'CARD', label: 'Tarjeta', icon: 'T', hot: 'F9' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              className={method === m.id ? styles.methodActive : styles.method}
              onClick={() => setMethod(m.id)}
            >
              <span className={styles.methodIcon} aria-hidden>
                {m.icon}
              </span>
              <span className={styles.methodLabel}>{m.label}</span>
              <kbd>{m.hot}</kbd>
            </button>
          ))}
        </div>
      </section>

      {/* Resumen + cobrar */}
      <section className={styles.summary}>
        <div className={styles.summaryLines}>
          <div>
            <span>Boletos</span>
            <strong>× {qty}</strong>
          </div>
          <div>
            <span>Subtotal</span>
            <strong>${subtotal.toLocaleString('es-MX')}</strong>
          </div>
          <div className={styles.total}>
            <span>TOTAL</span>
            <strong>${subtotal.toLocaleString('es-MX')}</strong>
          </div>
        </div>

        <button
          type="button"
          className={styles.cobrar}
          disabled={loading || !eventId || !offerId}
          onClick={sell}
        >
          {loading ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Procesando…
            </>
          ) : (
            <>
              <span>Cobrar {method === 'CASH' ? 'efectivo' : 'tarjeta'}</span>
            </>
          )}
        </button>
      </section>

      {receipt && (
        <section className={styles.receipt}>
          <header>
            <span className={styles.checkIcon}>✓</span>
            <div>
              <strong>Venta exitosa</strong>
              <small>Recibo #{receipt.receiptNumber}</small>
            </div>
          </header>
          <p className={styles.receiptTotal}>
            ${receipt.total.toFixed(2)} · {receipt.quantity} boleto(s)
          </p>
          <div className={styles.receiptActions}>
            <button type="button" onClick={() => printReceipt(receipt)}>
              ↻ Reimprimir
            </button>
            <button type="button" onClick={() => router.push('/')}>
              ↩ Volver al inicio
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default function VentaPage() {
  return (
    <Suspense>
      <VentaForm />
    </Suspense>
  );
}
