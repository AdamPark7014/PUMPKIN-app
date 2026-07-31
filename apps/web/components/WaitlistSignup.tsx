'use client';

import { FormEvent, useState } from 'react';
import { API_BASE, errorMessage } from '@/lib/api';
import styles from '../app/events/[slug]/event.module.scss';

export function WaitlistSignup({
  eventId,
  eventTitle,
  offerId,
}: {
  eventId: string;
  eventTitle: string;
  offerId?: string;
}) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, email, offerId, quantity: 1 }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        throw new Error(
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : 'No pudimos registrarte',
        );
      }
      setDone(true);
    } catch (err) {
      setError(
        errorMessage(err, 'No pudimos registrarte. ¿Ya estás en la lista?'),
      );
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className={styles.waitlistDone} role="status">
        <strong>¡Listo!</strong>
        <p>Te avisaremos por correo cuando haya boletos para {eventTitle}.</p>
      </div>
    );
  }

  return (
    <div className={styles.waitlist}>
      <h3>Agotado — lista de espera</h3>
      <p>
        Déjanos tu email y serás de los primeros en enterarte cuando liberemos cupo.
      </p>
      <form onSubmit={onSubmit} className={styles.waitlistForm}>
        <label className={styles.waitlistField}>
          <span className={styles.srOnly}>Correo electrónico</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" className={styles.cta} disabled={loading}>
          {loading ? 'Enviando…' : 'Unirme'}
        </button>
      </form>
      {error && (
        <p className={styles.waitlistError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
