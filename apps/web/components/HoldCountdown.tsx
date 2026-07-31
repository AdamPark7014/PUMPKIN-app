'use client';

import { useEffect, useRef, useState } from 'react';
import { secondsUntil } from '@/lib/cart-store';
import { countdown, countdownSpoken } from '@/lib/format';
import styles from './HoldCountdown.module.scss';

export function HoldCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string | null | undefined;
  onExpire?: () => void;
}) {
  const [left, setLeft] = useState(() => (expiresAt ? secondsUntil(expiresAt) : 0));
  const expiredNotified = useRef(false);

  useEffect(() => {
    expiredNotified.current = false;
    if (!expiresAt) {
      setLeft(0);
      return;
    }
    const tick = () => {
      const n = secondsUntil(expiresAt);
      setLeft(n);
      if (n <= 0 && !expiredNotified.current) {
        expiredNotified.current = true;
        onExpire?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, onExpire]);

  if (!expiresAt) return null;

  const urgent = left > 0 && left < 60;
  const expired = left <= 0;

  return (
    <div
      className={`${styles.wrap} ${urgent ? styles.urgent : ''} ${expired ? styles.expired : ''}`}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={
        expired
          ? 'Reserva expirada'
          : `Asientos reservados, quedan ${countdownSpoken(left)}`
      }
    >
      <span className={styles.label}>{expired ? 'Reserva expirada' : 'Asientos reservados'}</span>
      <strong className={styles.time}>{countdown(left)}</strong>
      <span className={styles.hint}>
        {expired
          ? 'Vuelve al evento y selecciona de nuevo'
          : 'Completa el pago antes de que expire'}
      </span>
    </div>
  );
}
