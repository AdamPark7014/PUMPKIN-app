'use client';

import { useEffect, useState } from 'react';
import styles from './EventCountdown.module.scss';

type Props = {
  /** ISO 8601 con offset. Ver `EVENT.startsAt`. */
  target: string;
  className?: string;
};

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

function remainingFrom(target: number, now: number): Remaining | null {
  const diff = target - now;
  if (diff <= 0) return null;
  const seconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

const UNITS: { key: keyof Remaining; label: string }[] = [
  { key: 'days', label: 'días' },
  { key: 'hours', label: 'horas' },
  { key: 'minutes', label: 'min' },
  { key: 'seconds', label: 'seg' },
];

export function EventCountdown({ target, className }: Props) {
  // `null` hasta montar: el servidor no puede conocer la hora del cliente, y
  // renderizar un valor distinto en cada lado rompe la hidratación.
  const [remaining, setRemaining] = useState<Remaining | null | 'pending'>('pending');

  useEffect(() => {
    const targetMs = new Date(target).getTime();
    if (Number.isNaN(targetMs)) {
      setRemaining(null);
      return;
    }

    const tick = () => setRemaining(remainingFrom(targetMs, Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (remaining === 'pending') {
    return <div className={`${styles.countdown} ${className ?? ''}`} aria-hidden="true" />;
  }

  if (remaining === null) {
    return (
      <p className={`${styles.live} ${className ?? ''}`}>
        <span className={styles.pulse} aria-hidden="true" />
        Las puertas ya están abiertas
      </p>
    );
  }

  return (
    <div
      className={`${styles.countdown} ${className ?? ''}`}
      role="timer"
      aria-live="off"
      aria-label={`Faltan ${remaining.days} días para la apertura`}
    >
      {UNITS.map(({ key, label }) => (
        <div key={key} className={styles.unit}>
          <span className={styles.value}>{String(remaining[key]).padStart(2, '0')}</span>
          <span className={styles.label}>{label}</span>
        </div>
      ))}
    </div>
  );
}
