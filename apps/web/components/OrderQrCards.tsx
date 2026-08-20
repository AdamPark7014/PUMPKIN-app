'use client';

import { useEffect, useState } from 'react';
import { API_BASE, errorMessage } from '@/lib/api';
import type { OrderQrCodes } from '@/lib/storefront-types';
import styles from './OrderQrCards.module.scss';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

function seatLabel(ticket: OrderQrCodes['tickets'][number]): string | null {
  const parts = [
    ticket.section,
    ticket.row ? `Fila ${ticket.row}` : null,
    ticket.seatNumber ? `Asiento ${ticket.seatNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function OrderQrCards({ publicId }: { publicId: string }) {
  const [data, setData] = useState<OrderQrCodes | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!publicId) return;
    const controller = new AbortController();
    setState('loading');
    setError('');

    fetch(`${API_BASE}/orders/${publicId}/qrcodes`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'Los QR aún no están disponibles para esta orden.'
              : 'No pudimos cargar los códigos QR.',
          );
        }
        return (await res.json()) as OrderQrCodes;
      })
      .then((payload) => {
        setData(payload);
        setState(payload.tickets.length > 0 ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(errorMessage(err, 'No pudimos cargar los códigos QR.'));
        setState('error');
      });

    return () => controller.abort();
  }, [publicId]);

  if (state === 'loading') {
    return (
      <section className={styles.section} aria-busy="true" aria-live="polite">
        <h2>Códigos QR de acceso</h2>
        <p className={styles.hint}>Cargando tus códigos seguros…</p>
        <ul className={styles.grid} aria-hidden="true">
          {[0, 1].map((i) => (
            <li key={i}>
              <div className={styles.skeleton} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className={styles.section} aria-live="polite">
        <h2>Códigos QR de acceso</h2>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <p className={styles.hint}>
          Puedes descargar el PDF de la orden o volver a abrir esta página en unos segundos.
        </p>
      </section>
    );
  }

  if (state === 'empty' || !data?.tickets.length) {
    return (
      <section className={styles.section} aria-live="polite">
        <h2>Códigos QR de acceso</h2>
        <p className={styles.hint}>
          Aún no hay códigos QR asociados. Si acabas de pagar, espera unos segundos y recarga.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2>Códigos QR de acceso</h2>
      <p className={styles.event}>{data.eventTitle}</p>
      <p className={styles.hint}>
        Localizador <code>{data.publicId}</code>. Presenta un QR por persona (papel, PDF o
        celular). El código <code>BLT-…</code> debajo también vale si el lector no toma el QR.
      </p>
      <ul className={styles.grid}>
        {data.tickets.map((ticket) => {
          const seat = seatLabel(ticket);
          const alt = seat
            ? `Código QR de acceso para boleto ${ticket.code}, ${seat}`
            : `Código QR de acceso para boleto ${ticket.code}`;
          return (
            <li key={ticket.id}>
              <article className={styles.card}>
                {ticket.qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ticket.qrDataUrl}
                    alt={alt}
                    width={180}
                    height={180}
                    decoding="async"
                  />
                ) : (
                  <div className={styles.missingQr} role="img" aria-label={alt}>
                    QR pendiente
                  </div>
                )}
                <code>{ticket.code}</code>
                <span className={styles.seat}>{seat || 'Entrada general'}</span>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
