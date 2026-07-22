'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../app/events/events.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type EventHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice: number | string;
  currency: string;
  venue?: { name: string; city: string };
  score?: number;
};

export function EventDiscoveryPanel({ initial }: { initial: EventHit[] }) {
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<EventHit[]>(initial);
  const [trending, setTrending] = useState<EventHit[]>([]);

  useEffect(() => {
    fetch(`${API}/search/trending`)
      .then((r) => r.json())
      .then((data) => setTrending(Array.isArray(data) ? data : data?.events ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setEvents(initial);
      return;
    }
    const t = setTimeout(() => {
      fetch(`${API}/search/events?query=${encodeURIComponent(query)}&limit=24`)
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : data?.results ?? [];
          setEvents(
            list.map((row: { event?: EventHit } & EventHit) => (row.event ? { ...row.event, score: row.score } : row)),
          );
        })
        .catch(() => setEvents([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, initial]);

  const showTrending = !query.trim() && trending.length > 0;

  return (
    <>
      <div className={styles.searchBar}>
        <input
          type="search"
          placeholder="Buscar eventos, artistas, venues…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar eventos"
        />
      </div>

      {showTrending && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Tendencias</h2>
          <div className={styles.grid}>
            {trending.slice(0, 6).map((e) => (
              <Link key={e.id} href={`/events/${e.slug}`} className={styles.card}>
                <h2>{e.title}</h2>
                <p>
                  {e.venue?.name ?? 'Venue'} · {e.venue?.city ?? ''}
                </p>
                <p className={styles.price}>
                  Desde ${e.minPrice} {e.currency}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{query ? 'Resultados' : 'Todos los eventos'}</h2>
        <div className={styles.grid}>
          {events.map((e) => (
            <Link key={e.id} href={`/events/${e.slug}`} className={styles.card}>
              <h2>{e.title}</h2>
              <p>
                {e.venue?.name ?? 'Venue'} · {e.venue?.city ?? ''}
              </p>
              <p className={styles.price}>
                Desde ${e.minPrice} {e.currency}
              </p>
              {e.score != null && <span className={styles.badge}>Match {Math.round(e.score * 100)}%</span>}
            </Link>
          ))}
          {events.length === 0 && <p className={styles.empty}>No hay eventos que coincidan.</p>}
        </div>
      </section>
    </>
  );
}
