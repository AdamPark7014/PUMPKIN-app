'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import styles from './PaymentReturnWatcher.module.scss';

type Props = {
  publicId: string;
  /** Estado de la orden al renderizar en servidor. */
  initialStatus: string;
  /** URL para retomar el pago si el comprador salió sin terminar. */
  resumeUrl?: string | null;
};

const POLL_MS = 2500;
const MAX_WAIT_MS = 90_000;

/**
 * Al volver de Mercado Pago la orden suele seguir PENDING unos segundos: el
 * webhook llega un poco después del redirect. Este componente sondea la orden
 * y refresca la página en cuanto cambia de estado, en vez de dejar al
 * comprador mirando un "pendiente" que ya no es cierto.
 */
export function PaymentReturnWatcher({ publicId, initialStatus, resumeUrl }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const returned = search.get('pago'); // ok | pendiente | error
  const [elapsed, setElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef<number | null>(null);

  const watching = initialStatus === 'PENDING' && (returned === 'ok' || returned === 'pendiente');

  useEffect(() => {
    if (!watching) return;
    started.current = Date.now();
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const order = await api<{ status: string }>(`/orders/${publicId}`, { cache: 'no-store' });
        if (order.status !== 'PENDING') {
          router.refresh();
          return;
        }
      } catch {
        // Un fallo de red aislado no debe romper la espera; se reintenta.
      }
      const ms = Date.now() - (started.current ?? Date.now());
      setElapsed(ms);
      if (ms >= MAX_WAIT_MS) {
        setTimedOut(true);
        return;
      }
      window.setTimeout(tick, POLL_MS);
    };

    const id = window.setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [watching, publicId, router]);

  if (!watching) {
    if (initialStatus === 'PENDING' && returned === 'error') {
      return (
        <section className={styles.box} role="alert">
          <h2>El pago no se completó</h2>
          <p>
            Mercado Pago no confirmó el cargo. No se hizo ningún cobro. Puedes intentarlo de nuevo
            con otro método sin perder tu reserva mientras siga vigente.
          </p>
          {resumeUrl && (
            <a href={resumeUrl} className={styles.cta}>
              Reintentar el pago
            </a>
          )}
        </section>
      );
    }
    return null;
  }

  if (timedOut) {
    return (
      <section className={styles.box} role="status">
        <h2>Seguimos esperando la confirmación</h2>
        <p>
          Tu pago puede tardar unos minutos en acreditarse (es normal con OXXO o transferencia).
          Te avisaremos por correo en cuanto entre. Puedes cerrar esta página sin problema.
        </p>
        <button type="button" className={styles.ghost} onClick={() => router.refresh()}>
          Volver a comprobar
        </button>
      </section>
    );
  }

  return (
    <section className={styles.box} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <div>
        <h2>Confirmando tu pago…</h2>
        <p>
          {returned === 'pendiente'
            ? 'Mercado Pago nos indica que el pago está en proceso. En cuanto se acredite, tus boletos aparecerán aquí.'
            : 'Estamos recibiendo la confirmación de Mercado Pago. Esto toma unos segundos.'}
          {elapsed > 20_000 && ' Un momento más…'}
        </p>
      </div>
    </section>
  );
}
