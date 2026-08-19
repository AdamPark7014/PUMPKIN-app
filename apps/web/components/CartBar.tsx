'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { normalizeCartItem, secondsUntil, useCartStore } from '@/lib/cart-store';
import { countdown, countdownSpoken } from '@/lib/format';
import styles from './CartBar.module.scss';

export function CartBar() {
  const rawItems = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const items = rawItems.map(normalizeCartItem);
  if (!items.length) return null;
  void tick;

  const seats = items.reduce((s, i) => s + (i.seatCount || 0), 0);
  const soonest = Math.min(...items.map((i) => secondsUntil(i.expiresAt)));
  const urgent = soonest > 0 && soonest < 60;

  return (
    <aside className={styles.bar} aria-label="Carrito flotante">
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          soonest > 0
            ? `Carrito, ${seats} boletos, expira en ${countdownSpoken(soonest)}`
            : `Carrito, ${seats} boletos, reserva expirada`
        }
      >
        <span className={styles.badge}>{items.length}</span>
        <span className={styles.toggleText}>
          Carrito · {seats} boleto{seats === 1 ? '' : 's'}
        </span>
        <span
          className={`${styles.clock} ${urgent || soonest <= 0 ? styles.urgent : ''}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {soonest > 0 ? countdown(soonest) : 'Exp.'}
        </span>
      </button>

      {open && (
        <div className={styles.panel}>
          <ul>
            {items.map((item, i) => {
              const sec = secondsUntil(item.expiresAt);
              const lineUrgent = sec > 0 && sec < 60;
              return (
                <li key={`${item.eventId}-${i}`}>
                  <div>
                    <strong>{item.eventTitle}</strong>
                    <span
                      className={lineUrgent || sec <= 0 ? styles.urgent : undefined}
                      aria-live="polite"
                    >
                      {sec > 0 ? countdown(sec) : 'Expirado'}
                    </span>
                  </div>
                  <button type="button" onClick={() => removeAt(i)} aria-label="Quitar del carrito">
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/cart" className={styles.cta} onClick={() => setOpen(false)}>
            Ver carrito y pagar
          </Link>
        </div>
      )}
    </aside>
  );
}
