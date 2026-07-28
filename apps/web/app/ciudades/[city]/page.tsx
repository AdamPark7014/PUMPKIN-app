import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import styles from '../../hub.module.scss';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function CiudadPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);
  let events: EventHit[] = [];
  try {
    events = await api<EventHit[]>(
      `/discovery/events?city=${encodeURIComponent(city)}&limit=60`,
    );
  } catch {
    events = [];
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.crumb}>
          <Link href="/">Cartelera</Link>
          <span>/</span>
          <Link href="/ciudades">Ciudades</Link>
          <span>/</span>
          <span>{city}</span>
        </div>
        <header className={styles.hero}>
          <h1>{city}</h1>
          <p>
            {events.length} evento{events.length === 1 ? '' : 's'} disponibles
          </p>
        </header>
        {events.length === 0 ? (
          <p className={styles.empty}>
            Sin eventos en esta ciudad. <Link href="/ciudades">Ver otras</Link>
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
                      {e.venue?.name ? ` · ${e.venue.name}` : ''}
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
