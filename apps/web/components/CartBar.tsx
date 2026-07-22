'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { secondsUntil, useCartStore } from '@/lib/cart-store';
import styles from './CartBar.module.scss';

export function CartBar() {
  const items = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!items.length) return null;
  void tick;

  return (
    <aside className={styles.bar}>
      <Link href="/cart" className={styles.link}>
        Carrito ({items.length})
      </Link>
      <ul>
        {items.map((item, i) => {
          const sec = secondsUntil(item.expiresAt);
          return (
            <li key={`${item.eventId}-${i}`}>
              <span>{item.eventTitle}</span>
              <span className={sec < 120 ? styles.urgent : ''}>
                {sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'Expirado'}
              </span>
              <button type="button" onClick={() => removeAt(i)} aria-label="Quitar">
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
