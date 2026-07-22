'use client';

import { FormEvent, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

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
      const res = await fetch(`${API}/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, email, offerId, quantity: 1 }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch {
      setError('No pudimos registrarte. ¿Ya estás en la lista?');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={{ padding: '1.25rem', borderRadius: 12, background: '#ecfdf5', marginTop: '1rem' }}>
        <strong>¡Listo!</strong>
        <p style={{ margin: '0.5rem 0 0' }}>
          Te avisaremos por correo cuando haya boletos para {eventTitle}.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.25rem', borderRadius: 12, border: '1px solid #e7e7ea', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>Agotado — lista de espera</h3>
      <p style={{ margin: '0 0 1rem', color: '#737373', fontSize: '0.9rem' }}>
        Déjanos tu email y serás de los primeros en enterarte cuando liberemos cupo.
      </p>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          type="email"
          required
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '0.625rem 0.875rem', borderRadius: 8, border: '1px solid #ddd' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.625rem 1rem',
            background: '#0a0a0a',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Enviando…' : 'Unirme'}
        </button>
      </form>
      {error && <p style={{ color: '#ef4444', marginTop: '0.5rem', fontSize: '0.85rem' }}>{error}</p>}
    </div>
  );
}
