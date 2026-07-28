import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import styles from '../../hub.module.scss';

type VenueDetail = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  website?: string | null;
  image?: string | null;
  totalCapacity?: number;
  events: EventHit[];
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let venue: VenueDetail | null = null;
  try {
    venue = await api<VenueDetail>(`/discovery/venues/${slug}`);
  } catch {
    venue = null;
  }

  if (!venue) {
    return (
      <>
        <SiteHeader />
        <main className={styles.page}>
          <p className={styles.empty}>
            Recinto no encontrado. <Link href="/venues">Ver recintos</Link>
          </p>
        </main>
      </>
    );
  }

  const mapsUrl =
    venue.latitude != null && venue.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${venue.name} ${venue.address} ${venue.city}`,
        )}`;

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.crumb}>
          <Link href="/">Cartelera</Link>
          <span>/</span>
          <Link href="/venues">Recintos</Link>
          <span>/</span>
          <span>{venue.name}</span>
        </div>
        <header className={styles.hero}>
          <h1>{venue.name}</h1>
          <p>
            {venue.city}
            {venue.state ? `, ${venue.state}` : ''}
          </p>
        </header>

        <section className={styles.metaBlock}>
          <p>
            <strong>Dirección:</strong> {venue.address}
            {venue.postalCode ? ` · CP ${venue.postalCode}` : ''}
          </p>
          {venue.description && <p>{venue.description}</p>}
          {typeof venue.totalCapacity === 'number' && (
            <p>
              <strong>Capacidad:</strong> {venue.totalCapacity.toLocaleString('es-MX')}
            </p>
          )}
          {venue.phone && (
            <p>
              <strong>Teléfono:</strong> {venue.phone}
            </p>
          )}
          <p>
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              Cómo llegar
            </a>
            {venue.website ? (
              <>
                {' · '}
                <a href={venue.website} target="_blank" rel="noreferrer">
                  Sitio del recinto
                </a>
              </>
            ) : null}
          </p>
        </section>

        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.85rem' }}>Próximos eventos</h2>
        {venue.events.length === 0 ? (
          <p className={styles.empty}>Sin eventos programados en este recinto.</p>
        ) : (
          <ul className={styles.grid}>
            {venue.events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.slug}`} className={styles.card}>
                  <EventPosterArt event={e} size="sm" />
                  <div>
                    <strong>{e.title}</strong>
                    <span>{fmtDate(e.startsAt)}</span>
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
