'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './eventos.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type EventRow = {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  venue: { name: string };
  offers?: { id: string; basePrice: string | number; zone?: string }[];
};

export default function EventosTaquillaPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/discovery/events`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!q) return events;
    const needle = q.toLowerCase();
    return events.filter(
      (e) => e.title.toLowerCase().includes(needle) || e.venue?.name?.toLowerCase().includes(needle),
    );
  }, [events, q]);

  return (
    <main className={styles.page}>
      <div className={styles.bg} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.back} aria-label="Volver al inicio">
          ←
        </Link>
        <div>
          <p className={styles.eyebrow}>Catálogo de turno</p>
          <h1>Selecciona el evento a vender</h1>
        </div>
      </header>

      <div className={styles.search}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          autoFocus
          type="search"
          placeholder="Buscar por nombre o venue…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <kbd>F2</kbd>
      </div>

      {loading ? (
        <div className={styles.skeleton}>
          <span /> <span /> <span /> <span />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>{events.length === 0 ? 'No hay eventos activos.' : 'Sin coincidencias.'}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((e, i) => {
            const date = new Date(e.startsAt);
            return (
              <li key={e.id}>
                <Link
                  href={`/venta?eventId=${e.id}&offerId=${e.offers?.[0]?.id ?? ''}&unitPrice=${e.offers?.[0]?.basePrice ?? ''}`}
                  className={styles.card}
                >
                  <span className={styles.idx}>{String(i + 1).padStart(2, '0')}</span>
                  <div className={styles.cardDate}>
                    <strong>{date.toLocaleDateString('es-MX', { day: '2-digit' })}</strong>
                    <span>{date.toLocaleDateString('es-MX', { month: 'short' }).toUpperCase()}</span>
                  </div>
                  <div className={styles.cardInfo}>
                    <strong>{e.title}</strong>
                    <span>
                      {e.venue?.name} ·{' '}
                      {date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <span className={styles.cta}>
                    Vender
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
