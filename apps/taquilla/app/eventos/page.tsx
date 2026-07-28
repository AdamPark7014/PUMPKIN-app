'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import styles from './eventos.module.scss';

type Offer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

type EventRow = {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  venue: { name: string };
  offers?: Offer[];
};

function money(n: number) {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function EventosTaquillaPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    apiFetch('/discovery/events')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2' || (e.key === '/' && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        document.getElementById('event-search')?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    if (!q) return events;
    const needle = q.toLowerCase();
    return events.filter(
      (e) => e.title.toLowerCase().includes(needle) || e.venue?.name?.toLowerCase().includes(needle),
    );
  }, [events, q]);

  function ventaUrl(eventId: string, offer: Offer) {
    const params = new URLSearchParams({
      eventId,
      offerId: offer.id,
      unitPrice: String(offer.basePrice),
    });
    return `/venta?${params.toString()}`;
  }

  return (
    <PosShell title="Selecciona evento y zona" eyebrow="Catálogo de turno" backHref="/" size="md">
      <div className={styles.search}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          id="event-search"
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
            const offers = (e.offers || []).filter((o) => o.isAvailable !== false);
            const open = expanded === e.id;
            return (
              <li key={e.id} className={styles.eventBlock}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => setExpanded(open ? null : e.id)}
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
                      {offers.length > 0 && ` · ${offers.length} zona${offers.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <span className={styles.cta}>{open ? 'Cerrar' : 'Zonas'}</span>
                </button>

                {open && (
                  <ul className={styles.offerList}>
                    {offers.length === 0 ? (
                      <li className={styles.offerEmpty}>Sin ofertas disponibles</li>
                    ) : (
                      offers.map((o) => {
                        const stock = o.remainingQuantity;
                        return (
                          <li key={o.id}>
                            <Link href={ventaUrl(e.id, o)} className={styles.offerRow}>
                              <div>
                                <strong>{o.name || o.zone || 'General'}</strong>
                                <span>
                                  {o.zone && o.name ? o.zone : 'GA'}
                                  {stock != null ? ` · ${stock} disp.` : ''}
                                </span>
                              </div>
                              <em>{money(Number(o.basePrice))}</em>
                              <span className={styles.offerSell}>Vender</span>
                            </Link>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PosShell>
  );
}
