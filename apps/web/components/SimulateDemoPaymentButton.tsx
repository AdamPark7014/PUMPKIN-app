'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './SimulateDemoPaymentButton.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

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

  async function resolveOrderId(): Promise<string> {
    if (orderId) return orderId;
    const res = await fetch(`${API}/orders/${publicId}`);
    if (!res.ok) throw new Error('Orden no encontrada');
    const order = (await res.json()) as { id?: string };
    if (!order.id) throw new Error('Orden sin id');
    return order.id;
  }

  async function simulate() {
    setBusy(true);
    setError('');
    try {
      const resolvedId = await resolveOrderId();
      const res = await fetch(`${API}/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: resolvedId,
          externalId: `banorte_demo_${publicId}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message || 'No se pudo simular el acreditamiento',
        );
      }
      router.replace(`/orders/${publicId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al simular pago');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => void simulate()}
        disabled={busy || !publicId}
      >
        {busy ? 'Simulando…' : 'Simular acreditamiento'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
