'use client';

import { useEffect, useState } from 'react';
import { secondsUntil } from '@/lib/cart-store';
import styles from './HoldCountdown.module.scss';

export function HoldCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string | null | undefined;
  onExpire?: () => void;
}) {
  const [left, setLeft] = useState(() => (expiresAt ? secondsUntil(expiresAt) : 0));

  useEffect(() => {
    if (!expiresAt) {
      setLeft(0);
      return;
    }
    const tick = () => {
      const n = secondsUntil(expiresAt);
      setLeft(n);
      if (n === 0) onExpire?.();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  if (!expiresAt) return null;

  const m = Math.floor(left / 60);
  const s = left % 60;
  const urgent = left > 0 && left <= 60;
  const expired = left === 0;

  return (
    <div
      className={`${styles.wrap} ${urgent ? styles.urgent : ''} ${expired ? styles.expired : ''}`}
      role="timer"
      aria-live="polite"
    >
      <span className={styles.label}>{expired ? 'Reserva expirada' : 'Asientos reservados'}</span>
      <strong className={styles.time}>
        {expired
          ? '00:00'
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`}
      </strong>
      <span className={styles.hint}>
        {expired ? 'Vuelve al evento y selecciona de nuevo' : 'Completa el pago antes de que expire'}
      </span>
    </div>
  );
}
