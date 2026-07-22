'use client';

import { useEffect, useState } from 'react';
import styles from './OrderQrCards.module.scss';

type QrData = {
  tickets: { id: string; code: string; qrPayload: string; qrDataUrl?: string }[];
  eventTitle: string;
};

export function OrderQrCards({ publicId }: { publicId: string }) {
  const [data, setData] = useState<QrData | null>(null);

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
    fetch(`${API}/orders/${publicId}/qrcodes`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, [publicId]);

  if (!data?.tickets.length) return null;

  return (
    <section className={styles.section}>
      <h2>Códigos QR de acceso</h2>
      <p className={styles.event}>{data.eventTitle}</p>
      <ul className={styles.grid}>
        {data.tickets.map((t) => (
          <li key={t.id}>
            <article className={styles.card}>
              {t.qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.qrDataUrl} alt={`QR ${t.code}`} width={180} height={180} />
              )}
              <code>{t.code}</code>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
