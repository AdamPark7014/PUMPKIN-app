'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../order.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function PagoContent() {
  const { publicId } = useParams<{ publicId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const result = search.get('result');
  const method = search.get('method') ?? 'CARD';
  const ref = search.get('ref') ?? '';
  const demo = search.get('demo') === '1';
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (result !== 'ok' || !publicId) return;

    async function confirm() {
      setConfirming(true);
      try {
        const orderRes = await fetch(`${API}/orders/${publicId}`);
        if (!orderRes.ok) throw new Error('Orden no encontrada');
        const order = await orderRes.json();

        if (order.status === 'COMPLETED') {
          router.replace(`/orders/${publicId}`);
          return;
        }

        await fetch(`${API}/payments/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            externalId: `banorte_return_${publicId}`,
          }),
        });

        router.replace(`/orders/${publicId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al confirmar pago');
      } finally {
        setConfirming(false);
      }
    }

    if (demo || result === 'ok') {
      void confirm();
    }
  }, [result, publicId, demo, router]);

  useEffect(() => {
    if ((method !== 'SPEI' && method !== 'OXXO') || !publicId) return;
    const poll = setInterval(async () => {
      const res = await fetch(`${API}/orders/${publicId}/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'COMPLETED') router.replace(`/orders/${publicId}`);
    }, 5000);
    return () => clearInterval(poll);
  }, [method, publicId, router]);

  if (result === 'cancel') {
    return (
      <main className={styles.page}>
        <p className={styles.pending}>Pago cancelado en Banorte.</p>
        <Link href="/events">Volver a eventos</Link>
      </main>
    );
  }

  if (method === 'SPEI' || method === 'OXXO') {
    return (
      <main className={styles.page}>
        <SiteHeader />
        <h1>Instrucciones de pago</h1>
        <p className={styles.pending}>Orden {publicId} — pendiente de pago</p>
        <p className={styles.pending}>Actualizamos el estado automáticamente al acreditarse tu pago.</p>
        {method === 'SPEI' && (
          <section className={styles.instructions}>
            <p>Realiza tu transferencia SPEI a la cuenta Banorte del promotor:</p>
            <p>
              <strong>Referencia:</strong> <code>{ref}</code>
            </p>
            <p>Usa la referencia en el concepto. Recibirás tus boletos al acreditarse el pago.</p>
          </section>
        )}
        {method === 'OXXO' && (
          <section className={styles.instructions}>
            <p>Paga en OXXO con esta referencia:</p>
            <p>
              <strong>Referencia:</strong> <code>{ref}</code>
            </p>
          </section>
        )}
        <Link href={`/orders/${publicId}`}>Ver estado de la orden</Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <SiteHeader />
      <h1>Procesando pago Banorte</h1>
      {confirming && <p>Confirmando con el banco…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {!confirming && !error && <p>Redirigiendo…</p>}
    </main>
  );
}

export default function PagoPage() {
  return (
    <Suspense>
      <PagoContent />
    </Suspense>
  );
}
