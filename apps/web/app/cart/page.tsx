'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { secondsUntil, useCartStore } from '@/lib/cart-store';
import styles from './cart.module.scss';

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const router = useRouter();

  return (
    <main className={styles.page}>
      <SiteHeader />
      <h1>Carrito</h1>
      {!items.length && <p>Tu carrito está vacío. <Link href="/events">Explorar eventos</Link></p>}
      <ul>
        {items.map((item, i) => {
          const sec = secondsUntil(item.expiresAt);
          const expired = sec <= 0;
          return (
            <li key={`${item.eventId}-${i}`} className={expired ? styles.expired : ''}>
              <h2>{item.eventTitle}</h2>
              <p>{item.seatCount} asiento(s)</p>
              <p className={styles.timer}>
                {expired ? 'Reserva expirada' : `Tiempo restante: ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`}
              </p>
              <div className={styles.actions}>
                {!expired && (
                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams({
                        eventId: item.eventId,
                        holdIds: item.holdIds.join(','),
                        offerId: item.offerId,
                      });
                      router.push(`/checkout?${params}`);
                    }}
                  >
                    Pagar ahora
                  </button>
                )}
                <button type="button" onClick={() => removeAt(i)}>
                  Quitar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
