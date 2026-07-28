import Link from 'next/link';
import { EventPosterArt } from './EventPosterArt';
import type { EventHit } from './EventDiscoveryPanel';
import styles from './HomeModules.module.scss';

type CityFacet = { name: string; count: number };
type VenueHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fmtPrice(n: number | string) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Consultar';
  return `Desde $${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export function HomeModules({
  trending,
  cities,
  venues,
}: {
  trending: EventHit[];
  cities: CityFacet[];
  venues: VenueHit[];
}) {
  return (
    <div className={styles.wrap}>
      {trending.length > 0 && (
        <section className={styles.section} aria-label="Lo más buscado">
          <div className={styles.head}>
            <h2>Lo más buscado</h2>
            <Link href="/">Ver cartelera</Link>
          </div>
          <ul className={styles.trending}>
            {trending.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.slug}`} className={styles.trendCard}>
                  <div className={styles.trendArt}>
                    <EventPosterArt event={e} size="lg" showDate />
                  </div>
                  <div>
                    <strong>{e.title}</strong>
                    <span>
                      {fmtDate(e.startsAt)}
                      {e.venue?.city ? ` · ${e.venue.city}` : ''}
                    </span>
                    <em>{fmtPrice(e.minPrice)}</em>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cities.length > 0 && (
        <section className={styles.section} aria-label="Ciudades">
          <div className={styles.head}>
            <h2>Ciudades más buscadas</h2>
            <Link href="/ciudades">Ver todas</Link>
          </div>
          <div className={styles.cities}>
            {cities.map((c) => (
              <Link
                key={c.name}
                href={`/ciudades/${encodeURIComponent(c.name)}`}
                className={styles.cityCard}
              >
                <strong>{c.name}</strong>
                <span>
                  {c.count} evento{c.count === 1 ? '' : 's'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {venues.length > 0 && (
        <section className={styles.section} aria-label="Recintos">
          <div className={styles.head}>
            <h2>Inmuebles</h2>
            <Link href="/venues">Ver recintos</Link>
          </div>
          <ul className={styles.venues}>
            {venues.map((v) => (
              <li key={v.id}>
                <Link href={`/venues/${v.slug}`} className={styles.venueCard}>
                  <div
                    className={styles.venueArt}
                    style={
                      v.image
                        ? { backgroundImage: `url(${v.image})` }
                        : undefined
                    }
                  />
                  <div>
                    <strong>{v.name}</strong>
                    <span>
                      {v.city}
                      {v.state ? `, ${v.state}` : ''} · {v.eventCount} evento
                      {v.eventCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
