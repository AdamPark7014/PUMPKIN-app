'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SimulateDemoPaymentButton } from '@/components/SimulateDemoPaymentButton';
import styles from '../order.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

function PagoContent() {
  const { publicId } = useParams<{ publicId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const result = search.get('result');
  const method = search.get('method') ?? 'CARD';
  const ref = search.get('ref') ?? '';
  const clabeParam = search.get('clabe') ?? '';
  const conceptParam = search.get('concept') ?? '';
  const demo = search.get('demo') === '1';
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [gatewayDemo, setGatewayDemo] = useState(demo);
  const [orderMeta, setOrderMeta] = useState<{
    id?: string;
    totalAmount?: string;
    currency?: string;
    pendingPayment?: {
      reference?: string | null;
      metadata?: { clabe?: string; concept?: string; reference?: string; demo?: boolean } | null;
    } | null;
  } | null>(null);

  useEffect(() => {
    fetch(`${API}/payments/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean } | null) => {
        if (cfg?.demo) setGatewayDemo(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!publicId) return;
    fetch(`${API}/orders/${publicId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setOrderMeta)
      .catch(() => {});
  }, [publicId]);

  useEffect(() => {
    if (result !== 'ok' || !publicId) return;

    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    async function confirmDemo() {
      setConfirming(true);
      try {
        const orderRes = await fetch(`${API}/orders/${publicId}`);
        if (!orderRes.ok) throw new Error('Orden no encontrada');
        const order = await orderRes.json();

        if (order.status === 'COMPLETED') {
          if (!cancelled) router.replace(`/orders/${publicId}`);
          return;
        }

        const res = await fetch(`${API}/payments/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            externalId: `banorte_demo_${publicId}`,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'No se pudo confirmar el pago demo');
        }

        if (!cancelled) router.replace(`/orders/${publicId}`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error al confirmar pago');
      } finally {
        if (!cancelled) setConfirming(false);
      }
    }

    if (demo || gatewayDemo) {
      void confirmDemo();
      return () => {
        cancelled = true;
      };
    }

    setConfirming(true);
    setError('');
    poll = setInterval(async () => {
      try {
        const res = await fetch(`${API}/orders/${publicId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'COMPLETED') {
          router.replace(`/orders/${publicId}`);
        }
      } catch {
        /* keep polling */
      }
    }, 2500);

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [result, publicId, demo, gatewayDemo, router]);

  useEffect(() => {
    if ((method !== 'SPEI' && method !== 'OXXO') || !publicId) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API}/orders/${publicId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'COMPLETED') router.replace(`/orders/${publicId}`);
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [method, publicId, router]);

  const meta = orderMeta?.pendingPayment?.metadata;
  const clabe = clabeParam || meta?.clabe || '';
  const concept = conceptParam || meta?.concept || meta?.reference || ref;
  const reference = ref || meta?.reference || orderMeta?.pendingPayment?.reference || publicId;
  const isDemoFlow = demo || gatewayDemo || meta?.demo === true;

  if (result === 'cancel') {
    return (
      <main className={styles.page}>
        <p className={styles.pending}>Pago cancelado{isDemoFlow ? ' (demo)' : ' en Banorte'}.</p>
        <Link href="/events">Volver a eventos</Link>
      </main>
    );
  }

  if (method === 'SPEI' || method === 'OXXO') {
    return (
      <main className={styles.page}>
        <SiteHeader />
        <h1 className={styles.heading}>Instrucciones de pago</h1>
        <p className={styles.pending}>Orden {publicId} — pendiente de pago</p>
        {isDemoFlow && (
          <p className={styles.pending} role="status">
            Modo demo: esta CLABE/referencia es de prueba. No transfieras dinero real.
          </p>
        )}
        {orderMeta?.totalAmount && (
          <p className={styles.total}>
            Monto: ${orderMeta.totalAmount} {orderMeta.currency || 'MXN'}
          </p>
        )}
        <p className={styles.pending}>
          {isDemoFlow
            ? 'En demo, usa el botón para simular el acreditamiento Banorte.'
            : 'Actualizamos el estado automáticamente al acreditarse tu pago Banorte.'}
        </p>
        {method === 'SPEI' && (
          <section className={styles.instructions}>
            <p>
              {isDemoFlow
                ? 'Datos SPEI de prueba (no uses en banca real):'
                : 'Realiza tu transferencia SPEI a la cuenta Banorte del promotor:'}
            </p>
            {clabe && (
              <p>
                <strong>CLABE:</strong> <code>{clabe}</code>
              </p>
            )}
            <p>
              <strong>Referencia / concepto:</strong> <code>{concept || reference}</code>
            </p>
            {!isDemoFlow && (
              <p>Usa exactamente esa referencia en el concepto. Recibirás tus boletos al acreditarse.</p>
            )}
          </section>
        )}
        {method === 'OXXO' && (
          <section className={styles.instructions}>
            <p>{isDemoFlow ? 'Referencia OXXO de prueba:' : 'Paga en OXXO con esta referencia:'}</p>
            <p>
              <strong>Referencia:</strong> <code>{reference}</code>
            </p>
            {orderMeta?.totalAmount && (
              <p>
                Monto exacto: <strong>${orderMeta.totalAmount}</strong> {orderMeta.currency || 'MXN'}
              </p>
            )}
          </section>
        )}
        {isDemoFlow && publicId ? (
          <SimulateDemoPaymentButton orderId={orderMeta?.id} publicId={publicId} />
        ) : null}
        {error && <p className={styles.error}>{error}</p>}
        <Link href={`/orders/${publicId}`}>Ver estado de la orden</Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <SiteHeader />
      <h1 className={styles.heading}>
        {isDemoFlow ? 'Confirmando pago demo' : 'Confirmando pago Banorte'}
      </h1>
      {confirming && (
        <p>
          {isDemoFlow
            ? 'Simulando confirmación…'
            : 'Esperando confirmación del banco (IPN Banorte)…'}
        </p>
      )}
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
