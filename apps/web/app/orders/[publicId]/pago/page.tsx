'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { API_BASE, errorMessage } from '@/lib/api';
import { moneyExact, paymentMethodLabel } from '@/lib/format';
import { SiteHeader } from '@/components/SiteHeader';
import { SimulateDemoPaymentButton } from '@/components/SimulateDemoPaymentButton';
import { PurchaseSteps } from '@/components/storefront/PurchaseSteps';
import {
  TrustRow,
  TRUST_OFFICIAL,
  TRUST_QR,
  trustPayment,
} from '@/components/storefront/TrustRow';
import styles from '../order.module.scss';

type OrderMeta = {
  id?: string;
  status?: string;
  totalAmount?: string;
  currency?: string;
  paymentMethod?: string | null;
  event?: { slug?: string; title?: string } | null;
  pendingPayment?: {
    reference?: string | null;
    metadata?: {
      clabe?: string;
      concept?: string;
      reference?: string;
      demo?: boolean;
    } | null;
  } | null;
};

type PollState = 'idle' | 'polling' | 'confirmed' | 'error';

function copyText(value: string) {
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value).catch(() => undefined);
}

function PagoContent() {
  const { publicId } = useParams<{ publicId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const result = search.get('result');
  const method = (search.get('method') ?? 'CARD').toUpperCase();
  const ref = search.get('ref') ?? '';
  const clabeParam = search.get('clabe') ?? '';
  const conceptParam = search.get('concept') ?? '';
  const demo = search.get('demo') === '1';
  const [confirming, setConfirming] = useState(false);
  const [pollState, setPollState] = useState<PollState>('idle');
  const [error, setError] = useState('');
  const [gatewayDemo, setGatewayDemo] = useState(demo);
  const [orderMeta, setOrderMeta] = useState<OrderMeta | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const confirmInFlight = useRef(false);
  const [confirmNonce, setConfirmNonce] = useState(0);

  const loadOrder = useCallback(
    async (signal?: AbortSignal) => {
      if (!publicId) return null;
      const res = await fetch(`${API_BASE}/orders/${publicId}`, {
        cache: 'no-store',
        signal,
      });
      if (!res.ok) throw new Error('Orden no encontrada');
      const data = (await res.json()) as OrderMeta;
      setOrderMeta(data);
      return data;
    },
    [publicId],
  );

  const confirmDemoPayment = useCallback(async () => {
    if (!publicId || confirmInFlight.current) return;
    confirmInFlight.current = true;
    setConfirming(true);
    setPollState('polling');
    setError('');
    try {
      const order = await loadOrder();
      if (!order) throw new Error('Orden no encontrada');

      if (order.status === 'COMPLETED') {
        setPollState('confirmed');
        router.replace(`/orders/${publicId}`);
        return;
      }

      const res = await fetch(`${API_BASE}/payments/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `banorte-demo-${publicId}`,
        },
        body: JSON.stringify({
          orderId: order.id,
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
            : 'No se pudo confirmar el pago demo';
        throw new Error(message);
      }

      setPollState('confirmed');
      router.replace(`/orders/${publicId}`);
    } catch (e) {
      setPollState('error');
      setError(errorMessage(e, 'Error al confirmar pago'));
    } finally {
      confirmInFlight.current = false;
      setConfirming(false);
    }
  }, [loadOrder, publicId, router]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/payments/config`, { signal: controller.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { demo?: boolean } | null) => {
        if (cfg?.demo) setGatewayDemo(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!publicId) return;
    const controller = new AbortController();
    loadOrder(controller.signal)
      .then((order) => {
        if (order?.status === 'COMPLETED') {
          setPollState('confirmed');
          router.replace(`/orders/${publicId}`);
        }
      })
      .catch(() => {
        setError('No pudimos cargar la orden. Revisa el enlace o intenta más tarde.');
        setPollState('error');
      });
    return () => controller.abort();
  }, [publicId, loadOrder, router]);

  useEffect(() => {
    if (result !== 'ok' || !publicId) return;

    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    if (demo || gatewayDemo) {
      void confirmDemoPayment().then(() => {
        if (cancelled) return;
      });
      return () => {
        cancelled = true;
      };
    }

    setConfirming(true);
    setPollState('polling');
    setError('');
    poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/orders/${publicId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status === 'COMPLETED') {
          setPollState('confirmed');
          setConfirming(false);
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
  }, [result, publicId, demo, gatewayDemo, router, confirmDemoPayment, confirmNonce]);

  useEffect(() => {
    if ((method !== 'SPEI' && method !== 'OXXO') || !publicId) return;
    if (result === 'cancel') return;
    setPollState('polling');
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/orders/${publicId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status === 'COMPLETED') {
          setPollState('confirmed');
          router.replace(`/orders/${publicId}`);
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [method, publicId, router, result]);

  const meta = orderMeta?.pendingPayment?.metadata;
  const clabe = clabeParam || meta?.clabe || '';
  const concept = conceptParam || meta?.concept || meta?.reference || ref;
  const reference = ref || meta?.reference || orderMeta?.pendingPayment?.reference || publicId;
  const isDemoFlow = demo || gatewayDemo || meta?.demo === true;
  const eventHref = orderMeta?.event?.slug ? `/events/${orderMeta.event.slug}` : '/events';
  const completed = orderMeta?.status === 'COMPLETED';
  const amountLabel =
    orderMeta?.totalAmount != null
      ? moneyExact(orderMeta.totalAmount, orderMeta.currency || 'MXN')
      : null;

  const trustItems = useMemo(
    () => [TRUST_OFFICIAL, TRUST_QR, trustPayment(isDemoFlow)],
    [isDemoFlow],
  );

  const timeline = useMemo(
    () => [
      { id: 'order', label: 'Orden creada', done: true, current: false },
      {
        id: 'pay',
        label:
          result === 'cancel'
            ? 'Pago cancelado'
            : completed || pollState === 'confirmed'
              ? 'Pago confirmado'
              : method === 'CARD'
                ? result === 'ok'
                  ? 'Confirmando con Banorte'
                  : 'Pago pendiente'
                : `Pendiente ${paymentMethodLabel(method)}`,
        done: completed || pollState === 'confirmed',
        current: !completed && pollState !== 'confirmed' && result !== 'cancel',
      },
      {
        id: 'tickets',
        label: 'Entrega de boletos',
        done: completed,
        current: false,
      },
    ],
    [completed, method, pollState, result],
  );

  function handleCopy(label: string, value: string) {
    copyText(value);
    setCopied(label);
    window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1800);
  }

  function retryConfirm() {
    if (confirmInFlight.current) return;
    setError('');
    setPollState('idle');
    if (isDemoFlow) {
      void confirmDemoPayment();
    } else {
      setConfirmNonce((n) => n + 1);
    }
  }

  if (result === 'cancel') {
    return (
      <div className={styles.shell}>
        <SiteHeader theme="dark" />
        <main className={styles.page}>
          <PurchaseSteps current="checkout" />
          <header className={styles.hero}>
            <p className={styles.pending}>
              Pago cancelado{isDemoFlow ? ' (demo)' : ' en Banorte'}
            </p>
            <h1>No se completó el cargo</h1>
            <p className={styles.sub}>
              Orden <code>{publicId}</code>. No se generó un cargo confirmado.
            </p>
          </header>
          <section className={styles.timeline} aria-label="Estado de la compra">
            <ol>
              {timeline.map((step) => (
                <li
                  key={step.id}
                  className={
                    step.done ? styles.tlDone : step.current ? styles.tlCurrent : styles.tlTodo
                  }
                >
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
            <p className={styles.nextStep} role="status">
              <strong>Siguiente paso:</strong> Reintenta el pago desde la orden o vuelve a elegir
              asientos si tu hold ya expiró. No se cobró nada.
            </p>
          </section>
          <div className={styles.actions}>
            <Link href={`/orders/${publicId}`} className={styles.link}>
              Ver estado de la orden
            </Link>
            <Link href={eventHref} className={styles.ghost}>
              Volver al evento
            </Link>
            <Link href="/ayuda" className={styles.ghost}>
              Ayuda
            </Link>
          </div>
          <div className={styles.trustWrap}>
            <TrustRow items={trustItems} label="Garantías de pago" />
          </div>
        </main>
      </div>
    );
  }

  if (method === 'SPEI' || method === 'OXXO') {
    return (
      <div className={styles.shell}>
        <SiteHeader theme="dark" />
        <main className={styles.page}>
          <PurchaseSteps current="checkout" />

          <header className={styles.hero}>
            <p className={styles.pending}>
              Pago pendiente · {paymentMethodLabel(method)}
            </p>
            <h1>Instrucciones de pago</h1>
            <p className={styles.sub}>
              Orden <code>{publicId}</code>
              {orderMeta?.event?.title ? ` · ${orderMeta.event.title}` : ''}
            </p>
          </header>

          <section className={styles.timeline} aria-label="Estado de la compra">
            <ol>
              {timeline.map((step) => (
                <li
                  key={step.id}
                  className={
                    step.done ? styles.tlDone : step.current ? styles.tlCurrent : styles.tlTodo
                  }
                >
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
            <p className={styles.nextStep} role="status">
              <strong>Siguiente paso:</strong>{' '}
              {isDemoFlow
                ? 'Usa el botón de simulación Banorte. No transfieras dinero real.'
                : method === 'SPEI'
                  ? 'Transfiere el monto exacto con la referencia indicada.'
                  : 'Paga en OXXO con la referencia y monto exactos.'}
            </p>
          </section>

          {isDemoFlow && (
            <p className={styles.pendingBanner} role="status">
              Modo demo: esta CLABE/referencia es de prueba. No transfieras dinero real.
            </p>
          )}

          {amountLabel && (
            <p className={styles.totalBanner}>
              Monto exacto: <strong>{amountLabel}</strong>
            </p>
          )}

          <p className={styles.statusLive} aria-live="polite">
            {pollState === 'polling'
              ? isDemoFlow
                ? 'Esperando simulación de acreditamiento…'
                : 'Actualizamos el estado automáticamente al acreditarse tu pago Banorte.'
              : pollState === 'confirmed'
                ? 'Pago confirmado. Redirigiendo a tus boletos…'
                : 'Cuando el pago se confirme, te llevamos a tus boletos.'}
          </p>

          {method === 'SPEI' && (
            <section className={styles.instructions} aria-label="Datos SPEI">
              <p>
                {isDemoFlow
                  ? 'Datos SPEI de prueba (no uses en banca real):'
                  : 'Realiza tu transferencia SPEI a la cuenta Banorte del promotor:'}
              </p>
              {clabe && (
                <p>
                  <strong>CLABE:</strong> <code>{clabe}</code>{' '}
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={() => handleCopy('clabe', clabe)}
                  >
                    {copied === 'clabe' ? 'Copiado' : 'Copiar'}
                  </button>
                </p>
              )}
              <p>
                <strong>Referencia / concepto:</strong> <code>{concept || reference}</code>{' '}
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => handleCopy('concept', concept || reference)}
                >
                  {copied === 'concept' ? 'Copiado' : 'Copiar'}
                </button>
              </p>
              {!isDemoFlow && (
                <p>
                  Usa exactamente esa referencia en el concepto. Recibirás tus boletos al
                  acreditarse.
                </p>
              )}
            </section>
          )}

          {method === 'OXXO' && (
            <section className={styles.instructions} aria-label="Datos OXXO">
              <p>{isDemoFlow ? 'Referencia OXXO de prueba:' : 'Paga en OXXO con esta referencia:'}</p>
              <p>
                <strong>Referencia:</strong> <code>{reference}</code>{' '}
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => handleCopy('ref', reference)}
                >
                  {copied === 'ref' ? 'Copiado' : 'Copiar'}
                </button>
              </p>
              {amountLabel && (
                <p>
                  Monto exacto: <strong>{amountLabel}</strong>
                </p>
              )}
            </section>
          )}

          {isDemoFlow && publicId ? (
            <SimulateDemoPaymentButton orderId={orderMeta?.id} publicId={publicId} />
          ) : null}

          {error && (
            <div className={styles.errorBox} role="alert">
              <p>{error}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setError('');
                    void loadOrder().catch(() =>
                      setError('No pudimos recargar la orden. Intenta de nuevo.'),
                    );
                  }}
                >
                  Reintentar carga
                </button>
                <Link href={`/orders/${publicId}`} className={styles.textLink}>
                  Ver orden
                </Link>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <Link href={`/orders/${publicId}`} className={styles.link}>
              Ver estado de la orden
            </Link>
            <Link href={eventHref} className={styles.ghost}>
              Volver al evento
            </Link>
            <Link href="/ayuda" className={styles.ghost}>
              Ayuda
            </Link>
          </div>

          <div className={styles.trustWrap}>
            <TrustRow items={trustItems} label="Garantías de pago" />
          </div>
        </main>
      </div>
    );
  }

  const waitingBank = result === 'ok' && (confirming || pollState === 'polling');
  const confirmFailed = pollState === 'error' || Boolean(error);
  const needsRecovery = result !== 'ok' && !completed && pollState !== 'confirmed';

  return (
    <div className={styles.shell}>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <PurchaseSteps current="checkout" />

        <header className={styles.hero}>
          <p className={styles.pending}>
            {isDemoFlow ? 'Confirmación demo' : 'Confirmación Banorte'}
          </p>
          <h1>
            {needsRecovery
              ? 'Continúa tu pago'
              : confirmFailed
                ? 'No se confirmó el pago'
                : isDemoFlow
                  ? 'Confirmando pago demo'
                  : 'Confirmando pago Banorte'}
          </h1>
          <p className={styles.sub}>
            Orden <code>{publicId}</code>
          </p>
        </header>

        <section className={styles.timeline} aria-label="Estado de la compra">
          <ol>
            {timeline.map((step) => (
              <li
                key={step.id}
                className={
                  step.done ? styles.tlDone : step.current ? styles.tlCurrent : styles.tlTodo
                }
              >
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className={styles.nextStep} role="status">
            <strong>Siguiente paso:</strong>{' '}
            {confirmFailed
              ? 'Revisa el error y reintenta. No pedimos datos de tarjeta aquí ni simulamos un éxito falso.'
              : waitingBank
                ? isDemoFlow
                  ? 'Estamos simulando la confirmación Banorte…'
                  : 'Esperando IPN Banorte. Mantén esta pantalla abierta.'
                : needsRecovery
                  ? 'Abre el estado de la orden para reintentar sin crear una compra nueva.'
                  : 'Cuando el banco confirme, te llevamos a tus boletos.'}
          </p>
        </section>

        {waitingBank && (
          <p className={styles.statusLive} aria-live="polite">
            {isDemoFlow
              ? 'Simulando confirmación…'
              : 'Esperando confirmación del banco (IPN Banorte)…'}
          </p>
        )}

        {needsRecovery && !confirmFailed && (
          <section className={styles.section}>
            <h2>Recuperar pago</h2>
            <p className={styles.mutedBlock}>
              {isDemoFlow
                ? 'Si saliste antes de confirmar el demo, vuelve a la orden e inicia de nuevo. No se crea una orden duplicada.'
                : 'Si cerraste Banorte o la red falló, puedes reintentar desde la orden. El banco evita cargos duplicados para la misma compra.'}
            </p>
            <div className={styles.actions}>
              <Link href={`/orders/${publicId}`} className={styles.link}>
                Ver orden y reintentar
              </Link>
              <Link href={eventHref} className={styles.ghost}>
                Volver al evento
              </Link>
            </div>
          </section>
        )}

        {confirmFailed && (
          <div className={styles.errorBox} role="alert">
            <p>{error || 'No se pudo confirmar el pago.'}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.link} onClick={retryConfirm}>
                Reintentar confirmación
              </button>
              <Link href={`/orders/${publicId}`} className={styles.ghost}>
                Ver orden
              </Link>
              <Link href="/ayuda" className={styles.ghost}>
                Ayuda
              </Link>
            </div>
          </div>
        )}

        {pollState === 'confirmed' && (
          <p className={styles.statusLive} aria-live="polite">
            Pago confirmado. Redirigiendo a tus boletos…
          </p>
        )}

        <div className={styles.actions}>
          <Link href={`/orders/${publicId}`} className={styles.ghost}>
            Ver estado de la orden
          </Link>
          <Link href="/ayuda" className={styles.ghost}>
            Ayuda
          </Link>
        </div>

        <div className={styles.trustWrap}>
          <TrustRow items={trustItems} label="Garantías de pago" />
        </div>
      </main>
    </div>
  );
}

export default function PagoPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.shell}>
          <SiteHeader theme="dark" />
          <main className={styles.page}>
            <PurchaseSteps current="checkout" />
            <p className={styles.statusLive} role="status">
              Cargando pago…
            </p>
          </main>
        </div>
      }
    >
      <PagoContent />
    </Suspense>
  );
}
