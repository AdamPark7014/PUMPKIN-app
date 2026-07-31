'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, errorMessage } from '@/lib/api';
import styles from './SimulateDemoPaymentButton.module.scss';

/**
 * Demo-only control: completes a pending SPEI/OXXO order via POST /payments/confirm.
 * Caller must only render when Banorte is in demo mode.
 */
export function SimulateDemoPaymentButton({
  orderId,
  publicId,
  className,
}: {
  orderId?: string;
  publicId: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function resolveOrderId(): Promise<string> {
    if (orderId) return orderId;
    const res = await fetch(`${API_BASE}/orders/${publicId}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Orden no encontrada');
    const order = (await res.json()) as { id?: string; status?: string };
    if (order.status === 'COMPLETED') {
      router.replace(`/orders/${publicId}`);
      router.refresh();
      throw new Error('ORDER_ALREADY_COMPLETED');
    }
    if (!order.id) throw new Error('Orden sin id');
    return order.id;
  }

  async function simulate() {
    if (!publicId || inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const resolvedId = await resolveOrderId();
      const res = await fetch(`${API_BASE}/payments/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `banorte-demo-${publicId}`,
        },
        body: JSON.stringify({
          orderId: resolvedId,
          externalId: `banorte_demo_${publicId}`,
        }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof body.message === 'string'
            ? body.message
            : 'No se pudo simular el acreditamiento';
        throw new Error(message);
      }
      router.replace(`/orders/${publicId}`);
      router.refresh();
    } catch (e) {
      if (e instanceof Error && e.message === 'ORDER_ALREADY_COMPLETED') return;
      setError(errorMessage(e, 'Error al simular pago'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <p className={styles.note} role="status">
        Modo demo — no transfieras dinero real. Este botón simula el acreditamiento Banorte.
      </p>
      <button
        type="button"
        className={styles.btn}
        onClick={() => void simulate()}
        disabled={busy || !publicId}
        aria-busy={busy}
      >
        {busy ? 'Simulando…' : 'Simular acreditamiento'}
      </button>
      {error ? (
        <p className={styles.error} role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
