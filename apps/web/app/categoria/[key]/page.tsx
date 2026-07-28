import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import styles from '../../hub.module.scss';

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Conciertos',
  SPORTS: 'Deportes',
  THEATER: 'Artes y teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festivales',
  FAMILY: 'Familiares',
  STANDUP: 'Stand-up',
  CINEMA: 'Cine',
  OTHER: 'Eventos',
};

const ALLOWED = new Set(Object.keys(CATEGORY_LABEL));

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function CategoriaPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: raw } = await params;
  const key = raw.toUpperCase();
  if (!ALLOWED.has(key)) notFound();

  let events: EventHit[] = [];
  try {
    events = await api<EventHit[]>(
      `/discovery/events?category=${encodeURIComponent(key)}&limit=60`,
    );
  } catch {
    events = [];
  }

  const label = CATEGORY_LABEL[key] ?? key;

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.crumb}>
          <Link href="/">Cartelera</Link>
          <span>/</span>
          <span>{label}</span>
        </div>
        <header className={styles.hero}>
          <h1>{label}</h1>
          <p>
            {events.length} evento{events.length === 1 ? '' : 's'} en cartelera
          </p>
        </header>
        {events.length === 0 ? (
          <p className={styles.empty}>
            No hay eventos en esta categoría. <Link href="/">Ver cartelera</Link>
          </p>
        ) : (
          <ul className={styles.grid}>
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.slug}`} className={styles.card}>
                  <EventPosterArt event={e} size="sm" />
                  <div>
                    <strong>{e.title}</strong>
                    <span>
                      {fmtDate(e.startsAt)}
                      {e.venue?.city ? ` · ${e.venue.city}` : ''}
                    </span>
                  </div>
                  <em>
                    {Number(e.minPrice) > 0
                      ? `$${Number(e.minPrice).toLocaleString('es-MX', {
                          maximumFractionDigits: 0,
                        })}`
                      : '—'}
                  </em>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
